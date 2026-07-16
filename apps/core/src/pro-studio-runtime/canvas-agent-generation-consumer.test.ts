import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CanvasAgentApplicationService,
  MemoryCanvasAgentRepository,
  type AgentGenerationOutboxItem,
  type CanvasAgentAuthorizationPort,
} from './canvas-agent.js';
import {
  CanvasAgentGenerationConsumer,
  CanvasAgentGenerationConsumerError,
  CanonicalGenerationError,
  type CanvasAgentCanonicalGenerationInput,
  type CanvasAgentCanonicalGenerationPort,
} from './canvas-agent-generation-consumer.js';

const context = {
  correlationId: 'agent-generation-test',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
};

const authorization: CanvasAgentAuthorizationPort = {
  async resolve(input) {
    return {
      assetGrantRevisions: Object.fromEntries(
        input.assetIds.map((assetId) => [assetId, `grant:${assetId}`]),
      ),
      operationCapabilityRevisions: Object.fromEntries(
        input.operations.map((operation) => [
          operation.tool === 'run_generation'
            ? `run_generation:${operation.operation}`
            : operation.tool,
          operation.tool === 'run_generation'
            ? `capability:${operation.operation}`
            : `capability:${operation.tool}`,
        ]),
      ),
      quotaQuote: {
        id: `quota:${input.operationHash}`,
        maxCostMicros: input.maxCostMicros,
        maxGenerationCount: input.maxGenerationCount,
        operationHash: input.operationHash,
        revision: 'quota-v1',
      },
      role: 'owner',
      roleRevision: 'owner-v1',
    };
  },
};

test('claims once and calls only canonical quote then submit', async () => {
  const repository = await agentOutbox();
  const canonical = new RecordedCanonicalGeneration();
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    claimToken: () => 'claim-1',
    clock: () => new Date('2026-07-16T10:01:00.000Z'),
  });

  const results = await Promise.all([
    consumer.runOnce(context.workspaceId),
    consumer.runOnce(context.workspaceId),
  ]);

  assert.equal(
    results.filter((result) => result.status === 'submitted').length,
    1,
  );
  assert.equal(results.filter((result) => result.status === 'idle').length, 1);
  assert.equal(canonical.quotes.length, 1);
  assert.equal(canonical.submissions.length, 1);
  assert.equal(canonical.jobs.size, 1);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'submitted');
  assert.equal(state.outbox[0]?.canonicalJobId, 'core-job-1');
  assert.equal(state.outbox[0]?.userId, context.userId);
  assert.deepEqual(state.outbox[0]?.inputAssets, []);
  assert.deepEqual(state.outbox[0]?.attemptEvents, [
    {
      attemptNo: 1,
      backoffMs: 0,
      maxAttempts: 3,
      outcome: 'submitted',
      retryable: false,
      startedAt: '2026-07-16T10:01:00.000Z',
    },
  ]);
  assert.equal(canonical.readSetValidations.length, 1);
  assert.equal(canonical.submissions[0]?.localJobId, state.outbox[0]?.idempotencyKey);
});

test('permanently fails before quote when a frozen Asset read-set drifts', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(
    repository,
    generationItem({
      assetGrantRevisions: { 'asset-1': 'grant-v1' },
      assetVersions: { 'asset-1': 'sha-v1' },
      inputAssets: [{ assetId: 'asset-1', role: 'reference_image' }],
    }),
  );
  const canonical = new RecordedCanonicalGeneration();
  canonical.readSetOverride = {
    assetGrantRevisions: { 'asset-1': 'grant-v2' },
    assetVersions: { 'asset-1': 'sha-v2' },
  };
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    claimToken: () => 'claim-read-set-drift',
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });

  await assert.rejects(
    consumer.runOnce(context.workspaceId),
    (error: unknown) =>
      error instanceof CanvasAgentGenerationConsumerError &&
      error.code === 'AGENT_GENERATION_ASSET_READ_SET_CHANGED',
  );
  assert.equal(canonical.readSetValidations.length, 1);
  assert.equal(canonical.quotes.length, 0);
  assert.equal(canonical.submissions.length, 0);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'failed');
  assert.equal(
    state.auditEvents[0]?.errorCode,
    'AGENT_GENERATION_ASSET_READ_SET_CHANGED',
  );
  assert.deepEqual(state.outbox[0]?.attemptEvents, [
    {
      attemptNo: 1,
      backoffMs: 0,
      errorCode: 'AGENT_GENERATION_ASSET_READ_SET_CHANGED',
      maxAttempts: 3,
      outcome: 'failed',
      retryable: false,
      startedAt: '2026-07-16T10:00:00.000Z',
    },
  ]);
});

