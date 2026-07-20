import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { RecordedAdapterRouter } from './adapters.js';
import {
  CatalogRevisionRegistry,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import {
  ModelSupplyApplicationService,
  VersionedHumanCalibratedVideoQualityScorer,
  RecordedProviderExecutionPort,
  RecordedVideoCompositionPort,
  type ProviderExecutionPort,
  type VideoQualityScoringPort,
} from './index.js';
import {
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
} from './foundation-module.js';
import type { ModelSupplyResult } from './ledger-contracts.js';
import {
  PersistentContentWorkflowRunner,
  PostgresDurableVideoWorkflowStore,
  PostgresModelSupplyRepository,
} from './postgres-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function persistedJob(input: {
  jobId: string;
  operation: 'copy.generate' | 'image.generate';
  createdAt: string;
  deploymentId: string;
}): ModelSupplyResult {
  const catalogModelId =
    input.operation === 'image.generate' ? 'model-image' : 'model-copy';
  const attempt = {
    id: `attempt:${input.jobId}`,
    jobId: input.jobId,
    catalogModelId,
    deploymentId: input.deploymentId,
    acceptance: 'accepted' as const,
    status: 'completed' as const,
    createdAt: input.createdAt,
  };
  return {
    jobId: input.jobId,
    operation: input.operation,
    status: 'completed',
    snapshot: {
      id: `snapshot:${input.jobId}`,
      catalogRevisionId: 'catalog:r1',
      requestedSelection: { mode: 'fixed' },
      candidateCatalogModelIds: [catalogModelId],
      actualCatalogModelId: catalogModelId,
      deploymentId: input.deploymentId,
      policyRevision: 'policy:r1',
      priceRevision: 'price:r1',
      credentialMode: 'platform',
      credentialVersion: 'credential:r1',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: [],
      createdAt: input.createdAt,
    },
    attempt,
    attempts: [attempt],
    usage: { id: `usage:${input.jobId}`, status: 'committed', quantity: 1 },
    providerCost: {
      id: `cost:${input.jobId}`,
      status: 'observed',
      amount: 0.01,
      currency: 'CNY',
      usage: {},
    },
    providerCosts: [],
  };
}

