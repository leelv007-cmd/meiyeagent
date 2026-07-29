import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';

import type {
  BoundedExecutionSnapshot,
  ObservabilityAxisBinding,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
  StructuredNodeRunnerResult,
} from '../model-supply/structured-node-runner.js';
import type {
  GeneratePort,
  RevisePort,
  ReviseTargetFence,
  ReviseTargetResolverPort,
} from './core-handlers.js';

interface PrimitiveBilling {
  productUsageTaskId: string;
  quoteId: string;
}

export interface P1HarnessCandidateApplicationPort {
  executeModule<TInput extends Record<string, unknown>, TOutput>(
    context: P1Context,
    name: string,
    input: TInput,
    idempotencyKey: string,
  ): Promise<TOutput>;
  executeModuleWithReplay?<
    TInput extends Record<string, unknown>,
    TOutput,
  >(
    context: P1Context,
    name: string,
    input: TInput,
    idempotencyKey: string,
  ): Promise<{ value: TOutput; replayed: boolean }>;
}

export interface P1HarnessCandidateRunnerInput {
  application: P1HarnessCandidateApplicationPort;
  billing: PrimitiveBilling;
  boundedExecution: BoundedExecutionSnapshot;
  observability: ObservabilityAxisBinding;
  resumeCandidate?: {
    revision: number;
    sourceEffectIdempotencyKey: string;
  };
  runner: StructuredNodeRunner;
  taskId: string;
  workspaceId: string;
}

interface CandidateRevision {
  revision: number;
  targetRef: string;
}

interface CandidateSession {
  application: P1HarnessCandidateApplicationPort;
  billing: PrimitiveBilling;
  boundedExecution: BoundedExecutionSnapshot;
  candidate?: CandidateRevision;
  observability: ObservabilityAxisBinding;
  routes: Map<string, CandidatePrimitiveRoute>;
  runner: StructuredNodeRunner;
  taskId: string;
  workspaceId: string;
}

interface CandidatePrimitiveRoute {
  canonicalRequest: string;
  completed: boolean;
  expectedRevision?: number;
  modelInput: Record<string, unknown>;
  primitiveId: 'generate' | 'revise';
}

interface ActiveCandidateRun {
  request: StructuredNodeRunnerRequest<unknown>;
  requestRef: string;
  session: CandidateSession;
}

export class P1HarnessCandidateRevisionConflict extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Harness candidate OCC revision is stale.');
    this.name = 'P1HarnessCandidateRevisionConflict';
  }
}

