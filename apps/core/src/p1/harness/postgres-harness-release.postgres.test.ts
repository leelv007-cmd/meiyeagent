/**
 * Postgres parity for HarnessRelease three tables (V31-21).
 * Skips when TEST_DATABASE_URL is unset — do not self-provision PG.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { AgentControlLimits } from '@meiye/contracts';
import { Pool } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import {
  HarnessReleaseService,
  type PublishHarnessReleaseInput,
} from './harness-release.js';
import { PostgresHarnessReleaseStore } from './postgres-harness-release.js';
import {
  defaultPromptPackBindings,
  promptKeysForAllPacks,
} from './prompt-packs.js';

const connectionString = process.env.TEST_DATABASE_URL;

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 6,
  maxToolCalls: 8,
  maxRetrievalCalls: 4,
  maxMerchantQuestions: 1,
  maxReplans: 3,
  maxSchemaRepairs: 1,
  maxContextTokens: 32_000,
  maxDelegations: 2,
};

function fullPromptBindings(): PublishHarnessReleaseInput['promptBindings'] {
  const bindings: PublishHarnessReleaseInput['promptBindings'] = {};
  for (const key of promptKeysForAllPacks()) {
    bindings[key] = { key, version: `${key}@pg-v1` };
  }
  return bindings;
}

function publishInput(
  releaseId: string,
  overrides: Partial<PublishHarnessReleaseInput> = {},
): PublishHarnessReleaseInput {
  return {
    releaseId,
    version: 1,
    agentSessionHarnessVersion: 'session/1',
    makeHarnessVersion: 'make/1',
    middlewareBindings: [
      {
        policyId: 'tenant-gate',
        revision: '1',
        kind: 'before_model',
        order: 0,
        allowedControlActions: ['continue'],
      },
    ],
    controlLimits: { ...CONTROL_LIMITS },
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    memoryPolicyRef: { id: 'mem', revision: '1' },
    contextCompilerRef: { id: 'ctx', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: fullPromptBindings(),
    promptPackBindings: defaultPromptPackBindings(),
    schemaBindings: {},
    skillBindings: {},
    toolPolicyRevision: 'tool/1',
    modelPolicyRevision: 'model/1',
    factPolicyRevision: 'fact/1',
    rightsPolicyRevision: 'rights/1',
    budgetPolicyRevision: 'budget/1',
    evalSuiteRevision: 'eval/1',
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

test(
  'Postgres HarnessRelease store is put-once, restart-readable, and enforces single production',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessReleaseStore(pool);
    await store.migrate();
    const service = new HarnessReleaseService(store);

    const releaseId = `hr-pg-${randomUUID()}`;
    const releaseId2 = `hr-pg-${randomUUID()}`;

    try {
      const published = await service.publishArtifact(publishInput(releaseId));
      assert.equal(published.lifecycle.status, 'draft');

      const again = await service.publishArtifact(publishInput(releaseId));
      assert.equal(again.artifact.manifestHash, published.artifact.manifestHash);

      await assert.rejects(
        service.publishArtifact(
          publishInput(releaseId, { toolPolicyRevision: 'tool/other' }),
        ),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      await service.transitionLifecycle({
        releaseId,
        toStatus: 'evaluating',
      });
      await service.transitionLifecycle({
        releaseId,
        toStatus: 'canary',
        approvedBy: 'ops',
      });
      await service.transitionLifecycle({
        releaseId,
        toStatus: 'production',
        approvedBy: 'ops',
      });

      await service.publishArtifact(
        publishInput(releaseId2, {
          version: 2,
          toolPolicyRevision: 'tool/2',
          createdAt: '2026-08-08T13:00:00.000Z',
        }),
      );
      await service.transitionLifecycle({
        releaseId: releaseId2,
        toStatus: 'evaluating',
      });
      await service.transitionLifecycle({
        releaseId: releaseId2,
        toStatus: 'canary',
      });
      await service.transitionLifecycle({
        releaseId: releaseId2,
        toStatus: 'production',
      });

      const production = await store.getLifecycleByStatus('production');
      assert.equal(production?.releaseId, releaseId2);
      const retired = await store.getLifecycle(releaseId);
      assert.equal(retired?.status, 'retired');

      const restarted = new PostgresHarnessReleaseStore(pool);
      await restarted.migrate();
      const restored = await restarted.getArtifact(releaseId);
      assert.equal(restored?.manifestHash, published.artifact.manifestHash);

      const rolled = await new HarnessReleaseService(restarted).rollbackProduction({
        toReleaseId: releaseId,
        approvedBy: 'ops',
      });
      assert.equal(rolled.production.releaseId, releaseId);
      assert.equal(rolled.previousProduction?.releaseId, releaseId2);
    } finally {
      await pool.query(
        'DELETE FROM p1_harness_release_rollouts WHERE release_id = ANY($1::text[])',
        [[releaseId, releaseId2]],
      );
      await pool.query(
        'DELETE FROM p1_harness_release_lifecycle WHERE release_id = ANY($1::text[])',
        [[releaseId, releaseId2]],
      );
      await pool.query(
        'DELETE FROM p1_harness_release_artifacts WHERE release_id = ANY($1::text[])',
        [[releaseId, releaseId2]],
      );
      await pool.end();
    }
  },
);