describe('Postgres model supply repository', { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' }, () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresModelSupplyRepository(pool);
  const workspaceId = `workspace-${randomUUID()}`;
  const otherWorkspaceId = `workspace-${randomUUID()}`;
  const qualityWorkspaceId = `workspace-${randomUUID()}`;
  const catalogCasWorkspaceId = `workspace-${randomUUID()}`;
  const paginationWorkspaceId = `workspace-${randomUUID()}`;
  const timingMigrationWorkspaceId = `workspace-${randomUUID()}`;

  before(async () => repository.migrate());

  after(async () => {
    await repository.deleteWorkspaceForTest(workspaceId);
    await repository.deleteWorkspaceForTest(otherWorkspaceId);
    await repository.deleteWorkspaceForTest(qualityWorkspaceId);
    await repository.deleteWorkspaceForTest(catalogCasWorkspaceId);
    await repository.deleteWorkspaceForTest(paginationWorkspaceId);
    await repository.deleteWorkspaceForTest(timingMigrationWorkspaceId);
    await pool.end();
  });

  it('persists catalog revisions and a workspace-scoped generation read model without duplicating Foundation ledgers', async () => {
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: ['gpt-image-2-managed'],
    });
    const revision = new CatalogRevisionRegistry().createDraft({
      models: createDefaultCatalogModels(),
      deployments,
      capabilities: [{ id: 'image-cap-v1', operation: 'image.generate', revision: 1 }],
      prices: [{ id: 'image-price-v1', currency: 'CNY', amount: 1, revision: 1 }],
      routes: [{ id: 'image-route-v1', operation: 'image.generate', revision: 1 }],
    });
    await repository.saveCatalogRevision(workspaceId, revision);

    const service = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments,
      execution: new RecordedAdapterRouter(),
    });
    const result = await service.submit({
      workspaceId,
      actorId: 'owner-a',
      idempotencyKey: 'pg-image-1',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
      dataClass: [],
      prompt: '门店环境图',
      input: { width: 1024, height: 1024 },
    });
    await repository.saveResult(workspaceId, result);

    assert.equal((await repository.getJob(workspaceId, result.jobId))?.status, 'completed');
    assert.equal(await repository.getJob(otherWorkspaceId, result.jobId), null);
  });

  it('persists immutable activation probe evidence across repository restarts', async () => {
    const run = {
      actorId: 'admin-a',
      catalogModelId: 'llm-openai',
      configurationRevision: 'f'.repeat(64),
      correlationId: 'corr-activation-probe',
      createdAt: '2026-07-15T00:00:00.000Z',
      deploymentId: 'openai-direct-recorded',
      id: `activation-probe-${'a'.repeat(28)}`,
      latencyMs: 321,
      operation: 'copy.generate' as const,
      outcome: 'passed' as const,
      outputDigest: 'b'.repeat(64),
      providerCost: {
        amount: 0.01,
        currency: 'CNY' as const,
        status: 'observed' as const,
        usage: { inputTokens: 10, outputTokens: 20 },
      },
    };
    await repository.saveActivationProbeRun(workspaceId, run);
    await repository.saveActivationProbeRun(workspaceId, run);

    const restarted = new PostgresModelSupplyRepository(pool);
    assert.deepEqual(
      await restarted.getActivationProbeRun(workspaceId, run.id),
      run,
    );
    assert.equal(
      (await restarted.listActivationProbeRuns(workspaceId)).length,
      1,
    );
    assert.equal(
      await restarted.getActivationProbeRun(otherWorkspaceId, run.id),
      null,
    );
  });

  it('filters, sorts, and paginates generation jobs in PostgreSQL', async () => {
    await Promise.all([
      repository.saveResult(
        paginationWorkspaceId,
        persistedJob({
          jobId: 'image-a-old',
          operation: 'image.generate',
          createdAt: '2026-07-20T01:00:00.000Z',
          deploymentId: 'deployment-image-a',
        }),
      ),
      repository.saveResult(
        paginationWorkspaceId,
        persistedJob({
          jobId: 'copy-newest',
          operation: 'copy.generate',
          createdAt: '2026-07-20T03:00:00.000Z',
          deploymentId: 'deployment-copy-a',
        }),
      ),
      repository.saveResult(
        paginationWorkspaceId,
        persistedJob({
          jobId: 'image-z-new',
          operation: 'image.generate',
          createdAt: '2026-07-20T02:00:00.000Z',
          deploymentId: 'deployment-image-b',
        }),
      ),
    ]);

    const page = await repository.listJobs(paginationWorkspaceId, {
      page: 1,
      pageSize: 1,
      sort: 'latencyMs',
      dir: 'asc',
      operation: 'image.generate',
    });

    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.jobId, 'image-z-new');
    assert.equal(typeof page.items[0]?.endedAt, 'string');
    assert.equal(typeof page.items[0]?.latencyMs, 'number');
    assert.ok(Date.parse(page.items[0]?.endedAt ?? '') > Date.parse('2026-07-20T02:00:00.000Z'));
    assert.ok((page.items[0]?.latencyMs ?? -1) > 0);
    assert.deepEqual(page.facets.operations, [
      'copy.generate',
      'image.generate',
    ]);
  });

  it('backfills durable timing facts for terminal jobs created before timing columns', async () => {
    const legacy = persistedJob({
      jobId: 'legacy-terminal-job',
      operation: 'copy.generate',
      createdAt: '2026-07-20T05:00:00.000Z',
      deploymentId: 'deployment-copy-a',
    });
    await pool.query(
      `INSERT INTO model_generation_jobs
         (workspace_id, job_id, status, result, created_at, ended_at, latency_ms)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, NULL, NULL)`,
      [
        timingMigrationWorkspaceId,
        legacy.jobId,
        legacy.status,
        JSON.stringify(legacy),
        '2026-07-20T05:00:02.500Z',
      ]
    );

    await repository.migrate();
    const page = await repository.listJobs(timingMigrationWorkspaceId, {
      page: 1,
      pageSize: 20,
      sort: 'latencyMs',
      dir: 'asc',
    });

    assert.equal(page.items[0]?.endedAt, '2026-07-20T05:00:02.500Z');
    assert.equal(page.items[0]?.latencyMs, 2_500);
  });

  it('publishes exactly one catalog when concurrent admins share a stale head', async () => {
    const registry = new CatalogRevisionRegistry();
    const publish = (revision: number) => {
      const draft = registry.createDraft({
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments(),
        capabilities: [],
        prices: [
          {
            id: `catalog-cas-price-${revision}`,
            currency: 'CNY',
            amount: revision,
            revision,
          },
        ],
        routes: [],
      });
      return registry.publish(registry.enable(draft.id).id);
    };
    const candidates = [publish(1), publish(2)];

    const results = await Promise.allSettled(
      candidates.map((revision) =>
        repository.setCurrentPublishedCatalogRevision(
          catalogCasWorkspaceId,
          revision,
          null,
        ),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.reason instanceof P1DomainError &&
        rejected[0].reason.code === 'IDEMPOTENCY_CONFLICT',
    );
    const head = await repository.getCurrentPublishedCatalogRevision(
      catalogCasWorkspaceId,
    );
    assert.ok(candidates.some((candidate) => candidate.id === head?.id));
    assert.equal(
      (await repository.listCatalogRevisions(catalogCasWorkspaceId)).length,
      1,
    );
  });

  it('restores the current published catalog and user preferences after a control-plane restart', async () => {
    const application = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments(),
      execution: new RecordedAdapterRouter(),
      resultSink: repository,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      repository,
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      adminActorIds: ['admin-a'],
    });
    const context = {
      workspaceId,
      userId: 'admin-a',
      correlationId: 'catalog-pg',
    };
    const catalog = {
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['gpt-image-2-managed'],
        activationEvidenceStatus: 'recorded' as const,
      }),
      capabilities: [{ id: 'image-v2', operation: 'image.generate' as const, revision: 2 }],
      prices: [{ id: 'image-price-v2', currency: 'CNY' as const, amount: 1, revision: 2 }],
      routes: [{ id: 'image-route-v2', operation: 'image.generate' as const, revision: 2 }],
    };
    const execute = (action: string, payload: Record<string, unknown>) =>
      module.execute({ context, idempotencyKey: action, input: { action, payload } });
    const draft = (await execute('catalog_create_draft', { catalog })) as { id: string };
    const enabled = (await execute('catalog_enable', { revisionId: draft.id })) as { id: string };
    const published = (await execute('catalog_publish', {
      revisionId: enabled.id,
      expectedHeadRevisionId: null,
    })) as { id: string };
    await execute('set_workspace_default', {
      operation: 'image.generate',
      modelId: 'gpt-image-2',
    });
    await execute('set_user_default', {
      operation: 'image.generate',
      modelId: 'gpt-image-2',
    });
    await execute('set_favorite', {
      operation: 'image.generate',
      modelId: 'gpt-image-2',
      favorite: true,
    });
    await execute('record_recent', {
      operation: 'image.generate',
      modelId: 'gpt-image-2',
    });

    const restartedApplication = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments(),
      execution: new RecordedAdapterRouter(),
    });
    const restarted = new ModelSupplyControlPlaneService({
      application: restartedApplication,
      repository: new PostgresModelSupplyRepository(pool),
    });
    assert.equal(await restarted.initialize(workspaceId), published.id);
    assert.equal(
      (await restarted.getCatalog(workspaceId, 'image.generate')).revisionId,
      published.id,
    );
    assert.deepEqual(
      await restarted.getPreferences(workspaceId, context.userId, 'image.generate'),
      {
        workspaceDefault: 'gpt-image-2',
        userDefault: 'gpt-image-2',
        favorites: ['gpt-image-2'],
        recent: ['gpt-image-2'],
      },
    );
  });

  it('persists quality events and restores composed video workflow across runner instances', async () => {
    await repository.saveQualityEvent(workspaceId, {
      outcome: 'adopted_directly',
      catalogModelId: 'llm-openai',
      promptRevision: 'prompt-v1',
      exampleSetRevision: 'examples-v1',
      scenario: '门店项目',
    });
    assert.equal((await repository.listQualityEvents(workspaceId)).length, 1);

    const deployments = createDefaultDeployments({
      activatedDeploymentIds: ['seedance-2-direct'],
    });
    const service = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments,
      execution: new RecordedAdapterRouter(),
    });
    const store = new PostgresDurableVideoWorkflowStore(pool, workspaceId);
    const runner = new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      store
    );
    const workflow = await runner.createVideoWorkflow({
      workspaceId,
      actorId: 'owner-a',
      dataClass: ['pii', 'contains_face'],
      referenceAssetIds: ['asset-storefront'],
      aigcLabelEnabled: true,
      storyboardRevision: 'story-v1',
      catalogModelId: 'seedance-2',
      shots: ['门头', '项目细节'],
    });
    await runner.confirmVideoWorkflow(workflow.id);
    const firstReview = await runner.runVideoWorkflow(workflow.id);
    assert.equal(firstReview.status, 'awaiting_quality_review');
    await runner.selectVideoCandidate({
      workflowId: workflow.id,
      shotId: firstReview.shots[0]!.id,
      candidateIndex: 0,
      workspaceId,
      actorId: 'owner-a',
      correlationId: `restore-${firstReview.shots[0]!.id}`,
    });
    const secondReview = await runner.runVideoWorkflow(workflow.id);
    assert.equal(secondReview.status, 'awaiting_quality_review');
    await runner.selectVideoCandidate({
      workflowId: workflow.id,
      shotId: secondReview.shots[1]!.id,
      candidateIndex: 0,
      workspaceId,
      actorId: 'owner-a',
      correlationId: `restore-${secondReview.shots[1]!.id}`,
    });
    const completed = await runner.runVideoWorkflow(workflow.id);
    const resumed = await new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      store
    ).runVideoWorkflow(workflow.id);
    assert.equal(completed.status, 'completed');
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.actorId, 'owner-a');
    assert.deepEqual(resumed.dataClass, ['contains_face', 'pii']);
    assert.deepEqual(resumed.referenceAssetIds, ['asset-storefront']);
    assert.equal(resumed.aigcLabelEnabled, true);
    assert.equal(resumed.attempts.length, completed.attempts.length);
  });

  it('persists fixed evaluation cases and atomically audits prompt and catalog rollback', async () => {
    const activeDeployments = createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
    });
    const registry = new CatalogRevisionRegistry();
    const publish = (priceRevision: number) => {
      const draft = registry.createDraft({
        models: createDefaultCatalogModels(),
        deployments: activeDeployments,
        capabilities: [
          {
            id: `copy-cap-v${priceRevision}`,
            operation: 'copy.generate',
            revision: priceRevision,
          },
        ],
        prices: [
          {
            id: `copy-price-v${priceRevision}`,
            currency: 'CNY',
            amount: priceRevision,
            revision: priceRevision,
          },
        ],
        routes: [
          {
            id: `copy-route-v${priceRevision}`,
            operation: 'copy.generate',
            revision: priceRevision,
          },
        ],
      });
      return registry.publish(registry.enable(draft.id).id);
    };
    const first = publish(1);
    const second = publish(2);
    await repository.setCurrentPublishedCatalogRevision(
      qualityWorkspaceId,
      first,
      null,
    );
    await repository.setCurrentPublishedCatalogRevision(
      qualityWorkspaceId,
      second,
      first.id,
    );

    const application = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: activeDeployments,
      execution: new RecordedAdapterRouter(),
      resultSink: repository,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      repository,
    });
    const adminContext = {
      workspaceId: qualityWorkspaceId,
      userId: 'admin-a',
      correlationId: 'quality-pg',
      actor: 'admin' as const,
    };
    await controlPlane.rollbackCatalogRevision(
      adminContext,
      first.id,
      'restore catalog after regression',
    );
    await controlPlane.rollbackPromptRevision(
      adminContext,
      'beauty-copy-prompt-v0',
      'restore prompt after regression',
    );
    const run = await controlPlane.runQualityEvaluation(
      adminContext,
      { catalogModelId: 'llm-openai' },
      'quality-pg-run',
    );
    assert.equal(run.status, 'completed');
    assert.equal(run.evidenceKind, 'recorded_contract');
    assert.equal(run.summary.passed, 30);
    assert.equal(run.summary.rejectionsCaught, 10);
    assert.equal(run.promptRevision, 'beauty-copy-prompt-v0');
    assert.equal(run.catalogRevisionId, first.id);

    const restartedRepository = new PostgresModelSupplyRepository(pool);
    const restored = await restartedRepository.getQualityEvaluationRun(
      qualityWorkspaceId,
      run.id,
    );
    assert.equal(restored?.cases.length, 30);
    assert.equal(restored?.rejectionCases.length, 10);
    assert.ok(restored?.cases.every((testCase) => testCase.passed));
    assert.ok(
      restored?.cases.every(
        (testCase) =>
          testCase.evidenceKind === 'recorded_contract' &&
          testCase.activationEvidence?.status === 'recorded',
      ),
    );
    assert.ok(restored?.rejectionCases.every((testCase) => testCase.caught));
    assert.equal(
      await restartedRepository.getCurrentPromptRevision(qualityWorkspaceId),
      'beauty-copy-prompt-v0',
    );
    assert.equal(
      (await restartedRepository.getCurrentPublishedCatalogRevision(
        qualityWorkspaceId,
      ))?.id,
      first.id,
    );
    const audits = await restartedRepository.listRevisionRollbackAudits(
      qualityWorkspaceId,
    );
    assert.deepEqual(
      new Set(audits.map((audit) => audit.kind)),
      new Set(['catalog', 'prompt']),
    );
    assert.ok(
      audits.every(
        (audit) =>
          audit.actorId === adminContext.userId &&
          audit.correlationId === adminContext.correlationId,
      ),
    );
    assert.equal(
      await restartedRepository.getQualityEvaluationRun(otherWorkspaceId, run.id),
      null,
    );
  });

  it('normalizes historical quality runs before rejection fixtures existed', async () => {
    const runId = 'legacy-quality-run-v1';
    await pool.query(
      `INSERT INTO model_quality_evaluation_runs
         (workspace_id, run_id, run, created_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
      [
        qualityWorkspaceId,
        runId,
        JSON.stringify({
          id: runId,
          status: 'completed',
          datasetRevision: 'beauty-copy-eval-v1',
          promptRevision: 'beauty-copy-prompt-v1',
          exampleSetRevision: 'beauty-copy-examples-v1',
          catalogRevisionId: 'catalog-v1',
          requestedCatalogModelId: 'llm-openai',
          actualCatalogModelIds: ['llm-openai'],
          createdAt: '2026-07-01T00:00:00.000Z',
          completedAt: '2026-07-01T00:01:00.000Z',
          summary: { caseCount: 3, passed: 3, passRate: 1 },
        }),
        '2026-07-01T00:00:00.000Z',
      ],
    );
    await pool.query(
      `INSERT INTO model_quality_evaluation_cases
         (workspace_id, run_id, case_id, ordinal, result)
       VALUES ($1, $2, $3, 0, $4::jsonb)`,
      [
        qualityWorkspaceId,
        runId,
        'legacy-case-v1',
        JSON.stringify({
          id: 'legacy-case-v1',
          ordinal: 0,
          fixtureId: 'legacy-fixture-v1',
          scenario: '历史用例',
          platform: 'xiaohongshu',
          catalogModelId: 'llm-openai',
          routeSnapshotId: 'legacy-route-v1',
          passed: true,
          evaluation: { dimensionScore: 1, warnings: [] },
          candidates: [],
        }),
      ],
    );

    const restored = await repository.getQualityEvaluationRun(
      qualityWorkspaceId,
      runId,
    );
    assert.deepEqual(restored?.rejectionCases, []);
    assert.equal(restored?.evidenceKind, 'historical_unknown');
    assert.equal(restored?.cases[0]?.evidenceKind, 'historical_unknown');
    assert.equal(restored?.cases[0]?.deploymentId, 'historical-unknown');
    assert.equal(restored?.summary.rejectionCaseCount, 0);
    assert.equal(restored?.summary.rejectionsCaught, 0);
  });

  it('checkpoints each generated candidate and resumes with a fresh model service without duplicate generation', async () => {
    let executionCount = 0;
    const recorded = new RecordedAdapterRouter();
    const execution: ProviderExecutionPort = {
      async execute(request) {
        executionCount += 1;
        return recorded.execute(request);
      },
    };
    const service = () =>
      new ModelSupplyApplicationService({
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['seedance-2-direct'],
        }),
        execution,
      });
    const store = new PostgresDurableVideoWorkflowStore(pool, workspaceId);
    const interruptedScorer: VideoQualityScoringPort = {
      async score() {
        throw new Error('recorded scorer interruption');
      },
    };
    const workflowId = `checkpoint-${randomUUID()}`;
    const interrupted = new PersistentContentWorkflowRunner(
      service(),
      new RecordedVideoCompositionPort(),
      store,
      interruptedScorer,
    );
    await interrupted.createVideoWorkflow({
      workflowId,
      workspaceId,
      actorId: 'owner-a',
      dataClass: ['contains_face'],
      storyboardRevision: 'story-checkpoint-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 2 }],
    });
    await interrupted.confirmVideoWorkflow(workflowId, workspaceId);
    await assert.rejects(
      interrupted.runVideoWorkflow(workflowId, workspaceId),
      /scorer interruption/,
    );
    assert.equal(executionCount, 2);
    const checkpoint = await store.get(workflowId);
    assert.equal(checkpoint?.shots[0]?.candidates.length, 2);
    assert.ok(
      checkpoint?.shots[0]?.candidates.every(
        (candidate) => candidate.status === 'generated',
      ),
    );

    const restarted = new PersistentContentWorkflowRunner(
      service(),
      new RecordedVideoCompositionPort(),
      new PostgresDurableVideoWorkflowStore(pool, workspaceId),
      new VersionedHumanCalibratedVideoQualityScorer(),
    );
    const awaitingReview = await restarted.runVideoWorkflow(
      workflowId,
      workspaceId,
    );
    assert.equal(awaitingReview.status, 'awaiting_quality_review');
    await restarted.selectVideoCandidate({
      workflowId,
      shotId: 'opening',
      candidateIndex: 0,
      workspaceId,
      actorId: 'reviewer-pg',
      correlationId: 'review-pg-1',
    });
    const completed = await restarted.runVideoWorkflow(workflowId, workspaceId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.shots[0]?.candidates.length, 2);
    assert.deepEqual(completed.shots[0]?.selectionAudit, {
      selectedBy: 'reviewer-pg',
      correlationId: 'review-pg-1',
      selectedAt: completed.shots[0]?.selectionAudit?.selectedAt,
      source: 'human_quality_review',
    });
    assert.match(
      completed.shots[0]?.selectionAudit?.selectedAt ?? '',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    assert.equal(executionCount, 2);
    const pendingWorkflowId = `pending-${randomUUID()}`;
    await restarted.createVideoWorkflow({
      workflowId: pendingWorkflowId,
      workspaceId,
      actorId: 'owner-a',
      dataClass: [],
      storyboardRevision: 'story-pending-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'pending', prompt: '待确认分镜', candidatesPerShot: 1 }],
    });
    assert.equal(
      (await store.findLatest(workspaceId, 'owner-a'))?.id,
      pendingWorkflowId,
    );
    await restarted.cancelVideoWorkflow(pendingWorkflowId, workspaceId);
    assert.equal(
      (await store.findLatest(workspaceId, 'owner-a'))?.id,
      pendingWorkflowId,
    );
    await restarted.createVideoWorkflow({
      workflowId: `other-actor-${randomUUID()}`,
      workspaceId,
      actorId: 'owner-b',
      dataClass: [],
      storyboardRevision: 'story-other-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'other', prompt: '其他用户分镜', candidatesPerShot: 1 }],
    });
    assert.equal(
      (await store.findLatest(workspaceId, 'owner-a'))?.id,
      pendingWorkflowId,
    );
    await assert.rejects(
      store.findLatest(otherWorkspaceId, 'owner-a'),
      /workspace does not match/,
    );
    assert.equal(
      await new PostgresDurableVideoWorkflowStore(pool, otherWorkspaceId).get(workflowId),
      undefined,
    );
  });

  it('recovers the latest storyboard version before a later parent update', async () => {
    const store = new PostgresDurableVideoWorkflowStore(pool, workspaceId);
    const runner = new PersistentContentWorkflowRunner(
      new ModelSupplyApplicationService({
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['seedance-2-direct'],
        }),
        execution: new RecordedAdapterRouter(),
      }),
      new RecordedVideoCompositionPort(),
      store,
    );
    const actorId = `lineage-owner-${randomUUID()}`;
    const workId = `lineage-work-${randomUUID()}`;
    const parent = await runner.createVideoWorkflow({
      workflowId: `lineage-parent-${randomUUID()}`,
      workspaceId,
      actorId,
      workId,
      dataClass: [],
      storyboardRevision: 'story-lineage-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    const derived = await runner.createVideoWorkflow({
      workflowId: `lineage-derived-${randomUUID()}`,
      workspaceId,
      actorId,
      workId,
      derivedFromWorkflowId: parent.id,
      dataClass: [],
      storyboardRevision: parent.storyboardRevision,
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    await runner.confirmVideoWorkflow(parent.id, workspaceId);
    await runner.confirmVideoWorkflow(derived.id, workspaceId);
    await runner.runVideoWorkflow(derived.id, workspaceId);

    await runner.createVideoWorkflow({
      workflowId: `lineage-other-actor-${randomUUID()}`,
      workspaceId,
      actorId: `${actorId}-other`,
      workId,
      dataClass: [],
      storyboardRevision: 'story-lineage-other-actor',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '其他用户分镜', candidatesPerShot: 1 }],
    });

    assert.equal(
      (await store.findLatest(workspaceId, actorId, workId))?.id,
      derived.id,
    );
    assert.deepEqual(
      new Set((await store.list(workspaceId, actorId)).map((item) => item.id)),
      new Set([parent.id, derived.id]),
    );
    await assert.rejects(
      store.list(otherWorkspaceId, actorId),
      /workspace does not match/,
    );
  });

  it('restores a persisted video cancellation intent after runner restart', async () => {
    const service = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['seedance-2-direct'],
      }),
      execution: new RecordedAdapterRouter(),
    });
    const workflowId = `cancel-restart-${randomUUID()}`;
    const first = new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    );
    await first.createVideoWorkflow({
      workflowId,
      workspaceId,
      actorId: 'owner-a',
      dataClass: [],
      storyboardRevision: 'story-cancel-restart-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    await first.confirmVideoWorkflow(workflowId, workspaceId);
    const requested = await first.requestVideoWorkflowCancel(
      workflowId,
      workspaceId,
    );
    assert.equal(requested.status, 'cancel_requested');

    const restarted = new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    );
    assert.equal(
      (await restarted.getVideoWorkflow(workflowId, workspaceId)).status,
      'cancel_requested',
    );
    await assert.rejects(
      restarted.runVideoWorkflow(workflowId, workspaceId),
      /cancel/i,
    );
    assert.equal(
      (await restarted.cancelVideoWorkflow(workflowId, workspaceId)).status,
      'cancelled',
    );
  });

  it('fences a PostgreSQL runner when cancellation arrives during provider execution', async () => {
    let providerStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const recorded = new RecordedProviderExecutionPort();
    const service = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['seedance-2-direct'],
      }),
      execution: {
        async execute(request) {
          providerStarted();
          await released;
          return recorded.execute(request);
        },
      },
    });
    const workflowId = `cancel-pg-race-${randomUUID()}`;
    const first = new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    );
    await first.createVideoWorkflow({
      workflowId,
      workspaceId,
      actorId: 'owner-a',
      dataClass: [],
      storyboardRevision: 'story-cancel-pg-race-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    await first.confirmVideoWorkflow(workflowId, workspaceId);

    const activeRun = first.runVideoWorkflow(workflowId, workspaceId);
    await started;
    const restarted = new PersistentContentWorkflowRunner(
      service,
      new RecordedVideoCompositionPort(),
      new PostgresDurableVideoWorkflowStore(pool, workspaceId),
    );
    assert.equal(
      (await restarted.requestVideoWorkflowCancel(workflowId, workspaceId))
        .status,
      'cancel_requested',
    );
    releaseProvider();
    await assert.rejects(activeRun, /cancel/i);
    assert.equal(
      (await restarted.getVideoWorkflow(workflowId, workspaceId)).status,
      'cancel_requested',
    );
    assert.equal(
      (await restarted.cancelVideoWorkflow(workflowId, workspaceId)).status,
      'cancelled',
    );
  });
});