test('fails closed and audits an outbox item without role-bearing inputs', async () => {
  const repository = new MemoryCanvasAgentRepository();
  const item = generationItem();
  delete (item as Partial<AgentGenerationOutboxItem>).inputAssets;
  await seedGeneration(repository, item);
  const canonical = new RecordedCanonicalGeneration();
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    claimToken: () => 'claim-missing-role',
  });

  await assert.rejects(
    consumer.runOnce(context.workspaceId),
    (error: unknown) =>
      error instanceof CanvasAgentGenerationConsumerError &&
      error.code === 'AGENT_GENERATION_INPUT_ROLE_MISSING',
  );
  assert.equal(canonical.quotes.length, 0);
  assert.equal(canonical.submissions.length, 0);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'failed');
  assert.equal(
    state.outbox[0]?.failureCode,
    'AGENT_GENERATION_INPUT_ROLE_MISSING',
  );
  assert.equal(state.auditEvents[0]?.outcome, 'error');
  assert.equal(
    state.auditEvents[0]?.errorCode,
    'AGENT_GENERATION_INPUT_ROLE_MISSING',
  );
});

test('rejects canonical revision drift before submit', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(repository, generationItem());
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteOverride = { capabilityRevision: 'capability:new' };
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });

  await assert.rejects(
    consumer.runOnce(context.workspaceId),
    (error: unknown) =>
      error instanceof CanvasAgentGenerationConsumerError &&
      error.code === 'AGENT_GENERATION_REVISION_CHANGED',
  );
  assert.equal(canonical.submissions.length, 0);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'failed');
  assert.equal(
    state.auditEvents[0]?.errorCode,
    'AGENT_GENERATION_REVISION_CHANGED',
  );
});

test('rejects a canonical quote above confirmed cost before submit', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(repository, generationItem());
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteOverride = { costMicros: 1_000_001 };
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical);

  await assert.rejects(
    consumer.runOnce(context.workspaceId),
    (error: unknown) =>
      error instanceof CanvasAgentGenerationConsumerError &&
      error.code === 'AGENT_GENERATION_BATCH_LIMIT_EXCEEDED',
  );
  assert.equal(canonical.submissions.length, 0);
  assert.equal(
    repository.snapshot(context.workspaceId).outbox[0]?.status,
    'failed',
  );
});

test('atomically consumes one shared batch budget across generation items', async () => {
  const repository = new MemoryCanvasAgentRepository();
  const first = generationItem({ id: 'agent-outbox-1' });
  const second = generationItem({
    id: 'agent-outbox-2',
    idempotencyKey: 'agent-generation-2',
  });
  await repository.transact(context.workspaceId, (state) => {
    state.outbox.push(first, second);
    state.generationBatches.push({
      id: first.batchId,
      maxCostMicros: 1_000_000,
      maxGenerationCount: 2,
      reservations: [],
    });
  });
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteOverride = { costMicros: 600_000 };
  const consumerA = new CanvasAgentGenerationConsumer(repository, canonical, {
    claimToken: () => 'batch-claim-a',
  });
  const consumerB = new CanvasAgentGenerationConsumer(repository, canonical, {
    claimToken: () => 'batch-claim-b',
  });

  const results = await Promise.allSettled([
    consumerA.runOnce(context.workspaceId),
    consumerB.runOnce(context.workspaceId),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.equal(rejected.reason?.code, 'AGENT_GENERATION_BATCH_LIMIT_EXCEEDED');
  assert.equal(canonical.submissions.length, 1);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.generationBatches[0]?.reservations.length, 1);
  assert.equal(state.generationBatches[0]?.reservations[0]?.costMicros, 600_000);
  assert.equal(state.outbox.filter((item) => item.status === 'submitted').length, 1);
  assert.equal(state.outbox.filter((item) => item.status === 'failed').length, 1);
});

test('backs off retryable canonical failures and audits after the attempt limit', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(repository, generationItem());
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteError = new CanonicalGenerationError(
    'CORE_TEMPORARILY_UNAVAILABLE',
    'Core is temporarily unavailable.',
    { retryable: true },
  );
  let now = new Date('2026-07-16T10:00:00.000Z');
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    clock: () => now,
    maxAttempts: 2,
    retryDelayMs: 5_000,
  });

  await assert.rejects(consumer.runOnce(context.workspaceId), canonical.quoteError);
  let state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'retry');
  assert.equal(state.outbox[0]?.attemptCount, 1);
  assert.equal(state.outbox[0]?.availableAt, '2026-07-16T10:00:05.000Z');
  const firstAttempt = structuredClone(state.outbox[0]?.attemptEvents[0]);
  assert.deepEqual(firstAttempt, {
    attemptNo: 1,
    backoffMs: 5_000,
    errorCode: 'CORE_TEMPORARILY_UNAVAILABLE',
    maxAttempts: 2,
    outcome: 'retry',
    retryable: true,
    startedAt: '2026-07-16T10:00:00.000Z',
  });
  assert.deepEqual(await consumer.runOnce(context.workspaceId), { status: 'idle' });
  assert.equal(state.auditEvents.length, 0);

  now = new Date('2026-07-16T10:00:05.000Z');
  await assert.rejects(consumer.runOnce(context.workspaceId), canonical.quoteError);
  state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'failed');
  assert.equal(state.outbox[0]?.attemptCount, 2);
  assert.equal(state.auditEvents[0]?.errorCode, 'CORE_TEMPORARILY_UNAVAILABLE');
  assert.deepEqual(state.outbox[0]?.attemptEvents, [
    firstAttempt,
    {
      attemptNo: 2,
      backoffMs: 0,
      errorCode: 'CORE_TEMPORARILY_UNAVAILABLE',
      maxAttempts: 2,
      outcome: 'failed',
      retryable: true,
      startedAt: '2026-07-16T10:00:05.000Z',
    },
  ]);
});

