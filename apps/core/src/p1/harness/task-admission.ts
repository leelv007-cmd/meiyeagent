import {
  harnessTaskSubmissionSchema,
  reuseTaskSeedSchema,
  storeFactScopeSchema,
  taskIntentInputSchema,
  type ReuseTaskSeed,
  type StoreFact,
  type TaskIntentInput,
} from '@meiye/contracts';
import { z } from 'zod';

import {
  creationExecutionSnapshotSchema,
  type CreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptResolver,
} from './langfuse-prompts.js';

export interface HarnessWorkflowInput {
  actorId: string;
  workspaceId: string;
  packageId: string;
  expectedRevision: number;
  workflowRevision: number;
  creationMode: 'customized' | 'free';
  rawInput: string;
  intent: TaskIntentInput;
  factScope?: StoreFact['scope'];
  decisionReferences?: Array<{
    id: string;
    field: string;
    value: string;
    revision: number;
  }>;
  reuseSeed?: ReuseTaskSeed;
  /** Present only for new Composer submissions on the execution spine. */
  executionSnapshot?: CreationExecutionSnapshot;
  prompts?: HarnessFrozenPrompts;
}

export interface HarnessTaskRequest extends Omit<HarnessWorkflowInput, 'prompts'> {
  taskId: string;
}

export const harnessTaskRequestSchema = harnessTaskSubmissionSchema
  .extend({
    actorId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
    expectedRevision: z.number().int().nonnegative(),
    workflowRevision: z.number().int().nonnegative(),
    creationMode: z.enum(['customized', 'free']),
    rawInput: z.string().trim().min(1),
    intent: taskIntentInputSchema,
    factScope: storeFactScopeSchema.optional(),
    reuseSeed: reuseTaskSeedSchema.optional(),
  })
  .strict();

export interface HarnessTaskRequestRegistry {
  claim(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }): Promise<
    | { kind: 'created' }
    | {
        kind: 'existing';
        workflowId: string;
        runtimeId?: string;
        request?: HarnessWorkflowInput;
      }
    | { kind: 'conflict' }
  >;
}

export interface HarnessWorkflowStarter {
  start(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    runtimeId?: string;
  }): Promise<{ workflowId: string }>;
}

export class HarnessAdmissionError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'EXECUTION_SNAPSHOT_MISMATCH'
      | 'REQUEST_FINGERPRINT_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'HarnessAdmissionError';
  }
}

export class HarnessTaskAdmissionService {
  constructor(
    private readonly registry: HarnessTaskRequestRegistry,
    private readonly starter: HarnessWorkflowStarter,
    private readonly prompts?: HarnessPromptResolver,
  ) {}

  async submit(input: HarnessTaskRequest) {
    const normalized = normalizeRequest(input);
    const request = this.prompts
      ? { ...normalized, prompts: await this.prompts.resolve() }
      : normalized;
    const claim = await this.registry.claim({
      taskId: input.taskId,
      fingerprint: fingerprintValue(normalized),
      request,
    });
    if (claim.kind === 'conflict') {
      throw new HarnessAdmissionError(
        'REQUEST_FINGERPRINT_CONFLICT',
        'Task ID was reused with a different harness request payload.',
      );
    }
    if (claim.kind === 'existing') {
      const handle = await this.starter.start({
        workflowId: claim.workflowId,
        request: claim.request ?? request,
        ...(claim.runtimeId ? { runtimeId: claim.runtimeId } : {}),
      });
      return { workflowId: handle.workflowId, replayed: true as const };
    }
    const handle = await this.starter.start({
      workflowId: input.taskId,
      request,
    });
    return { workflowId: handle.workflowId, replayed: false as const };
  }
}

function normalizeRequest(input: HarnessTaskRequest): HarnessWorkflowInput {
  const { executionSnapshot, ...request } = input;
  const parsed = harnessTaskRequestSchema.parse(request);
  const snapshot = executionSnapshot
    ? creationExecutionSnapshotSchema.parse(executionSnapshot)
    : undefined;
  if (snapshot) {
    assertExecutionSnapshotMatchesRequest(snapshot, parsed);
    return snapshotWorkflowInput(snapshot);
  }
  return {
    actorId: parsed.actorId,
    workspaceId: parsed.workspaceId,
    packageId: parsed.packageId,
    expectedRevision: parsed.expectedRevision,
    workflowRevision: parsed.workflowRevision,
    creationMode: parsed.creationMode,
    rawInput: parsed.rawInput,
    intent: parsed.intent,
    factScope: parsed.factScope ?? { storeId: parsed.workspaceId },
    ...(parsed.reuseSeed ? { reuseSeed: parsed.reuseSeed } : {}),
  };
}

function snapshotWorkflowInput(
  snapshot: CreationExecutionSnapshot,
): HarnessWorkflowInput {
  return {
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: snapshot.sources.assets.map((asset) => asset.id),
    },
    factScope: { storeId: snapshot.workspaceId },
    executionSnapshot: snapshot,
  };
}

function assertExecutionSnapshotMatchesRequest(
  snapshot: CreationExecutionSnapshot,
  request: z.infer<typeof harnessTaskRequestSchema>,
) {
  const snapshotAssetIds = snapshot.sources.assets.map((asset) => asset.id);
  const matchingAssets =
    snapshotAssetIds.length === request.intent.assetReferences.length &&
    snapshotAssetIds.every(
      (assetId, index) => assetId === request.intent.assetReferences[index],
    );
  const context = request.intent.context;
  if (
    snapshot.actorId !== request.actorId ||
    snapshot.workspaceId !== request.workspaceId ||
    snapshot.task.id !== request.taskId ||
    snapshot.work.id !== context.workId ||
    snapshot.contentPackage.id !== request.packageId ||
    snapshot.contentPackage.expectedRevision !== request.expectedRevision ||
    snapshot.revision !== request.workflowRevision ||
    snapshot.creationMode !== request.creationMode ||
    snapshot.intent.text !== request.rawInput ||
    snapshot.intent.text !== context.intent ||
    !sameStringArray(context.sourceSummaries, []) ||
    context.scene !== undefined ||
    context.tone !== undefined ||
    context.audience !== undefined ||
    !isDefaultFactScope(request.factScope, snapshot.workspaceId) ||
    request.reuseSeed !== undefined ||
    !matchingAssets
  ) {
    throw new HarnessAdmissionError(
      'EXECUTION_SNAPSHOT_MISMATCH',
      'The execution snapshot does not match the Harness task request.',
    );
  }
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDefaultFactScope(
  scope: StoreFact['scope'] | undefined,
  workspaceId: string,
) {
  return (
    scope === undefined ||
    (scope.storeId === workspaceId &&
      scope.serviceId === undefined &&
      scope.personaId === undefined &&
      scope.platform === undefined)
  );
}
