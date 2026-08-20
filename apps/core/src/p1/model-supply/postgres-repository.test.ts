import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { RecordedAdapterRouter } from './adapters.js';
import {
  CatalogRevisionRegistry,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import {
  ModelSupplyApplicationService,
} from './index.js';
import {
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
} from './foundation-module.js';
import type { ModelSupplyResult } from './ledger-contracts.js';
import { PostgresModelSupplyRepository } from './postgres-repository.js';
import { PostgresCanonicalVideoWorkflowSchema } from './video-workflow-canonical-postgres.js';

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

  before(async () => {
    await repository.migrate();
    await new PostgresOperationsRepository(pool).migrate();
    await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
  });

  after(async () => {
    for (const scopedWorkspaceId of [
      workspaceId,
      otherWorkspaceId,
      qualityWorkspaceId,
      catalogCasWorkspaceId,
    ]) {
      await pool.query(
        `DELETE FROM p1_creative_assets
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [scopedWorkspaceId],
      );
      await pool.query(
        `DELETE FROM p1_creative_jobs
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [scopedWorkspaceId],
      );
      await pool.query(
        `DELETE FROM p1_content_tasks
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [scopedWorkspaceId],
      );
    }
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
            catalogModelId: 'llm-openai',
            executionChannelId: 'channel-openai-direct',
            pricingTier: 'standard',
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
      prices: [{
        id: 'image-price-v2',
        catalogModelId: 'gpt-image-2',
        executionChannelId: 'channel-openai-image-managed',
        pricingTier: 'standard' as const,
        currency: 'CNY' as const,
        amount: 1,
        revision: 2,
      }],
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

  it('persists Day-0 platform origin without projecting it as a merchant default', async () => {
    await repository.setWorkspaceDefault(
      workspaceId,
      'copy.generate',
      'llm-domestic',
      {
        origin: 'platform_default',
        platformConfigRevision: 'admin-config:31',
      },
    );

    const restarted = new PostgresModelSupplyRepository(pool);
    assert.deepEqual(
      await restarted.getPreferences(
        workspaceId,
        'owner-platform-origin',
        'copy.generate',
      ),
      {
        provisionedPlatformDefault: {
          catalogModelId: 'llm-domestic',
          configRevision: 'admin-config:31',
        },
        favorites: [],
        recent: [],
      },
    );
  });

  it('persists quality events', async () => {
    await repository.saveQualityEvent(workspaceId, {
      outcome: 'adopted_directly',
      catalogModelId: 'llm-openai',
      promptRevision: 'prompt-v1',
      exampleSetRevision: 'examples-v1',
      scenario: '门店项目',
    });
    assert.equal((await repository.listQualityEvents(workspaceId)).length, 1);

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
            catalogModelId: 'llm-openai',
            executionChannelId: 'channel-openai-direct',
            pricingTier: 'standard',
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
});
