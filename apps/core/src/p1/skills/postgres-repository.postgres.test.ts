import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresSkillRepository } from './index.js';
import type {
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillInvocationReceipt,
  SkillRevision,
} from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'all five Skill objects and child-effect settlements survive a PostgreSQL restart',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const skillId = `skill.postgres.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const invocationId = `invocation-postgres-${suffix}`;
    const workflowRevisionRef = `workflow.postgres.${suffix}@1`;
    const repository = new PostgresSkillRepository(pool);
    await repository.migrate();
    const catalog: SkillCatalog = {
      activeRevisionRef: skillRevisionRef,
      actorId: 'operator-postgres',
      createdAt: '2026-07-26T03:00:00.000Z',
      name: 'Postgres Skill',
      presentationPolicy: 'backend_only',
      skillId,
      updatedAt: '2026-07-26T03:01:00.000Z',
    };
    const revision: SkillRevision = {
      acceptedAt: '2026-07-26T03:01:00.000Z',
      acceptedBy: 'operator-postgres',
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-26T03:00:00.000Z',
      createdBy: 'operator-postgres',
      evalRunId: 'eval-postgres',
      instruction: 'Use the declared fact scope.',
      manifest: {
        allowedTools: ['tool.fact.read'],
        budget: {
          maxChildEffects: 1,
          maxCostCents: 1,
          timeoutMs: 10_000,
        },
        compatibility: {
          workflowRevisionRefs: [workflowRevisionRef],
        },
        contextScopes: ['facts'],
        evalSuiteRef: 'eval.skill.postgres@1',
        executionMode: 'harness_native',
        fallback: 'fail_closed',
        inputSchemaRef: 'skill-input.postgres@1',
        outputSchemaRef: 'skill-output.postgres@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'read',
      },
      prompt: {
        content: 'Use the declared fact scope.',
        contentHash: 'b'.repeat(64),
        isFallback: false,
        label: 'production',
        name: 'skills/postgres',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId,
      skillRevisionRef,
      status: 'accepted_frozen',
    };
    const binding: SkillBinding = {
      bindingId: `binding-postgres-${suffix}`,
      createdAt: '2026-07-26T03:02:00.000Z',
      mode: 'required',
      skillRevisionRef,
      stage: 'intent_naming',
      workflowRevisionRef,
    };
    const deployment: SkillDeployment = {
      channel: 'official-direct',
      createdAt: '2026-07-26T03:03:00.000Z',
      deploymentId: `deployment-postgres-${suffix}`,
      executionMode: 'harness_native',
      nativeSkillId: 'native-postgres',
      nativeVersion: '1',
      provider: 'fixture',
      skillRevisionRef,
    };
    const effect: SkillChildEffect = {
      acceptanceStatus: 'accepted',
      budgetReservationCents: 1,
      contextRefs: ['facts:offer'],
      costCents: 1,
      createdAt: '2026-07-26T03:04:00.000Z',
      effectId: `${invocationId}:read`,
      fingerprint: 'c'.repeat(64),
      idempotencyKey: `skill:${invocationId}:read`,
      invocationId,
      providerReceipt: {
        accepted: true,
        providerTaskRef: 'provider-postgres',
      },
      retryStatus: 'first_attempt',
      settlementStatus: 'settled',
      toolId: 'tool.fact.read',
      usage: { inputTokens: 2, outputTokens: 1 },
    };
    const receipt: SkillInvocationReceipt = {
      childEffectIds: [effect.effectId],
      createdAt: '2026-07-26T03:05:00.000Z',
      inputFingerprint: 'd'.repeat(64),
      invocationId,
      productUsageTaskId: `product-usage-${suffix}`,
      skillRevisionRef,
      status: 'settled',
      taskId: `task-${suffix}`,
      totalCostCents: 1,
      totalInputTokens: 2,
      totalOutputTokens: 1,
      workspaceId: `workspace-${suffix}`,
    };

    try {
      await repository.putCatalog(catalog);
      await repository.putRevision(revision, null);
      await repository.putBinding(binding);
      await repository.putDeployment(deployment);
      await repository.putChildEffect(effect);
      await repository.putInvocationReceipt(receipt);

      const restarted = new PostgresSkillRepository(pool);
      assert.deepEqual(await restarted.getCatalog(skillId), catalog);
      assert.deepEqual(
        await restarted.getRevision(skillRevisionRef),
        revision,
      );
      assert.deepEqual(
        await restarted.listBindings(
          binding.workflowRevisionRef,
          binding.stage,
        ),
        [binding],
      );
      assert.deepEqual(
        await restarted.getDeployment(deployment.deploymentId),
        deployment,
      );
      assert.deepEqual(await restarted.getChildEffect(effect.effectId), effect);
      assert.deepEqual(
        await restarted.getInvocationReceipt(invocationId),
        receipt,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_invocation_receipts WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_child_effects WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_deployments WHERE skill_revision_ref = $1',
        [skillRevisionRef],
      );
      await pool.query(
        'DELETE FROM p1_skill_bindings WHERE skill_revision_ref = $1',
        [skillRevisionRef],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revision_heads WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_catalogs WHERE skill_id = $1',
        [skillId],
      );
      await pool.end();
    }
  },
);