export class P1HarnessCandidateRunnerScope
  implements GeneratePort, ReviseTargetResolverPort, RevisePort
{
  private readonly storage = new AsyncLocalStorage<ActiveCandidateRun>();

  constructor(private readonly workerId: string) {
    if (!workerId.trim()) {
      throw new Error('Harness candidate worker identity is required.');
    }
  }

  wrap(input: P1HarnessCandidateRunnerInput): StructuredNodeRunner {
    const taskId = requiredText(
      input.taskId,
      'Harness candidate task identity',
    );
    const workspaceId = requiredText(
      input.workspaceId,
      'Harness candidate workspace identity',
    );
    const resumeCandidate = input.resumeCandidate;
    if (
      resumeCandidate &&
      (
        !Number.isInteger(resumeCandidate.revision) ||
        resumeCandidate.revision < 1
      )
    ) {
      throw new Error('Harness resumed candidate revision is invalid.');
    }
    const session: CandidateSession = {
      application: input.application,
      billing: structuredClone(input.billing),
      boundedExecution: structuredClone(input.boundedExecution),
      ...(resumeCandidate
        ? {
            candidate: {
              revision: resumeCandidate.revision,
              targetRef:
                `harness-candidate:${taskId}:` +
                requiredText(
                  resumeCandidate.sourceEffectIdempotencyKey,
                  'Harness resumed candidate source effect',
                ),
            },
          }
        : {}),
      observability: structuredClone(input.observability),
      routes: new Map(),
      runner: input.runner,
      taskId,
      workspaceId,
    };
    return {
      run: <Output>(request: StructuredNodeRunnerRequest<Output>) =>
        this.run(
          session,
          request as StructuredNodeRunnerRequest<unknown>,
        ) as Promise<StructuredNodeRunnerResult<Output>>,
    };
  }

  async generate(
    input: Parameters<GeneratePort['generate']>[0],
  ): Promise<unknown> {
    const active = this.active();
    this.assertExecutionContext(input, active.session);
    if (input.kind !== 'copy') {
      throw new Error('Harness candidate generation only supports copy.');
    }
    if (!isDeepStrictEqual(input.brief, { request_ref: active.requestRef })) {
      throw new Error(
        'Harness candidate generate request does not match the active server scope.',
      );
    }
    if (active.session.candidate) {
      throw new Error(
        'Harness candidate generate cannot replace an active candidate revision.',
      );
    }

    const result = await active.session.runner.run(active.request);
    active.session.candidate = {
      revision: 1,
      targetRef:
        `harness-candidate:${active.session.taskId}:` +
        active.request.effectIdempotencyKey,
    };
    return result;
  }

  async resolve(
    input: Parameters<ReviseTargetResolverPort['resolve']>[0],
  ): Promise<ReviseTargetFence> {
    const active = this.active();
    const candidate = this.currentCandidate(active);
    this.assertWorkspace(input.workspaceId, active.session);
    if (input.targetRef !== versionedTargetRef(candidate)) {
      throw new P1HarnessCandidateRevisionConflict();
    }
    return {
      expectedRevision: candidate.revision,
      targetRef: candidate.targetRef,
    };
  }

  async revise(
    input: Parameters<RevisePort['revise']>[0],
  ): Promise<unknown> {
    const active = this.active();
    const candidate = this.currentCandidate(active);
    this.assertExecutionContext(input, active.session);
    if (
      input.targetRef !== candidate.targetRef ||
      input.expectedRevision !== candidate.revision
    ) {
      throw new P1HarnessCandidateRevisionConflict();
    }
    if (input.instruction !== active.request.instructions) {
      throw new Error(
        'Harness candidate revision instruction does not match the active request.',
      );
    }
    if (input.idempotencyKey !== active.request.effectIdempotencyKey) {
      throw new Error(
        'Harness candidate revision idempotency key does not match the active request.',
      );
    }

    const result = await active.session.runner.run(active.request);
    active.session.candidate = {
      ...candidate,
      revision: candidate.revision + 1,
    };
    return result;
  }

  private run(
    session: CandidateSession,
    request: StructuredNodeRunnerRequest<unknown>,
  ): Promise<StructuredNodeRunnerResult<unknown>> {
    const requestRef =
      `harness-candidate-request:${session.taskId}:` +
      request.effectIdempotencyKey;
    const canonicalRequest = JSON.stringify({
      instructions: request.instructions,
      prompt: request.prompt,
      schemaName: request.schemaName,
      schemaRevision: request.schemaRevision,
    });
    const existingRoute = session.routes.get(
      request.effectIdempotencyKey,
    );
    if (
      existingRoute &&
      existingRoute.canonicalRequest !== canonicalRequest
    ) {
      throw new Error(
        'Harness candidate idempotency key conflicts with a different request.',
      );
    }
    const route =
      existingRoute ??
      (session.candidate
        ? {
            canonicalRequest,
            completed: false,
            expectedRevision: session.candidate.revision,
            modelInput: {
              instruction: request.instructions,
              target_ref: versionedTargetRef(session.candidate),
            },
            primitiveId: 'revise' as const,
          }
        : {
            canonicalRequest,
            completed: false,
            modelInput: {
              brief: { request_ref: requestRef },
              kind: 'copy',
            },
            primitiveId: 'generate' as const,
          });
    session.routes.set(request.effectIdempotencyKey, route);
    const replayed = route.completed;
    return this.storage.run(
      { request, requestRef, session },
      async () => {
        const context = {
          actor: 'worker' as const,
          correlationId: request.effectIdempotencyKey,
          userId: this.workerId,
          workspaceId: session.workspaceId,
        };
        const input = {
          action: 'execute',
          payload: {
            billing: structuredClone(session.billing),
            boundedExecution: structuredClone(session.boundedExecution),
            modelInput: structuredClone(route.modelInput),
            observability: structuredClone(session.observability),
            primitiveId: route.primitiveId,
            taskId: session.taskId,
          },
        };
        const execution = session.application.executeModuleWithReplay
          ? await session.application.executeModuleWithReplay<
              Record<string, unknown>,
              StructuredNodeRunnerResult<unknown>
            >(
              context,
              'agent-primitives',
              input,
              request.effectIdempotencyKey,
            )
          : {
              replayed: false,
              value:
                await session.application.executeModule<
                  Record<string, unknown>,
                  StructuredNodeRunnerResult<unknown>
                >(
                  context,
                  'agent-primitives',
                  input,
                  request.effectIdempotencyKey,
                ),
            };
        const result = execution.value;
        this.restoreCandidateFence(
          session,
          route,
          request.effectIdempotencyKey,
        );
        route.completed = true;
        return replayed || execution.replayed
          ? { ...result, replayed: true }
          : result;
      },
    );
  }

  private active(): ActiveCandidateRun {
    const active = this.storage.getStore();
    if (!active) {
      throw new Error('No Harness candidate request scope is active.');
    }
    return active;
  }

  private restoreCandidateFence(
    session: CandidateSession,
    route: CandidatePrimitiveRoute,
    effectIdempotencyKey: string,
  ): void {
    if (route.primitiveId === 'generate') {
      session.candidate ??= {
        revision: 1,
        targetRef:
          `harness-candidate:${session.taskId}:` +
          effectIdempotencyKey,
      };
      return;
    }
    if (
      route.expectedRevision !== undefined &&
      session.candidate?.revision === route.expectedRevision
    ) {
      session.candidate = {
        ...session.candidate,
        revision: route.expectedRevision + 1,
      };
    }
  }

  private currentCandidate(active: ActiveCandidateRun): CandidateRevision {
    if (!active.session.candidate) {
      throw new Error('No Harness candidate revision is active.');
    }
    return active.session.candidate;
  }

  private assertExecutionContext(
    input: {
      billing: PrimitiveBilling;
      boundedExecution: BoundedExecutionSnapshot;
      workspaceId: string;
    },
    session: CandidateSession,
  ): void {
    this.assertWorkspace(input.workspaceId, session);
    if (!isDeepStrictEqual(input.billing, session.billing)) {
      throw new Error(
        'Harness candidate billing does not match the active server scope.',
      );
    }
    if (!isDeepStrictEqual(input.boundedExecution, session.boundedExecution)) {
      throw new Error(
        'Harness candidate bounded execution does not match the active server scope.',
      );
    }
  }

  private assertWorkspace(
    workspaceId: string,
    session: CandidateSession,
  ): void {
    if (workspaceId !== session.workspaceId) {
      throw new Error(
        'Harness candidate does not belong to the active execution workspace.',
      );
    }
  }
}

function versionedTargetRef(candidate: CandidateRevision): string {
  return `${candidate.targetRef}@${candidate.revision}`;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
