import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { CatalogRevisionRegistry } from './catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  type ModelSupplyControlPlaneRepository,
} from './foundation-module.js';
import type { ModelSupplyResult } from './ledger-contracts.js';
import { PostgresModelSupplyRepository } from './postgres-repository.js';

interface RepositoryFixture {
  cleanup(): Promise<void>;
  otherWorkspaceId: string;
  repository: ModelSupplyControlPlaneRepository;
  workspaceId: string;
}

function completedResult(input: {
  createdAt: string;
  jobId: string;
  operation: 'copy.generate' | 'image.generate';
}): ModelSupplyResult {
  const catalogModelId =
    input.operation === 'image.generate' ? 'model-image' : 'model-copy';
  const attempt = {
    acceptance: 'accepted' as const,
    catalogModelId,
    createdAt: input.createdAt,
    deploymentId: `deployment-${catalogModelId}`,
    id: `attempt:${input.jobId}`,
    jobId: input.jobId,
    status: 'completed' as const,
  };
  return {
    attempt,
    attempts: [attempt],
    endedAt: input.createdAt,
    jobId: input.jobId,
    latencyMs: 0,
    operation: input.operation,
    providerCost: {
      amount: 0.01,
      currency: 'CNY',
      id: `cost:${input.jobId}`,
      status: 'observed',
      usage: {},
    },
    providerCosts: [],
    snapshot: {
      actualCatalogModelId: catalogModelId,
      candidateCatalogModelIds: [catalogModelId],
      catalogRevisionId: 'catalog:r1',
      createdAt: input.createdAt,
      credentialMode: 'platform',
      credentialVersion: 'credential:r1',
      dataClass: [],
      deploymentId: attempt.deploymentId,
      fallbackConsent: false,
      id: `snapshot:${input.jobId}`,
      policyRevision: 'policy:r1',
      priceRevision: 'price:r1',
      reason: 'fixed_selection',
      requestedSelection: { mode: 'fixed' },
    },
    status: 'completed',
    usage: {
      id: `usage:${input.jobId}`,
      quantity: 1,
      status: 'committed',
    },
  };
}

function publishedCatalogRevision() {
  const registry = new CatalogRevisionRegistry();
  const draft = registry.createDraft({
    capabilities: [],
    deployments: [],
    models: [],
    prices: [],
    routes: [],
  });
  return registry.publish(registry.enable(draft.id).id);
}

