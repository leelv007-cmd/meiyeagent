import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  OperationsApplicationService,
  PostgresOperationsRepository,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  type CreativeExecutionContract,
} from '../operations/index.js';
import { projectBriefTrigger } from './brief-trigger-projection.js';
import { MemoryBriefConfirmationRepository } from './brief-confirmation-repository.js';
import { CreationExperienceBriefSubmissionGate } from './brief-submission-gate.js';
import {
  PostgresBriefRevisionContextRepository,
  briefIntentRevisionId,
  briefSourceRevisionId,
} from './postgres-brief-revision-context.js';

const connectionString = process.env.TEST_DATABASE_URL;

const contract: CreativeExecutionContract = {
  aigcLabelEnabled: true,
  catalogModelId: 'llm-atomic',
  catalogRevision: 'model-catalog@1',
  currency: 'CNY',
  dataClass: [],
  estimatedAmount: 1,
  operation: 'copy.generate',
  outputCount: 3,
  outputLabel: '3 条文案候选',
  quoteAcceptedAt: '2026-07-20T10:00:00.000Z',
  quoteRevision: 'quote@1',
  watermarkEnabled: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function settledWithin(promise: Promise<unknown>, milliseconds = 100) {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
}

async function createFixture() {
  const adminPool = new Pool({ connectionString });
  const schema = `brief_atomic_${randomUUID().replaceAll('-', '')}`;
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  });
  await pool.query(`
    CREATE TABLE "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE workspace_memberships (
      workspace_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  const suffix = randomUUID();
  const workspaceId = `workspace-${suffix}`;
  const userId = `user-${suffix}`;
  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1, 'Owner', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, 'Workspace')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id)
       VALUES ($1, $2)`,
    [workspaceId, userId],
  );

  const operations = new PostgresOperationsRepository(pool);
  const contexts = new PostgresBriefRevisionContextRepository(pool);
  await operations.migrate();
  await contexts.migrate();
  const briefContextId = `brief-${suffix}`;
  const intent = '为门店写三条夏日文案';
  const initial = await contexts.syncBriefRevisionContext(
    workspaceId,
    {
      briefContextId,
      draftRevisionId: 'draft@1',
      intentRevisionId: briefIntentRevisionId(intent),
      lensId: 'copy',
      projectionFacts: {
        aspectRatio: null,
        crossPlatform: false,
        deliverableCount: 1,
        durationSeconds: null,
        highRiskFacts: [],
        imageCount: 0,
        outputCount: 3,
        restrictedAssets: false,
      },
      quoteId: 'quote-atomic',
      recipeRevisionId: null,
      sourceRevisionId: briefSourceRevisionId([]),
      surfaceRevisionId: null,
    },
    null,
  );
  const currentRevisions = {
    draftRevisionId: initial.draftRevisionId,
    lensId: initial.lensId,
    modelRevisionId: contract.catalogRevision,
    quoteRevisionId: contract.quoteRevision,
    recipeRevisionId: initial.recipeRevisionId,
    sourceRevisionId: initial.sourceRevisionId,
    surfaceRevisionId: initial.surfaceRevisionId,
  };
  const projection = projectBriefTrigger({
    currentRevisions,
    deliverableCount: initial.projectionFacts.deliverableCount,
    deliverableKind: 'copy',
    lensId: 'copy',
  });
  await contexts.recordBriefProjection(
    workspaceId,
    briefContextId,
    initial.revision,
    {
      bindRevisions: projection.bindRevisions,
      requiresBrief: projection.requiresBrief,
    },
  );
  const gate = new CreationExperienceBriefSubmissionGate(
    contexts,
    new MemoryBriefConfirmationRepository(),
    {
      async resolveCurrentRevisions() {
        const current = await contexts.getBriefRevisionContext(
          workspaceId,
          briefContextId,
        );
        assert.ok(current);
        return {
          ...currentRevisions,
          draftRevisionId: current.draftRevisionId,
          lensId: current.lensId,
          recipeRevisionId: current.recipeRevisionId,
          sourceRevisionId: current.sourceRevisionId,
          surfaceRevisionId: current.surfaceRevisionId,
        };
      },
      resolveCurrentQuoteSignal() {
        return {
          amount: 1,
          catalogModelId: contract.catalogModelId,
          catalogModelRevision: contract.catalogRevision,
          extraConfirmThreshold: 20,
          quotePolicyRevision: 'quote-policy@1',
          quoteRevisionId: contract.quoteRevision,
        };
      },
    },
  );
  const service = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    creationExecutor: {
      async inspect() {},
      async submit() {
        return {
          copyCandidates: [
            { body: '候选一', title: '标题一' },
            { body: '候选二', title: '标题二' },
            { body: '候选三', title: '标题三' },
          ],
          providerJobId: 'provider-atomic',
          routeSnapshotId: 'route-atomic',
          status: 'completed' as const,
        };
      },
      async verify(input) {
        return { ...input, status: 'unknown' as const };
      },
    },
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const context = {
    actor: 'owner' as const,
    correlationId: `corr-${suffix}`,
    userId,
    workspaceId,
  };

  return {
    adminPool,
    briefContextId,
    context,
    contexts,
    gate,
    initial,
    intent,
    operations,
    pool,
    schema,
    service,
    async close() {
      await pool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
    },
  };
}

