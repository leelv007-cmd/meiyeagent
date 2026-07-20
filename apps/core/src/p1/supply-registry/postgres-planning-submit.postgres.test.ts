import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { MemoryModelSupplyControlPlaneRepository } from '../model-supply/foundation-module.js';
import { DurableMediaGenerationApplicationService } from '../model-supply/media-generation-workflow.js';
import { createModelSupplyRuntime } from '../model-supply/runtime-assembly.js';
import { modelRuntimeAssemblyFromEnv } from '../model-supply/runtime-config.js';
import {
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
} from './postgres-planning-control-plane.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres planning state in real model submission',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const workspaceId = `planning-submit-${randomUUID()}`;
    const planning = new PostgresSupplyPlanningControlPlane(pool, workspaceId);

    before(async () => {
      const client = await pool.connect();
      try {
        await new PostgresSupplyPlanningMigration().migrate(client);
      } finally {
        client.release();
      }
    });

    after(async () => {
      await pool.query(
        'DELETE FROM p1_supply_route_policy_publications WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_revisions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_data_policy_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_ranking_input_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    it('fails closed before provider I/O when the published Postgres DataPolicy rejects the task', async () => {
      const revisionId = `route-policy-copy-${randomUUID()}`;
      await planning.publishRoutePolicy(
        workspaceId,
        {
          id: revisionId,
          operation: 'copy.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: ['openai-direct-recorded'],
          maxAttempts: 1,
          fallbackAuthorized: false,
          revisionId,
        },
        null,
      );
      await planning.setDataPolicyBinding(workspaceId, {
        deploymentId: 'openai-direct-recorded',
        dataPolicyRevisionId: 'data-policy-public-only-r1',
        dataPolicy: {
          sourceTrustLevel: 'contract_attested',
          processingRegion: 'overseas',
          allowedDataClasses: ['public'],
        },
      });

      const catalog = modelRuntimeAssemblyFromEnv({
        APP_ENV: 'e2e',
        MODEL_EXECUTION_MODE: 'fixture',
      });
      const repository = new MemoryModelSupplyControlPlaneRepository();
      const runtime = createModelSupplyRuntime({
        application: {
          execution: catalog.runtime.execution,
          resultSink: repository,
        },
        catalog,
        controlPlane: { repository, planningControlPlane: planning },
      });
      let executions = 0;
      const originalExecute = runtime.application.execution.execute.bind(
        runtime.application.execution,
      );
      runtime.application.execution.execute = async (request) => {
        executions += 1;
        return originalExecute(request);
      };

      await assert.rejects(
        runtime.application.submit({
          workspaceId,
          actorId: 'owner-a',
          idempotencyKey: 'postgres-data-policy-fail-closed',
          operation: 'copy.generate',
          selection: {
            mode: 'auto',
            profile: 'quality',
            fallbackConsent: true,
          },
          dataClass: ['contains_face'],
          prompt: '使用人像生成美业文案',
        }),
        /No compliant deployment satisfies the published route and data policy/,
      );
      assert.equal(executions, 0);
      assert.equal(
        (
          await planning.readPlanningState({
            workspaceId,
            catalogRevisionId: 'recorded-catalog-v1',
            operation: 'copy.generate',
            qualityTier: 'quality',
            deploymentIds: ['openai-direct-recorded'],
          })
        ).routePolicyRevisionId,
        revisionId,
      );
    });

    it('blocks durable media enqueue and Canvas route freeze before an overseas contains-face route is frozen', async () => {
      const revisionId = `route-policy-image-${randomUUID()}`;
      await planning.publishRoutePolicy(
        workspaceId,
        {
          id: revisionId,
          operation: 'image.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: ['gpt-image-2-managed'],
          maxAttempts: 1,
          fallbackAuthorized: false,
          revisionId,
        },
        null,
      );
      await planning.setDataPolicyBinding(workspaceId, {
        deploymentId: 'gpt-image-2-managed',
        dataPolicyRevisionId: 'data-policy-overseas-public-only-r1',
        dataPolicy: {
          sourceTrustLevel: 'contract_attested',
          processingRegion: 'overseas',
          allowedDataClasses: ['public'],
        },
      });

      const catalog = modelRuntimeAssemblyFromEnv({
        APP_ENV: 'e2e',
        MODEL_EXECUTION_MODE: 'fixture',
      });
      const repository = new MemoryModelSupplyControlPlaneRepository();
      const runtime = createModelSupplyRuntime({
        application: {
          execution: catalog.runtime.execution,
          resultSink: repository,
        },
        catalog,
        controlPlane: { repository, planningControlPlane: planning },
      });
      let enqueues = 0;
      const durable = new DurableMediaGenerationApplicationService({
        models: runtime.application,
        jobs: {
          async find() {
            return null;
          },
          async submit() {
            enqueues += 1;
            throw new Error('invalid media task must not be enqueued');
          },
          async get() {
            throw new Error('not used');
          },
          async cancel() {
            throw new Error('not used');
          },
          async recordCancelledReconciliation() {
            throw new Error('not used');
          },
        },
      });
      const submission = {
        workspaceId,
        actorId: 'owner-a',
        idempotencyKey: 'postgres-media-data-policy-fail-closed',
        operation: 'image.generate' as const,
        selection: {
          mode: 'fixed' as const,
          catalogModelId: 'gpt-image-2',
        },
        dataClass: ['contains_face' as const],
        prompt: '使用人像生成海报',
      };

      await assert.rejects(
        durable.submit(submission),
        /No compliant deployment satisfies the published route and data policy/,
      );
      assert.equal(enqueues, 0);
      await assert.rejects(
        runtime.application.freezeFixedRouteForExecution({
          workspaceId,
          operation: 'image.generate',
          catalogModelId: 'gpt-image-2',
          deploymentId: 'gpt-image-2-managed',
          dataClass: ['contains_face'],
        }),
        /No compliant deployment can be frozen under the published route and data policy/,
      );
    });
  },
);