test('audits a permanent canonical failure without retrying', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(repository, generationItem());
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteError = new CanonicalGenerationError(
    'CORE_CAPABILITY_REVOKED',
    'Core capability was revoked.',
    { retryable: false },
  );
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });

  await assert.rejects(consumer.runOnce(context.workspaceId), canonical.quoteError);
  const state = repository.snapshot(context.workspaceId);
  assert.equal(state.outbox[0]?.status, 'failed');
  assert.equal(state.outbox[0]?.attemptCount, 1);
  assert.equal(state.auditEvents[0]?.errorCode, 'CORE_CAPABILITY_REVOKED');
  assert.deepEqual(state.outbox[0]?.attemptEvents, [
    {
      attemptNo: 1,
      backoffMs: 0,
      errorCode: 'CORE_CAPABILITY_REVOKED',
      maxAttempts: 3,
      outcome: 'failed',
      retryable: false,
      startedAt: '2026-07-16T10:00:00.000Z',
    },
  ]);
});

test('preserves a retry attempt after a later attempt succeeds', async () => {
  const repository = new MemoryCanvasAgentRepository();
  await seedGeneration(repository, generationItem());
  const canonical = new RecordedCanonicalGeneration();
  canonical.quoteError = new CanonicalGenerationError(
    'CORE_TEMPORARILY_UNAVAILABLE',
    'Core is temporarily unavailable.',
    { retryable: true },
  );
  let now = new Date('2026-07-16T10:00:00.000Z');
  const consumer = new CanvasAgentGenerationConsumer(repository, canonical, {
    clock: () => now,
    retryDelayMs: 5_000,
  });

  await assert.rejects(consumer.runOnce(context.workspaceId), canonical.quoteError);
  canonical.quoteError = undefined;
  now = new Date('2026-07-16T10:00:05.000Z');
  assert.equal(
    (await consumer.runOnce(context.workspaceId)).status,
    'submitted',
  );

  assert.deepEqual(
    repository.snapshot(context.workspaceId).outbox[0]?.attemptEvents,
    [
      {
        attemptNo: 1,
        backoffMs: 5_000,
        errorCode: 'CORE_TEMPORARILY_UNAVAILABLE',
        maxAttempts: 3,
        outcome: 'retry',
        retryable: true,
        startedAt: '2026-07-16T10:00:00.000Z',
      },
      {
        attemptNo: 2,
        backoffMs: 0,
        maxAttempts: 3,
        outcome: 'submitted',
        retryable: false,
        startedAt: '2026-07-16T10:00:05.000Z',
      },
    ],
  );
});

class RecordedCanonicalGeneration implements CanvasAgentCanonicalGenerationPort {
  readonly readSetValidations: Array<{
    assetGrantRevisions: Record<string, string>;
    assetVersions: Record<string, string>;
    inputAssets: AgentGenerationOutboxItem['inputAssets'];
    projectId: string;
  }> = [];
  readonly quotes: CanvasAgentCanonicalGenerationInput[] = [];
  readonly submissions: Array<
    CanvasAgentCanonicalGenerationInput & { quoteId: string }
  > = [];
  readonly jobs = new Map<string, { jobId: string }>();
  quoteOverride: Partial<
    Awaited<ReturnType<CanvasAgentCanonicalGenerationPort['quote']>>
  > = {};
  quoteError?: CanonicalGenerationError;
  readSetOverride?: {
    assetGrantRevisions: Record<string, string>;
    assetVersions: Record<string, string>;
  };

