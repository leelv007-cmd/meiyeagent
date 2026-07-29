import type { AgentPrimitiveInputById } from '@meiye/contracts';

import type {
  AgentPrimitiveHandler,
  AgentPrimitiveServerContext,
} from './runtime.js';

type ReadContextInput = AgentPrimitiveInputById['read_context'];
type GenerateInput = AgentPrimitiveInputById['generate'];
type ReviseInput = AgentPrimitiveInputById['revise'];
type RecordInput = AgentPrimitiveInputById['record'];
type BillingContext = NonNullable<AgentPrimitiveServerContext['billing']>;

function requireBilling(
  serverContext: AgentPrimitiveServerContext,
): BillingContext {
  if (!serverContext.billing) {
    throw new Error('Billed primitive requires server-owned billing context.');
  }
  return serverContext.billing;
}

export interface ReadContextPort {
  read(input: {
    scope: ReadContextInput['scope'];
    query?: ReadContextInput['query'];
    workspaceId: string;
  }): Promise<unknown>;
}

export function createReadContextHandler(
  port: ReadContextPort,
): AgentPrimitiveHandler<'read_context'> {
  return async ({ input, serverContext }) =>
    port.read({
      scope: input.scope,
      ...(input.query ? { query: input.query } : {}),
      workspaceId: serverContext.workspaceId,
    });
}

export interface GeneratePort {
  generate(input: {
    kind: GenerateInput['kind'];
    brief: GenerateInput['brief'];
    workspaceId: string;
    billing: BillingContext;
  }): Promise<unknown>;
}

export function createGenerateHandler(
  port: GeneratePort,
): AgentPrimitiveHandler<'generate'> {
  return async ({ input, serverContext }) => {
    const billing = requireBilling(serverContext);
    return port.generate({
      kind: input.kind,
      brief: input.brief,
      workspaceId: serverContext.workspaceId,
      billing,
    });
  };
}

export interface ReviseTargetFence {
  expectedRevision: number;
  targetRef: string;
}

export interface ReviseTargetResolverPort {
  resolve(input: {
    targetRef: ReviseInput['target_ref'];
    workspaceId: string;
  }): Promise<ReviseTargetFence>;
}

export interface RevisePort {
  revise(input: {
    targetRef: ReviseInput['target_ref'];
    expectedRevision: number;
    instruction: ReviseInput['instruction'];
    workspaceId: string;
    billing: BillingContext;
    idempotencyKey: string;
  }): Promise<unknown>;
}

export function createReviseHandler(
  ports: {
    resolver: ReviseTargetResolverPort;
    writer: RevisePort;
  },
): AgentPrimitiveHandler<'revise'> {
  return async ({ input, serverContext }) => {
    const billing = requireBilling(serverContext);
    const fence = await ports.resolver.resolve({
      targetRef: input.target_ref,
      workspaceId: serverContext.workspaceId,
    });
    if (
      fence.targetRef.trim().length === 0 ||
      !Number.isInteger(fence.expectedRevision) ||
      fence.expectedRevision < 0
    ) {
      throw new Error('Revise target resolver returned an invalid OCC fence.');
    }
    return ports.writer.revise({
      targetRef: fence.targetRef,
      expectedRevision: fence.expectedRevision,
      instruction: input.instruction,
      workspaceId: serverContext.workspaceId,
      billing,
      idempotencyKey: serverContext.idempotencyKey,
    });
  };
}

export interface RecordProposalOutcome {
  proposalRef?: string;
  status: string;
  [key: string]: unknown;
}

export interface RecordProposalPort {
  propose(input: {
    kind: RecordInput['kind'];
    payload: RecordInput['payload'];
    provenance: RecordInput['provenance'];
    workspaceId: string;
    idempotencyKey: string;
  }): Promise<RecordProposalOutcome>;
}

export function createRecordHandler(
  port: RecordProposalPort,
): AgentPrimitiveHandler<'record'> {
  return async ({ input, serverContext }) => {
    if (!input.kind.startsWith('propose_')) {
      throw new Error(
        `Model record kind must use the propose_ prefix: ${input.kind}`,
      );
    }

    const outcome = await port.propose({
      kind: input.kind,
      payload: input.payload,
      provenance: input.provenance,
      workspaceId: serverContext.workspaceId,
      idempotencyKey: serverContext.idempotencyKey,
    });
    if (
      outcome.status !== 'proposed' ||
      typeof outcome.proposalRef !== 'string' ||
      outcome.proposalRef.trim().length === 0
    ) {
      throw new Error('Record proposal port returned a non-proposal outcome.');
    }
    return {
      proposalRef: outcome.proposalRef.trim(),
      status: 'proposed' as const,
    };
  };
}