function runRepositoryContract(
  name: string,
  createFixture: () => Promise<RepositoryFixture>,
  skip: false | string = false,
) {
  describe(`${name} ModelSupplyControlPlaneRepository contract`, { skip }, () => {
    it('preserves catalog head CAS and model preferences', async () => {
      const fixture = await createFixture();
      try {
        const revision = publishedCatalogRevision();
        await fixture.repository.setCurrentPublishedCatalogRevision(
          fixture.workspaceId,
          revision,
          null,
        );
        assert.equal(
          (await fixture.repository.getCurrentPublishedCatalogRevision(
            fixture.workspaceId,
          ))?.id,
          revision.id,
        );
        await assert.rejects(
          fixture.repository.setCurrentPublishedCatalogRevision(
            fixture.workspaceId,
            revision,
            null,
          ),
          (error: unknown) =>
            error instanceof P1DomainError &&
            error.code === 'IDEMPOTENCY_CONFLICT',
        );

        await fixture.repository.setWorkspaceDefault(
          fixture.workspaceId,
          'image.generate',
          'model-workspace',
        );
        await fixture.repository.setUserDefault(
          fixture.workspaceId,
          'user-a',
          'image.generate',
          'model-user',
        );
        await fixture.repository.setFavorite(
          fixture.workspaceId,
          'user-a',
          'image.generate',
          'model-favorite',
          true,
        );
        await fixture.repository.recordRecent(
          fixture.workspaceId,
          'user-a',
          'image.generate',
          'model-recent',
        );
        assert.deepEqual(
          await fixture.repository.getPreferences(
            fixture.workspaceId,
            'user-a',
            'image.generate',
          ),
          {
            favorites: ['model-favorite'],
            recent: ['model-recent'],
            userDefault: 'model-user',
            workspaceDefault: 'model-workspace',
          },
        );
      } finally {
        await fixture.cleanup();
      }
    });

    it('keeps generation reads workspace-scoped and paginated', async () => {
      const fixture = await createFixture();
      try {
        const older = completedResult({
          createdAt: '2026-08-04T01:00:00.000Z',
          jobId: `job-old-${randomUUID()}`,
          operation: 'image.generate',
        });
        const newer = completedResult({
          createdAt: '2026-08-04T02:00:00.000Z',
          jobId: `job-new-${randomUUID()}`,
          operation: 'image.generate',
        });
        await fixture.repository.saveResult(fixture.workspaceId, older);
        await fixture.repository.saveResult(fixture.workspaceId, newer);

        assert.equal(
          (await fixture.repository.getJob(fixture.workspaceId, newer.jobId))
            ?.jobId,
          newer.jobId,
        );
        assert.equal(
          await fixture.repository.getJob(
            fixture.otherWorkspaceId,
            newer.jobId,
          ),
          null,
        );
        const page = await fixture.repository.listJobs(fixture.workspaceId, {
          dir: 'desc',
          operation: 'image.generate',
          page: 1,
          pageSize: 1,
          sort: 'startedAt',
        });
        assert.equal(page.total, 2);
        assert.deepEqual(
          page.items.map((item) => item.jobId),
          [newer.jobId],
        );
      } finally {
        await fixture.cleanup();
      }
    });

    it('fences and settles a claimed provider effect exactly once', async () => {
      const fixture = await createFixture();
      try {
        const queued = completedResult({
          createdAt: '2026-08-04T03:00:00.000Z',
          jobId: `job-outbox-${randomUUID()}`,
          operation: 'copy.generate',
        });
        queued.status = 'unknown';
        queued.attempt.status = 'unknown';
        const outboxId = `outbox-${randomUUID()}`;
        await fixture.repository.enqueueCanvasTextGeneration(
          fixture.workspaceId,
          queued,
          {
            createdAt: '2026-08-04T03:00:00.000Z',
            id: outboxId,
            status: 'pending',
            submission: {
              actorId: 'user-a',
              dataClass: [],
              idempotencyKey: outboxId,
              operation: 'copy.generate',
              prompt: 'Write one beauty promotion.',
              selection: { catalogModelId: 'model-copy', mode: 'fixed' },
              workspaceId: fixture.workspaceId,
            },
            workspaceId: fixture.workspaceId,
          },
        );
        const claim = await fixture.repository.claimCanvasTextGeneration({
          claimToken: 'claim-a',
          leaseExpiresAt: '2026-08-04T03:02:00.000Z',
          now: '2026-08-04T03:01:00.000Z',
        });
        assert.equal(claim?.id, outboxId);
        assert.deepEqual(
          await fixture.repository.beginCanvasTextGenerationProviderEffect({
            claimToken: 'claim-a',
            effectKey: `effect:${outboxId}`,
            id: outboxId,
          }),
          { status: 'execute' },
        );
        const completed = completedResult({
          createdAt: '2026-08-04T03:03:00.000Z',
          jobId: queued.jobId,
          operation: 'copy.generate',
        });
        assert.equal(
          await fixture.repository.completeCanvasTextGenerationProviderEffect({
            claimToken: 'claim-a',
            effectKey: `effect:${outboxId}`,
            id: outboxId,
            result: completed,
          }),
          true,
        );
        assert.equal(
          await fixture.repository.completeCanvasTextGeneration({
            claimToken: 'claim-a',
            id: outboxId,
            result: completed,
          }),
          true,
        );
        assert.equal(
          await fixture.repository.completeCanvasTextGeneration({
            claimToken: 'claim-a',
            id: outboxId,
            result: completed,
          }),
          false,
        );
        assert.equal(
          (await fixture.repository.getJob(fixture.workspaceId, queued.jobId))
            ?.status,
          'completed',
        );
      } finally {
        await fixture.cleanup();
      }
    });
  });
}

runRepositoryContract('Memory', async () => ({
  cleanup: async () => undefined,
  otherWorkspaceId: `contract-memory-other-${randomUUID()}`,
  repository: new MemoryModelSupplyControlPlaneRepository(),
  workspaceId: `contract-memory-${randomUUID()}`,
}));

const databaseUrl = process.env.TEST_DATABASE_URL;

runRepositoryContract(
  'Postgres',
  async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is not configured');
    const pool = new Pool({ connectionString: databaseUrl });
    const repository = new PostgresModelSupplyRepository(pool);
    const workspaceId = `contract-postgres-${randomUUID()}`;
    const otherWorkspaceId = `contract-postgres-other-${randomUUID()}`;
    await repository.migrate();
    return {
      async cleanup() {
        await repository.deleteWorkspaceForTest(workspaceId);
        await repository.deleteWorkspaceForTest(otherWorkspaceId);
        await pool.end();
      },
      otherWorkspaceId,
      repository,
      workspaceId,
    };
  },
  databaseUrl ? false : 'TEST_DATABASE_URL is not configured',
);
