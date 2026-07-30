import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { CapabilityHotAssemblyRegistry } from '../supply-registry/hot-assembly.js';
import { RecordedAdapterRouter } from './adapters.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
  createDefaultPriceRevisions,
  type CatalogRevision,
} from './catalog.js';
import { ModelSupplyControlPlaneService } from './foundation-module.js';
import { ModelSupplyApplicationService } from './index.js';
import { PostgresModelSupplyRepository } from './postgres-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'published catalog PostgreSQL reads',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const repository = new PostgresModelSupplyRepository(pool);
    const workspaceId = `legacy-catalog-${randomUUID()}`;

    before(() => repository.migrate());

    after(async () => {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    });

    it('fails closed before a pre-contract revision reaches hot assembly or route freeze', async () => {
      const revisionId = `legacy-catalog-${randomUUID()}`;
      const deployment = createDefaultDeployments({
        activatedDeploymentIds: ['gpt-image-2-managed'],
      }).find((candidate) => candidate.id === 'gpt-image-2-managed');
      const price = createDefaultPriceRevisions().find(
        (candidate) =>
          candidate.catalogModelId === 'gpt-image-2' &&
          candidate.executionChannelId === deployment?.executionChannelId &&
          candidate.pricingTier === 'standard',
      );
      assert.ok(deployment);
      assert.ok(price);
      delete deployment.executionChannelId;
      delete deployment.pricingTier;
      delete price.executionChannelId;
      delete price.pricingTier;
      const legacyRevision: CatalogRevision = {
        id: revisionId,
        number: 1,
        stage: 'published',
        payload: {
          models: createDefaultCatalogModels().filter(
            (candidate) => candidate.id === deployment.catalogModelId,
          ),
          deployments: [deployment],
          capabilities: [],
          prices: [price],
          routes: [],
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      };
      await pool.query(
        `INSERT INTO model_catalog_revisions
           (workspace_id, revision_id, stage, revision)
         VALUES ($1, $2, 'published', $3::jsonb)`,
        [workspaceId, revisionId, JSON.stringify(legacyRevision)],
      );
      await pool.query(
        `INSERT INTO model_catalog_heads (workspace_id, revision_id)
         VALUES ($1, $2)`,
        [workspaceId, revisionId],
      );

      const hotAssembly = new CapabilityHotAssemblyRegistry();
      hotAssembly.applyCapabilityRevision({
        revisionId: 'capability-current-v1',
        number: 1,
        entries: [{
          deploymentId: deployment.id,
          catalogModelId: deployment.catalogModelId,
          apiFamily: 'image',
          channel: 'managed',
          region: 'global',
          executionChannelId: 'channel-openai-image-managed',
          adapterKey: 'recorded',
        }],
        publishedAt: '2026-07-30T00:00:00.000Z',
      });
      const application = new ModelSupplyApplicationService({
        models: [],
        deployments: [],
        execution: new RecordedAdapterRouter(),
        capabilityHotAssembly: hotAssembly,
      });
      const controlPlane = new ModelSupplyControlPlaneService({
        application,
        repository: new PostgresModelSupplyRepository(pool),
      });
      const rejectsMissingExecutionFacts = (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'INVALID_STATE' &&
        error.message.includes(revisionId) &&
        error.message.includes('deployment.executionChannelId') &&
        error.message.includes('deployment.pricingTier') &&
        error.message.includes('price.executionChannelId') &&
        error.message.includes('price.pricingTier');

      await assert.rejects(
        controlPlane.getCatalog(workspaceId, 'image.generate'),
        rejectsMissingExecutionFacts,
      );
      await assert.rejects(
        controlPlane.initialize(workspaceId),
        rejectsMissingExecutionFacts,
      );
      await assert.rejects(
        application.freezeFixedRouteForExecution({
          workspaceId,
          operation: 'image.generate',
          catalogModelId: deployment.catalogModelId,
          deploymentId: deployment.id,
          dataClass: [],
        }),
        /not active|No compliant deployment can be frozen/,
      );

      const stored = await pool.query<{ revision: CatalogRevision }>(
        `SELECT revision FROM model_catalog_revisions
         WHERE workspace_id = $1 AND revision_id = $2`,
        [workspaceId, revisionId],
      );
      const storedDeployment = stored.rows[0]?.revision.payload.deployments[0];
      const storedPrice = stored.rows[0]?.revision.payload.prices[0];
      assert.equal('executionChannelId' in storedDeployment!, false);
      assert.equal('pricingTier' in storedDeployment!, false);
      assert.equal('executionChannelId' in storedPrice!, false);
      assert.equal('pricingTier' in storedPrice!, false);
    });
  },
);