  async validateReadSet(
    _context: typeof context,
    input: {
      assetGrantRevisions: Record<string, string>;
      assetVersions: Record<string, string>;
      inputAssets: AgentGenerationOutboxItem['inputAssets'];
      projectId: string;
    },
  ) {
    this.readSetValidations.push(structuredClone(input));
    return structuredClone(
      this.readSetOverride ?? {
        assetGrantRevisions: input.assetGrantRevisions,
        assetVersions: input.assetVersions,
      },
    );
  }

  async quote(
    _context: typeof context,
    input: CanvasAgentCanonicalGenerationInput,
  ) {
    this.quotes.push(structuredClone(input));
    if (this.quoteError) throw this.quoteError;
    return {
      capabilityRevision: input.capabilityRevision,
      costMicros: 500_000,
      dispatchRevision: input.dispatchRevision,
      generationCount: 1,
      quoteId: 'core-quote-1',
      quotaQuoteId: input.quotaQuote.id,
      quotaQuoteRevision: input.quotaQuote.revision,
      ...this.quoteOverride,
    };
  }

  async submit(
    _context: typeof context,
    input: CanvasAgentCanonicalGenerationInput & { quoteId: string },
  ) {
    this.submissions.push(structuredClone(input));
    let job = this.jobs.get(input.idempotencyKey);
    if (!job) {
      job = { jobId: 'core-job-1' };
      this.jobs.set(input.idempotencyKey, job);
    }
    return structuredClone(job);
  }
}

async function agentOutbox() {
  const repository = new MemoryCanvasAgentRepository([
    {
      assetVersions: {},
      edges: [],
      nodes: [{ data: { text: 'before' }, id: 'text-1', kind: 'text' }],
      projectId: 'project-1',
      revision: 1,
      workspaceId: context.workspaceId,
    },
  ]);
  const agent = new CanvasAgentApplicationService(repository, {
    authorization,
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
    generationOutbox: {
      revisions: { 'image.generate': 'canvas-generation-v1' },
    },
    nonce: () => 'agent-generation-nonce',
    planner: {
      async plan() {
        return [
          {
            operation: 'image.generate' as const,
            prompt: 'Create one manicure image',
            inputAssets: [],
            tool: 'run_generation' as const,
          },
        ];
      },
    },
  });
  const plan = await agent.plan(context, {
    intent: 'Create an image',
    maxCostMicros: 1_000_000,
    maxGenerationCount: 1,
    projectId: 'project-1',
    sessionId: 'session-1',
  });
  const confirmation = await agent.confirm(context, {
    planId: plan.id,
    sessionId: 'session-1',
  });
  await agent.apply(context, {
    credentialId: confirmation.credentialId,
    expectedRevision: 1,
    projectId: 'project-1',
    sessionId: 'session-1',
  });
  return repository;
}

function generationItem(
  overrides: Partial<AgentGenerationOutboxItem> = {},
): AgentGenerationOutboxItem {
  return {
    attemptCount: 0,
    attemptEvents: [],
    assetGrantRevisions: {},
    assetVersions: {},
    availableAt: '2026-07-16T10:00:00.000Z',
    batchId: 'agent-generation-batch-1',
    capabilityRevision: 'capability:run_generation',
    createdAt: '2026-07-16T10:00:00.000Z',
    dispatchRevision: 'canonical-generation-v1',
    id: 'agent-outbox-1',
    idempotencyKey: 'agent-generation-1',
    inputAssets: [],
    operation: 'image.generate',
    projectId: 'project-1',
    prompt: 'Create one image',
    quotaQuote: { id: 'quota-1', revision: 'quota-v1' },
    revisionId: 'agent-revision-1',
    status: 'pending',
    userId: context.userId,
    workspaceId: context.workspaceId,
    ...overrides,
  };
}

async function seedGeneration(
  repository: MemoryCanvasAgentRepository,
  item: AgentGenerationOutboxItem,
) {
  await repository.transact(context.workspaceId, (state) => {
    state.outbox.push(item);
    state.generationBatches.push({
      id: item.batchId,
      maxCostMicros: 1_000_000,
      maxGenerationCount: 1,
      reservations: [],
    });
  });
}
