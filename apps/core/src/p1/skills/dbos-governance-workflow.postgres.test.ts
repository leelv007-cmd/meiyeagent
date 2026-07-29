import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';

import {
  skillGovernanceWorkflowId,
  type SkillGovernanceWorkflowResult,
} from './dbos-governance-workflow.js';
import type { SkillFoundationModule } from './foundation-module.js';
import { PostgresSkillRepository } from './postgres-repository.js';
import { createDurableSkillRuntime } from './runtime.js';
import type { SkillRevision } from './types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const NOW = '2026-07-30T13:00:00.000Z';

test(
  'real DBOS governance suspends, cancels, resumes and replays exactly once',
  {
    skip:
      databaseUrl && systemDatabaseUrl
        ? false
        : 'TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required',
  },
  async () => {
    assert.notEqual(
      normalizedDatabaseIdentity(databaseUrl!),
      normalizedDatabaseIdentity(systemDatabaseUrl!),
      'Business and DBOS system databases must be separate.',
    );
    const suffix = randomUUID();
    const workspaceId = `workspace-governance-${suffix}`;
    const approvalSkillId = `skill.governance-approval.${suffix}`;
    const cancellationSkillId = `skill.governance-cancel.${suffix}`;
    const approvalRunId = `governance-approval-${suffix}`;
    const cancellationRunId = `governance-cancel-${suffix}`;
    const approvalWorkflowId = skillGovernanceWorkflowId(
      workspaceId,
      approvalRunId,
    );
    const cancellationWorkflowId = skillGovernanceWorkflowId(
      workspaceId,
      cancellationRunId,
    );
    const workflowIds = [approvalWorkflowId, cancellationWorkflowId];
    const runIds = [approvalRunId, cancellationRunId];
    const skillIds = [approvalSkillId, cancellationSkillId];
    const pool = new Pool({ connectionString: databaseUrl! });
    const repository = new PostgresSkillRepository(pool);
    const dbosConfig = {
      applicationVersion: `skill-governance-${suffix}`,
      name: 'beauty-marketing-skill-governance',
      systemDatabaseUrl: systemDatabaseUrl!,
    };
    let launched = false;

    try {
      let durableRuntime = await createDurableSkillRuntime({
        pool,
        repository,
      });
      await Promise.all(
        skillIds.map((skillId) => seedAcceptedRevision(repository, skillId)),
      );
      DBOS.setConfig(dbosConfig);
      let { foundationModule, governanceRuntime: runtime, service } =
        durableRuntime;
      await DBOS.launch();
      launched = true;

      const approvalRequest = governanceRequest({
        runId: approvalRunId,
        skillId: approvalSkillId,
        workspaceId,
      });
      assert.deepEqual(
        await startGovernance(foundationModule, approvalRequest),
        {
          runId: approvalRunId,
          workflowId: approvalWorkflowId,
        },
      );
      assert.deepEqual(
        await startGovernance(
          foundationModule,
          structuredClone(approvalRequest),
        ),
        {
          runId: approvalRunId,
          workflowId: approvalWorkflowId,
        },
      );
      await waitForSuspended(runtime, workspaceId, approvalRunId);
      await runtime.cancel({
        actorId: 'operator-administrative-cancel',
        runId: approvalRunId,
        workspaceId,
      });
      await waitForWorkflowStatus(approvalWorkflowId, 'CANCELLED');
      await runtime.resume({
        actorId: 'operator-administrative-resume',
        runId: approvalRunId,
        workspaceId,
      });
      await waitForSuspended(runtime, workspaceId, approvalRunId);
      await approveGovernance(
        foundationModule,
        workspaceId,
        approvalRunId,
      );
      await approveGovernance(
        foundationModule,
        workspaceId,
        approvalRunId,
      );
      const approvalResult = await workflowResult(approvalWorkflowId);
      assert.equal(approvalResult.success, true);
      assert.equal(approvalResult.applied, true);
      await waitForWorkflowStatus(approvalWorkflowId, 'SUCCESS');
      assert.equal(
        (await runtime.inspect(workspaceId, approvalRunId)).state?.status,
        'completed',
      );
      assert.deepEqual(
        await service.inspectGovernanceRun(approvalRunId).then((run) => ({
          actorId: run?.actorId,
          auditActorIds: run?.auditEntries.map((entry) => entry.actorId),
        })),
        {
          actorId: 'operator-approver',
          auditActorIds: ['operator-approver'],
        },
      );
      assert.equal(
        (
          await repository.listRevisions(approvalSkillId, 10)
        ).length,
        2,
      );
      assert.equal(
        countStep(
          await DBOS.listWorkflowSteps(approvalWorkflowId),
          'apply-skill-governance-revision',
        ),
        1,
      );

      await DBOS.shutdown({ deregister: true });
      launched = false;
      durableRuntime = await createDurableSkillRuntime({
        pool,
        repository,
      });
      ({ foundationModule, governanceRuntime: runtime, service } =
        durableRuntime);
      DBOS.setConfig(dbosConfig);
      await DBOS.launch();
      launched = true;
      assert.deepEqual(
        await startGovernance(
          foundationModule,
          structuredClone(approvalRequest),
        ),
        {
          runId: approvalRunId,
          workflowId: approvalWorkflowId,
        },
      );
      assert.deepEqual(
        await workflowResult(approvalWorkflowId),
        approvalResult,
      );
      assert.equal(
        (
          await repository.listRevisions(approvalSkillId, 10)
        ).length,
        2,
      );
      assert.equal(
        countStep(
          await DBOS.listWorkflowSteps(approvalWorkflowId),
          'apply-skill-governance-revision',
        ),
        1,
      );

      const cancellationRequest = governanceRequest({
        runId: cancellationRunId,
        skillId: cancellationSkillId,
        workspaceId,
      });
      await startGovernance(foundationModule, cancellationRequest);
      await waitForSuspended(runtime, workspaceId, cancellationRunId);
      await cancelGovernance(
        foundationModule,
        workspaceId,
        cancellationRunId,
      );
      await cancelGovernance(
        foundationModule,
        workspaceId,
        cancellationRunId,
      );
      const cancellationResult = await workflowResult(
        cancellationWorkflowId,
      );
      assert.deepEqual(cancellationResult, {
        applied: false,
        runId: cancellationRunId,
        success: true,
        validationResults: [
          {
            fieldPath: '$workflow',
            reasonCode: 'governance_cancelled',
            status: 'not_applied',
          },
        ],
      });
      await waitForWorkflowStatus(cancellationWorkflowId, 'SUCCESS');
      const cancelledRun =
        await service.inspectGovernanceRun(cancellationRunId);
      assert.equal(cancelledRun?.actorId, 'operator-business-cancel');
      assert.equal(cancelledRun?.draftSkillRevisionRef, null);
      assert.equal(
        (
          await repository.listRevisions(cancellationSkillId, 10)
        ).length,
        1,
      );
      assert.equal(
        countStep(
          await DBOS.listWorkflowSteps(cancellationWorkflowId),
          'cancel-skill-governance-revision',
        ),
        1,
      );
      assert.equal(
        countStep(
          await DBOS.listWorkflowSteps(cancellationWorkflowId),
          'apply-skill-governance-revision',
        ),
        0,
      );

      assert.deepEqual(
        await workflowResult(cancellationWorkflowId),
        cancellationResult,
      );
      assert.equal(
        (
          await repository.listRevisions(cancellationSkillId, 10)
        ).length,
        1,
      );
    } finally {
      if (launched) {
        for (const workflowId of workflowIds) {
          const status = await DBOS.getWorkflowStatus(workflowId);
          if (
            status &&
            status.status !== 'SUCCESS' &&
            status.status !== 'ERROR' &&
            status.status !== 'CANCELLED'
          ) {
            await DBOS.cancelWorkflow(workflowId);
            await waitForWorkflowStatus(workflowId, 'CANCELLED');
          }
          if (status) {
            await DBOS.deleteWorkflow(workflowId);
            assert.equal(await DBOS.getWorkflowStatus(workflowId), null);
          }
        }
        await DBOS.shutdown({ deregister: true });
      }
      await pool.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_id = ANY($1::text[])
             OR target_skill_revision_ref LIKE ANY($2::text[])`,
        [runIds, skillIds.map((skillId) => `${skillId}@%`)],
      );
      await pool.query(
        'DELETE FROM p1_skill_governance_runs WHERE run_id = ANY($1::text[])',
        [runIds],
      );
      await pool.query(
        `DELETE FROM p1_skill_governance_reservations
          WHERE run_id = ANY($1::text[])`,
        [runIds],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = ANY($1::text[])',
        [skillIds],
      );
      await pool.query(
        `DELETE FROM p1_skill_revision_heads
          WHERE skill_id = ANY($1::text[])`,
        [skillIds],
      );
      await pool.query(
        'DELETE FROM p1_skill_catalogs WHERE skill_id = ANY($1::text[])',
        [skillIds],
      );
      const residuals = await pool.query<{
        catalogs: string;
        reservations: string;
        revisions: string;
        runs: string;
      }>(
        `SELECT
           (SELECT count(*)::text
              FROM p1_skill_catalogs
             WHERE skill_id = ANY($1::text[])) AS catalogs,
           (SELECT count(*)::text
              FROM p1_skill_governance_reservations
             WHERE run_id = ANY($2::text[])) AS reservations,
           (SELECT count(*)::text
              FROM p1_skill_revisions
             WHERE skill_id = ANY($1::text[])) AS revisions,
           (SELECT count(*)::text
              FROM p1_skill_governance_runs
             WHERE run_id = ANY($2::text[])) AS runs`,
        [skillIds, runIds],
      );
      assert.deepEqual(residuals.rows, [
        {
          catalogs: '0',
          reservations: '0',
          revisions: '0',
          runs: '0',
        },
      ]);
      await pool.end();
    }
  },
);

function foundationContext(userId: string, workspaceId: string) {
  return {
    actor: 'admin' as const,
    correlationId: `issue-254:${userId}`,
    userId,
    workspaceId,
  };
}

function startGovernance(
  module: SkillFoundationModule,
  input: ReturnType<typeof governanceRequest>,
) {
  return module.execute({
    context: foundationContext(input.actorId, input.workspaceId),
    idempotencyKey: `start:${input.runId}`,
    input: {
      action: 'skill_governance_start',
      payload: {
        baseSkillRevisionRef: input.baseSkillRevisionRef,
        expectedHeadRevision: input.expectedHeadRevision,
        patch: structuredClone(input.patch),
        runId: input.runId,
      },
    },
  });
}

function approveGovernance(
  module: SkillFoundationModule,
  workspaceId: string,
  runId: string,
) {
  return module.execute({
    context: foundationContext('operator-approver', workspaceId),
    idempotencyKey: 'approval-once',
    input: {
      action: 'skill_governance_approve',
      payload: { runId },
    },
  });
}

function cancelGovernance(
  module: SkillFoundationModule,
  workspaceId: string,
  runId: string,
) {
  return module.execute({
    context: foundationContext('operator-business-cancel', workspaceId),
    idempotencyKey: 'business-cancel-once',
    input: {
      action: 'skill_governance_business_cancel',
      payload: { runId },
    },
  });
}

function governanceRequest(input: {
  runId: string;
  skillId: string;
  workspaceId: string;
}) {
  return {
    actorId: 'operator-governance',
    baseSkillRevisionRef: `${input.skillId}@1`,
    expectedHeadRevision: 1,
    patch: {
      instruction: `Governed instruction for ${input.runId}.`,
    },
    runId: input.runId,
    workspaceId: input.workspaceId,
  };
}

async function seedAcceptedRevision(
  repository: PostgresSkillRepository,
  skillId: string,
) {
  await repository.putCatalog({
    activeRevisionRef: null,
    actorId: 'operator-seed',
    createdAt: NOW,
    description: 'Real DBOS governance fixture.',
    name: 'Real DBOS governance fixture',
    presentationPolicy: 'backend_only',
    publicationGeneration: 0,
    skillId,
    sourceKind: 'authored',
    tier: 'platform',
    updatedAt: NOW,
  });
  await repository.putRevision(acceptedRevision(skillId), null);
}

function acceptedRevision(skillId: string): SkillRevision {
  return {
    acceptedAt: NOW,
    acceptedBy: 'operator-seed',
    contentHash: `content-${skillId}`,
    createdAt: NOW,
    createdBy: 'operator-seed',
    evalRunId: `eval-${skillId}`,
    formatVersion: 2,
    governance: {
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 1_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized',
      fallback: 'skip',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: [],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.copy@1'],
    },
    instruction: 'Original governance instruction.',
    manifest: {
      description: 'Real DBOS governance fixture.',
      name: 'real-dbos-governance',
    },
    packagePaths: ['SKILL.md'],
    prompt: {
      content: 'Real DBOS governance prompt.',
      contentHash: 'real-dbos-governance-prompt-hash',
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse',
      version: '1',
    },
    revision: 1,
    skillId,
    skillRevisionRef: `${skillId}@1`,
    status: 'accepted_frozen',
  };
}

async function waitForSuspended(
  runtime: {
    inspect(
      workspaceId: string,
      runId: string,
    ): Promise<{
      state: { status: string } | null;
      workflowStatus: string | null;
    }>;
  },
  workspaceId: string,
  runId: string,
) {
  const workflowId = skillGovernanceWorkflowId(workspaceId, runId);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [inspection, steps] = await Promise.all([
      runtime.inspect(workspaceId, runId),
      DBOS.listWorkflowSteps(workflowId),
    ]);
    if (
      inspection.state?.status === 'awaiting_approval' &&
      inspection.workflowStatus === 'PENDING' &&
      steps?.some(({ name }) => name === 'DBOS.sleep')
    ) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('Skill governance workflow did not durably suspend.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForWorkflowStatus(
  workflowId: string,
  expected: string,
) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const status = (await DBOS.getWorkflowStatus(workflowId))?.status;
    if (status === expected) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Skill governance workflow did not reach ${expected}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function workflowResult(workflowId: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      DBOS.retrieveWorkflow<SkillGovernanceWorkflowResult>(
        workflowId,
      ).getResult(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Skill governance workflow timed out.')),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function countStep(
  steps: Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>,
  name: string,
) {
  return steps?.filter((step) => step.name === name).length ?? 0;
}

function normalizedDatabaseIdentity(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}