async function driftContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return fixture.contexts.syncBriefRevisionContext(
    fixture.context.workspaceId,
    {
      briefContextId: fixture.briefContextId,
      draftRevisionId: 'draft@2',
      intentRevisionId: briefIntentRevisionId(fixture.intent),
      lensId: 'copy',
      projectionFacts: fixture.initial.projectionFacts,
      quoteId: 'quote-atomic',
      recipeRevisionId: null,
      sourceRevisionId: briefSourceRevisionId([]),
      surfaceRevisionId: null,
    },
    fixture.initial.revision,
  );
}

test(
  'Brief context revision stays locked until creative Work commit',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    try {
      const gateEntered = deferred();
      const releaseGate = deferred();
      fixture.service.attachBriefSubmissionGate({
        async assertCurrent(input) {
          const result = await fixture.gate.assertCurrent(input);
          gateEntered.resolve();
          await releaseGate.promise;
          return result;
        },
      });
      const creating = fixture.service.createCreativeWork(fixture.context, {
        autoConfirmBrief: true,
        briefContextId: fixture.briefContextId,
        intent: fixture.intent,
        mode: 'direct',
        operation: 'copy.generate',
        sessionId: 'atomic-create-session',
        sourceReferences: [],
      });
      await gateEntered.promise;
      const drifting = driftContext(fixture);
      const driftSettledBeforeCommit = await settledWithin(drifting);
      releaseGate.resolve();
      const work = await creating;
      await drifting;
      assert.equal(driftSettledBeforeCommit, false);
      assert.equal(work.briefContextRevision, fixture.initial.revision);
    } finally {
      await fixture.close();
    }
  },
);

test(
  'Brief context revision stays locked until creative Job commit',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    try {
      fixture.service.attachBriefSubmissionGate(fixture.gate);
      const work = await fixture.service.createCreativeWork(fixture.context, {
        autoConfirmBrief: true,
        briefContextId: fixture.briefContextId,
        intent: fixture.intent,
        mode: 'direct',
        operation: 'copy.generate',
        sessionId: 'atomic-submit-session',
        sourceReferences: [],
      });
      const gateEntered = deferred();
      const releaseGate = deferred();
      fixture.service.attachBriefSubmissionGate({
        async assertCurrent(input) {
          const result = await fixture.gate.assertCurrent(input);
          gateEntered.resolve();
          await releaseGate.promise;
          return result;
        },
      });
      const submitting = fixture.service.submitCreativeWork(
        fixture.context,
        work.id,
        contract,
        'atomic-submit',
      );
      await gateEntered.promise;
      const drifting = driftContext(fixture);
      const driftSettledBeforeCommit = await settledWithin(drifting);
      releaseGate.resolve();
      await submitting;
      await drifting;
      assert.equal(driftSettledBeforeCommit, false);
      const state = await fixture.operations.loadWorkspace(
        fixture.context.workspaceId,
      );
      assert.equal(
        state?.creativeJobs[0]?.briefContextRevision,
        fixture.initial.revision,
      );
    } finally {
      await fixture.close();
    }
  },
);
