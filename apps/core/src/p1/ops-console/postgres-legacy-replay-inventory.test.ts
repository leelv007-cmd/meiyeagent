import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { COMPILED_EXECUTION_PLAN_SCHEMA_VERSION } from '@meiye/contracts';
import { Pool } from 'pg';

import {
  buildExecutionPlanSnapshot,
  ExecutionPlanAdmissionService,
  freezeExecutionPlanContent,
  resolveDurableReplayBranch,
  type ExecutionPlanFrozenContent,
} from '../harness/execution-plan-admission.js';
import { buildBillingIdentity } from '../execution-spine/billing-identity.js';
import { LEGACY_REPLAY_ADMISSION_LOCK } from '../harness/legacy-replay-admission-lock.js';
import { PostgresExecutionPlanSnapshotStore } from '../harness/postgres-execution-plan-admission-store.js';
import { PostgresHarnessStore } from '../harness/postgres-store.js';
import {
  executionPlanAdmissionWorkflowId,
  type HarnessWorkflowInput,
} from '../harness/task-admission.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { evaluateLegacyReplayArchiveGate } from './legacy-replay-archive-gate.js';
import { PostgresLegacyReplayInventory } from './postgres-legacy-replay-inventory.js';

function paidPendingFixture(suffix: string, workspaceId: string) {
  const content = {
    planId: `paid-plan-${suffix}`,
    planRevision: 3,
    intentDeclaration: { summary: '付费生产快照权威库存验证' },
    contextBundleRef: {
      bundleId: `paid-bundle-${suffix}`,
      revision: 1,
      hash: `paid-context-${suffix}`,
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'image-1',
          unitType: 'image.generate',
          primitive: 'generate',
        },
      ],
      dependencyGroups: [{ groupId: 'image', unitIds: ['image-1'] }],
      boundedRetry: {
        'image-1': {
          maxAttempts: 1,
          maxCostCents: 100,
          retry: { enabled: false },
        },
      },
    },
    deliverables: [
      { deliverableId: 'paid-image', kind: 'media', quantity: 1 },
    ],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: `paid-quote-${suffix}`, revision: 1 },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 0,
      requiredLimits: [],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: `paid-release-${suffix}`,
    approvalBasis: 'merchant_confirmed',
  } as unknown as ExecutionPlanFrozenContent;
  const pendingExecutionPlanSnapshot = freezeExecutionPlanContent(content);
  const executionPlanSnapshot = buildExecutionPlanSnapshot({
    content: pendingExecutionPlanSnapshot.content,
    snapshotHash: pendingExecutionPlanSnapshot.snapshotHash,
    confirmationDecisionRef: `paid-confirmation-${suffix}`,
  });
  const request: HarnessWorkflowInput = {
    actorId: 'owner-paid-legacy-inventory',
    workspaceId,
    packageId: `paid-package-${suffix}`,
    expectedRevision: 1,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '付费生产快照权威库存验证',
    intent: {
      context: {
        workId: `paid-work-${suffix}`,
        intent: '付费生产快照权威库存验证',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    factScope: { storeId: workspaceId },
    pendingExecutionPlanSnapshot,
  };
  return { request, pendingExecutionPlanSnapshot, executionPlanSnapshot };
}

function completedPaidAdmission(
  request: HarnessWorkflowInput,
  workflowId: string,
): HarnessWorkflowInput {
  const confirmationRequestId = `confirmation-${workflowId}`;
  const reservationIdempotencyKey = `consume:confirmation:${workflowId}`;
  const admitted = {
    ...request,
    billingTaskId: workflowId,
    carrierUnitId: 'media',
    carrierUnitIds: ['media'],
    carrierBillableUnits: 1,
    executionConfirmationRequestId: confirmationRequestId,
    executionConfirmationReservationIdempotencyKey: reservationIdempotencyKey,
    executionSnapshot: {
      work: { id: request.intent.context.workId },
      quote: request.pendingExecutionPlanSnapshot!.content.quoteRef,
    } as NonNullable<HarnessWorkflowInput['executionSnapshot']>,
    usageReservation: {
      id: `usage-${workflowId}`,
      credits: 1,
      units: [{ resource: 'image' as const, quantity: 1 }],
    },
  } as HarnessWorkflowInput;
  const billingIdentity = buildBillingIdentity(admitted, workflowId);
  assert.ok(billingIdentity);
  return { ...admitted, billingIdentity };
}

async function insertLegacyPendingRequest(input: {
  pool: Pool;
  workflowId: string;
  request: HarnessWorkflowInput;
}): Promise<void> {
  const runtimeId = `legacy-runtime:${input.workflowId}`;
  await input.pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request, admission_state)
     values ($1, $2, $1, $3, $4::jsonb, 'legacy')`,
    [
      runtimeId,
      input.workflowId,
      fingerprintValue(input.request),
      JSON.stringify(input.request),
    ],
  );
}

test('legacy inventory filters and counts in SQL without a pre-filter LIMIT', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('with active_legacy')) {
        return {
          rows: [{
            active_count: '601',
            oldest_created_at: '2026-01-01T00:00:00.000Z',
            sample_task_ids: ['legacy-1'],
          }],
        };
      }
      return { rows: [{ terminal_at: null }] };
    },
  } as unknown as Pool;

  const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
  assert.equal(snapshot.activePendingCount, 601);
  assert.deepEqual(snapshot.sampleTaskIds, ['legacy-1']);
  const activeSql = queries[0]!.toLowerCase();
  assert.match(activeSql, /executionplansnapshot/);
  assert.match(activeSql, /count\(\*\)/);
  assert.doesNotMatch(
    activeSql.slice(0, activeSql.indexOf('select count(*)')),
    /limit\s+\d+/,
  );
});

test(
  'reconfirmed paid successor does not poison inventory evidence or U14 gate',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const store = new PostgresHarnessStore(pool);
    const snapshotStore = new PostgresExecutionPlanSnapshotStore(pool);
    const inventory = new PostgresLegacyReplayInventory(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-paid-${suffix}`;
    const logicalTaskId = `task-paid-${suffix}`;
    const { request, pendingExecutionPlanSnapshot } = paidPendingFixture(
      suffix,
      workspaceId,
    );
    const successorSnapshot = buildExecutionPlanSnapshot({
      content: {
        ...pendingExecutionPlanSnapshot.content,
        planRevision: pendingExecutionPlanSnapshot.content.planRevision + 1,
        intentDeclaration: { summary: '合法 live-facts drift 后重新确认' },
      },
      confirmationDecisionRef: `paid-reconfirmation-${suffix}`,
    });
    try {
      await store.applySchema();
      await snapshotStore.migrate();
      assert.equal(resolveDurableReplayBranch(request).branch, 'pending_confirmation');
      await new ExecutionPlanAdmissionService(snapshotStore).admitSnapshot({
        workflowId: executionPlanAdmissionWorkflowId(logicalTaskId, {
          executionPlanSnapshot: successorSnapshot,
        }),
        workspaceId,
        snapshot: successorSnapshot,
      });
      const admittedRequest = completedPaidAdmission(request, logicalTaskId);
      const claim = await store.claim({
        taskId: logicalTaskId,
        fingerprint: fingerprintValue(admittedRequest),
        request: admittedRequest,
      });
      assert.equal(claim.kind, 'created');

      const active = await inventory.snapshot();
      assert.equal(active.activePendingCount, 0);
      assert.deepEqual(active.sampleTaskIds, []);

      await inventory.migrateInstallationLedger();
      const claimedRow = await pool.query<{ task_id: string }>(
        `select task_id from harness_runtime.task_requests where workflow_id=$1`,
        [logicalTaskId],
      );
      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1, $2, 'assembly_delivery', 'package_delivered', '{}'::jsonb)`,
        [`paid-delivered-${suffix}`, claimedRow.rows[0]!.task_id],
      );
      assert.match((await inventory.installationEvidence()) ?? '', /migrationChecksum/);
      const terminal = await inventory.snapshot();
      assert.equal(terminal.lastLegacyTerminalAt, null);
      const gate = evaluateLegacyReplayArchiveGate({
        inventory: terminal,
        now: '2026-08-11T00:00:00.000Z',
        rollbackDrillPassed: true,
        auditExportAvailable: true,
        verifiedNoHistoryAuditId: `paid-no-legacy-${suffix}`,
      });
      assert.equal(gate.archiveAllowed, true);
    } finally {
      await pool.query('delete from harness_runtime.audit_events where id=$1', [
        `paid-delivered-${suffix}`,
      ]);
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=$1`,
        [workspaceId],
      );
      await pool.query(
        'delete from p1_execution_plan_snapshots where snapshot_hash=$1',
        [successorSnapshot.snapshotHash],
      );
      await pool.query('drop table if exists p1_legacy_replay_installation_ledger');
      await pool.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      await pool.end();
    }
  },
);

test(
  'paid successor authority rejects forged identity and incomplete admission rows',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const store = new PostgresHarnessStore(pool);
    const snapshotStore = new PostgresExecutionPlanSnapshotStore(pool);
    const inventory = new PostgresLegacyReplayInventory(pool);
    const suffix = randomUUID();
    const workspaceIds: string[] = [];
    const snapshotHashes: string[] = [];
    const blockerIds: string[] = [];
    const claimRequest = async (
      logicalTaskId: string,
      request: HarnessWorkflowInput,
    ) => {
      const admitted = completedPaidAdmission(request, logicalTaskId);
      const claim = await store.claim({
        taskId: logicalTaskId,
        fingerprint: fingerprintValue(admitted),
        request: admitted,
      });
      assert.equal(claim.kind, 'created');
    };
    const admit = async (
      logicalTaskId: string,
      workspaceId: string,
      executionPlanSnapshot: ReturnType<typeof buildExecutionPlanSnapshot>,
    ) => {
      await new ExecutionPlanAdmissionService(snapshotStore).admitSnapshot({
        workflowId: executionPlanAdmissionWorkflowId(logicalTaskId, {
          executionPlanSnapshot,
        }),
        workspaceId,
        snapshot: executionPlanSnapshot,
      });
      snapshotHashes.push(executionPlanSnapshot.snapshotHash);
    };
    const successorFor = (
      fixture: ReturnType<typeof paidPendingFixture>,
      label: string,
      overrides: Partial<ExecutionPlanFrozenContent> = {},
    ) =>
      buildExecutionPlanSnapshot({
        content: {
          ...fixture.pendingExecutionPlanSnapshot.content,
          planRevision:
            fixture.pendingExecutionPlanSnapshot.content.planRevision + 1,
          intentDeclaration: { summary: `reconfirmed successor ${label}` },
          ...overrides,
        },
        confirmationDecisionRef: `reconfirmation-${label}-${suffix}`,
      });
    const insertRawAuthority = async (input: {
      rowSnapshotHash: string;
      workflowId: string;
      workspaceId: string;
      payload: Record<string, unknown>;
      confirmationDecisionRef: string | null;
    }) => {
      await pool.query(
        `insert into p1_execution_plan_snapshots (
           snapshot_hash, workflow_id, workspace_id, plan_id, plan_revision,
           approval_basis, confirmation_decision_ref, payload, admitted_at
         ) values ($1, $2, $3, $4, $5, 'merchant_confirmed', $6, $7::jsonb, now())`,
        [
          input.rowSnapshotHash,
          input.workflowId,
          input.workspaceId,
          input.payload.planId,
          input.payload.planRevision,
          input.confirmationDecisionRef,
          JSON.stringify(input.payload),
        ],
      );
      snapshotHashes.push(input.rowSnapshotHash);
    };
    try {
      await store.applySchema();
      await snapshotStore.migrate();
      const before = await inventory.snapshot();

      const validId = `paid-valid-${suffix}`;
      const validWorkspace = `workspace-paid-valid-${suffix}`;
      const valid = paidPendingFixture(`valid-${suffix}`, validWorkspace);
      const validSuccessor = successorFor(valid, 'valid');
      workspaceIds.push(validWorkspace);
      await admit(validId, validWorkspace, validSuccessor);
      await claimRequest(validId, valid.request);

      const forgedIdentityId = `paid-forged-identity-${suffix}`;
      const forgedIdentityWorkspace = `workspace-paid-forged-identity-${suffix}`;
      const forgedIdentity = paidPendingFixture(
        `forged-identity-${suffix}`,
        forgedIdentityWorkspace,
      );
      const forgedIdentitySuccessor = successorFor(
        forgedIdentity,
        'forged-identity',
      );
      workspaceIds.push(forgedIdentityWorkspace);
      await admit(
        forgedIdentityId,
        forgedIdentityWorkspace,
        forgedIdentitySuccessor,
      );
      const forgedAdmission = completedPaidAdmission(
        forgedIdentity.request,
        forgedIdentityId,
      );
      const forgedRequest = {
        ...forgedAdmission,
        billingIdentity: {
          ...forgedAdmission.billingIdentity!,
          reservationId: `forged-reservation-${suffix}`,
        },
      };
      const forgedClaim = await store.claim({
        taskId: forgedIdentityId,
        fingerprint: fingerprintValue(forgedRequest),
        request: forgedRequest,
      });
      assert.equal(forgedClaim.kind, 'created');
      blockerIds.push(forgedIdentityId);

      const differentPlanId = `paid-different-plan-${suffix}`;
      const differentPlanWorkspace = `workspace-paid-different-plan-${suffix}`;
      const differentPlan = paidPendingFixture(
        `different-plan-${suffix}`,
        differentPlanWorkspace,
      );
      const differentPlanSuccessor = successorFor(
        differentPlan,
        'different-plan',
        { planId: `unrelated-plan-${suffix}` } as Partial<ExecutionPlanFrozenContent>,
      );
      workspaceIds.push(differentPlanWorkspace);
      await admit(
        differentPlanId,
        differentPlanWorkspace,
        differentPlanSuccessor,
      );
      await claimRequest(differentPlanId, differentPlan.request);
      blockerIds.push(differentPlanId);

      const authorityId = `paid-authority-${suffix}`;
      const copiedTaskId = `paid-copied-task-${suffix}`;
      const copiedTaskWorkspace = `workspace-paid-copied-task-${suffix}`;
      const copiedTask = paidPendingFixture(
        `copied-task-${suffix}`,
        copiedTaskWorkspace,
      );
      const copiedTaskSuccessor = successorFor(copiedTask, 'copied-task');
      workspaceIds.push(copiedTaskWorkspace);
      await admit(
        authorityId,
        copiedTaskWorkspace,
        copiedTaskSuccessor,
      );
      await claimRequest(copiedTaskId, copiedTask.request);
      blockerIds.push(copiedTaskId);

      const copiedWorkspaceId = `paid-copied-workspace-${suffix}`;
      const authorityWorkspace = `workspace-paid-authority-${suffix}`;
      const otherWorkspace = `workspace-paid-other-${suffix}`;
      const copiedWorkspace = paidPendingFixture(
        `copied-workspace-${suffix}`,
        authorityWorkspace,
      );
      const copiedWorkspaceSuccessor = successorFor(
        copiedWorkspace,
        'copied-workspace',
      );
      workspaceIds.push(authorityWorkspace, otherWorkspace);
      await admit(
        copiedWorkspaceId,
        authorityWorkspace,
        copiedWorkspaceSuccessor,
      );
      await claimRequest(copiedWorkspaceId, {
        ...copiedWorkspace.request,
        workspaceId: otherWorkspace,
        factScope: { storeId: otherWorkspace },
      });
      blockerIds.push(copiedWorkspaceId);

      const prefixId = `paid-prefix-${suffix}`;
      const prefixWorkspace = `workspace-paid-prefix-${suffix}`;
      const prefix = paidPendingFixture(`prefix-${suffix}`, prefixWorkspace);
      const prefixSuccessor = successorFor(prefix, 'prefix');
      workspaceIds.push(prefixWorkspace);
      await admit(`${prefixId}-collision`, prefixWorkspace, prefixSuccessor);
      await claimRequest(prefixId, prefix.request);
      blockerIds.push(prefixId);

      const embeddedId = `paid-embedded-mismatch-${suffix}`;
      const embeddedWorkspace = `workspace-paid-embedded-${suffix}`;
      const embedded = paidPendingFixture(
        `embedded-${suffix}`,
        embeddedWorkspace,
      );
      const embeddedSuccessor = successorFor(embedded, 'embedded');
      workspaceIds.push(embeddedWorkspace);
      await insertRawAuthority({
        rowSnapshotHash: embeddedSuccessor.snapshotHash,
        workflowId:
          `${embeddedId}:plan:${embeddedSuccessor.planRevision + 1}:` +
          `${embeddedSuccessor.snapshotHash}-mismatch`,
        workspaceId: embeddedWorkspace,
        payload: structuredClone(embeddedSuccessor) as unknown as Record<
          string,
          unknown
        >,
        confirmationDecisionRef: embeddedSuccessor.confirmationDecisionRef!,
      });
      await claimRequest(embeddedId, embedded.request);
      blockerIds.push(embeddedId);

      const rowHashId = `paid-row-hash-mismatch-${suffix}`;
      const rowHashWorkspace = `workspace-paid-row-hash-${suffix}`;
      const rowHash = paidPendingFixture(`row-hash-${suffix}`, rowHashWorkspace);
      const rowHashSuccessor = successorFor(rowHash, 'row-hash');
      workspaceIds.push(rowHashWorkspace);
      await insertRawAuthority({
        rowSnapshotHash: `${rowHashSuccessor.snapshotHash}-row-mismatch`,
        workflowId: executionPlanAdmissionWorkflowId(rowHashId, {
          executionPlanSnapshot: rowHashSuccessor,
        }),
        workspaceId: rowHashWorkspace,
        payload: structuredClone(rowHashSuccessor) as unknown as Record<
          string,
          unknown
        >,
        confirmationDecisionRef: rowHashSuccessor.confirmationDecisionRef!,
      });
      await claimRequest(rowHashId, rowHash.request);
      blockerIds.push(rowHashId);

      const missingConfirmationId = `paid-missing-confirmation-${suffix}`;
      const missingConfirmationWorkspace =
        `workspace-paid-missing-confirmation-${suffix}`;
      const missingConfirmation = paidPendingFixture(
        `missing-confirmation-${suffix}`,
        missingConfirmationWorkspace,
      );
      const missingConfirmationSuccessor = successorFor(
        missingConfirmation,
        'missing-confirmation',
      );
      const missingConfirmationPayload = structuredClone(
        missingConfirmationSuccessor,
      ) as unknown as Record<string, unknown>;
      delete missingConfirmationPayload.confirmationDecisionRef;
      workspaceIds.push(missingConfirmationWorkspace);
      await insertRawAuthority({
        rowSnapshotHash: missingConfirmationSuccessor.snapshotHash,
        workflowId: executionPlanAdmissionWorkflowId(missingConfirmationId, {
          executionPlanSnapshot: missingConfirmationSuccessor,
        }),
        workspaceId: missingConfirmationWorkspace,
        payload: missingConfirmationPayload,
        confirmationDecisionRef: null,
      });
      await assert.rejects(
        () => store.claim({
          taskId: missingConfirmationId,
          fingerprint: fingerprintValue(missingConfirmation.request),
          request: missingConfirmation.request,
        }),
        /billing identity and confirmation request id/u,
      );
      await insertLegacyPendingRequest({
        pool,
        workflowId: missingConfirmationId,
        request: missingConfirmation.request,
      });
      blockerIds.push(missingConfirmationId);

      const missingId = `paid-missing-final-${suffix}`;
      const missingWorkspace = `workspace-paid-missing-final-${suffix}`;
      const missing = paidPendingFixture(`missing-final-${suffix}`, missingWorkspace);
      workspaceIds.push(missingWorkspace);
      await assert.rejects(
        () => store.claim({
          taskId: missingId,
          fingerprint: fingerprintValue(missing.request),
          request: missing.request,
        }),
        /billing identity and confirmation request id/u,
      );
      await insertLegacyPendingRequest({
        pool,
        workflowId: missingId,
        request: missing.request,
      });
      blockerIds.push(missingId);

      const after = await inventory.snapshot();
      assert.equal(
        after.activePendingCount,
        before.activePendingCount + blockerIds.length,
      );
      for (const blockerId of blockerIds) {
        assert.ok(after.sampleTaskIds.includes(blockerId), blockerId);
      }
      assert.ok(!after.sampleTaskIds.includes(validId));
      const gate = evaluateLegacyReplayArchiveGate({
        inventory: after,
        now: '2026-08-11T00:00:00.000Z',
        rollbackDrillPassed: true,
        auditExportAvailable: true,
        verifiedNoHistoryAuditId: `paid-no-legacy-${suffix}`,
      });
      assert.equal(gate.archiveAllowed, false);
      assert.equal(
        gate.conditions.zeroActivePendingLegacy.count,
        before.activePendingCount + blockerIds.length,
      );
    } finally {
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=any($1::text[])`,
        [workspaceIds],
      );
      await pool.query(
        'delete from p1_execution_plan_snapshots where snapshot_hash=any($1::text[])',
        [snapshotHashes],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres legacy inventory binds canonical plan authority to its workspace and logical task',
  {
    skip: process.env.TEST_DATABASE_URL
      ? false
      : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const store = new PostgresHarnessStore(pool);
    const snapshotStore = new PostgresExecutionPlanSnapshotStore(pool);
    const inventory = new PostgresLegacyReplayInventory(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-canonical-${suffix}`;
    const otherWorkspaceId = `workspace-copied-${suffix}`;
    const logicalTaskId = `task-canonical-${suffix}`;
    const otherLogicalTaskId = `task-copied-${suffix}`;
    const planSnapshot = buildExecutionPlanSnapshot({
      content: {
        planId: `plan-${suffix}`,
        planRevision: 2,
        intentDeclaration: { summary: '生产快照权威库存验证' },
        contextBundleRef: {
          bundleId: `bundle-${suffix}`,
          revision: 1,
          hash: `context-${suffix}`,
        },
        executionPlan: {
          schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
          units: [
            {
              unitId: 'copy-1',
              unitType: 'copy.generate',
              primitive: 'generate',
            },
          ],
          dependencyGroups: [{ groupId: 'copy', unitIds: ['copy-1'] }],
          boundedRetry: {
            'copy-1': {
              maxAttempts: 1,
              maxCostCents: 0,
              retry: { enabled: false },
            },
          },
        },
        deliverables: [
          { deliverableId: 'copy-deliverable', kind: 'copy', quantity: 1 },
        ],
        promptRevisionRefs: {},
        skillManifestRefs: {},
        routeRequirements: [],
        quoteRef: { id: `quote-${suffix}`, revision: 1 },
        rightsRevisionRefs: [],
        factRevisionRefs: [],
        boundedExecution: {
          schemaVersion: 'bounded-execution-snapshot/v1',
          maxIterations: 1,
          maxCostCents: 0,
          maxWallClockMs: 60_000,
          maxDelegations: 0,
          requiredLimits: [],
          consumption: {
            iterations: 0,
            costCents: 0,
            wallClockMs: 0,
            delegations: 0,
          },
          stopReason: null,
          triggeredLimit: null,
        },
        harnessReleaseId: `release-${suffix}`,
        approvalBasis: 'policy_exempt_copy',
      } as unknown as ExecutionPlanFrozenContent,
    });
    const requestFor = (requestWorkspaceId: string): HarnessWorkflowInput => ({
      actorId: 'owner-legacy-inventory',
      workspaceId: requestWorkspaceId,
      packageId: `package-${suffix}`,
      expectedRevision: 1,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '生产快照权威库存验证',
      intent: {
        context: {
          workId: `work-${suffix}`,
          intent: '生产快照权威库存验证',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      factScope: { storeId: requestWorkspaceId },
      executionPlanSnapshot: planSnapshot,
    });
    try {
      await store.applySchema();
      await snapshotStore.migrate();
      const before = await inventory.snapshot();
      await new ExecutionPlanAdmissionService(snapshotStore).admitSnapshot({
        workflowId: executionPlanAdmissionWorkflowId(logicalTaskId, {
          executionPlanSnapshot: planSnapshot,
        }),
        workspaceId,
        snapshot: planSnapshot,
      });

      for (const [taskId, request] of [
        [logicalTaskId, requestFor(workspaceId)],
        [otherLogicalTaskId, requestFor(workspaceId)],
        [logicalTaskId, requestFor(otherWorkspaceId)],
      ] as const) {
        const claim = await store.claim({
          taskId,
          fingerprint: fingerprintValue(request),
          request,
        });
        assert.equal(claim.kind, 'created');
      }

      const after = await inventory.snapshot();
      assert.equal(after.activePendingCount, before.activePendingCount + 2);
    } finally {
      await pool.query(
        `delete from harness_runtime.task_requests
          where request->>'workspaceId'=any($1::text[])`,
        [[workspaceId, otherWorkspaceId]],
      );
      await pool.query(
        'delete from p1_execution_plan_snapshots where snapshot_hash=$1',
        [planSnapshot.snapshotHash],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres legacy inventory sees a legacy row beyond 500 non-legacy rows',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const prefix = `legacy-inventory-${randomUUID()}`;
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      const inventory = new PostgresLegacyReplayInventory(pool);
      const before = await inventory.snapshot();
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         select $1 || '-runtime-new-' || series::text,
                $1 || '-logical-new-' || series::text,
                $1 || '-runtime-new-' || series::text,
                'fixture',
                jsonb_build_object(
                  'workspaceId',
                  'fixture-workspace',
                  'executionPlanSnapshot',
                  jsonb_build_object(
                    'snapshotHash', $1 || '-snapshot-' || series::text,
                    'planRevision', 1
                  )
                ),
                '1900-01-01T00:00:00.000Z'::timestamptz + series * interval '1 second'
         from generate_series(1, 501) series`,
        [prefix],
      );
      await pool.query(
        `insert into p1_execution_plan_snapshots (
           snapshot_hash, workflow_id, workspace_id, plan_id, plan_revision,
           approval_basis, confirmation_decision_ref, payload, admitted_at
         )
         select $1 || '-snapshot-' || series::text,
                $1 || '-logical-new-' || series::text || ':plan:1:' ||
                  $1 || '-snapshot-' || series::text,
                'fixture-workspace',
                $1 || '-plan-' || series::text,
                1,
                'merchant_confirmed',
                null,
                jsonb_build_object(
                  'snapshotHash', $1 || '-snapshot-' || series::text,
                  'planRevision', 1
                ),
                '1900-01-01T00:00:00.000Z'::timestamptz + series * interval '1 second'
         from generate_series(1, 501) series`,
        [prefix],
      );
      const legacyTaskId = `${prefix}-legacy`;
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request, created_at)
         values ($2, $1, $2, 'fixture', '{}'::jsonb, '1900-01-02T00:00:00.000Z')`,
        [legacyTaskId, `${prefix}-runtime-legacy`],
      );

      const snapshot = await inventory.snapshot();
      assert.equal(
        snapshot.activePendingCount,
        before.activePendingCount + 1,
      );
      assert.ok(snapshot.sampleTaskIds.includes(legacyTaskId));
    } finally {
      await pool.query(
        `delete from p1_execution_plan_snapshots where workflow_id like $1`,
        [`${prefix}-logical-%`],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where workflow_id like $1`,
        [`${prefix}%`],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres legacy inventory treats malformed and unadmitted snapshots as blockers',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const prefix = `legacy-malformed-${randomUUID()}`;
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      await pool.query(
        `insert into harness_runtime.task_requests
          (task_id, workflow_id, runtime_id, fingerprint, request)
         values
          ($1, $1, $2, 'fixture', '{"executionPlanSnapshot":{"schemaVersion":"unknown"}}'::jsonb),
          ($3, $3, $4, 'fixture', '{"executionPlanSnapshot":"corrupt"}'::jsonb)`,
        [`${prefix}-unknown`, `${prefix}-runtime-unknown`, `${prefix}-corrupt`, `${prefix}-runtime-corrupt`],
      );
      const snapshot = await new PostgresLegacyReplayInventory(pool).snapshot();
      assert.ok(snapshot.sampleTaskIds.includes(`${prefix}-unknown`));
      assert.ok(snapshot.sampleTaskIds.includes(`${prefix}-corrupt`));
    } finally {
      await pool.query('delete from harness_runtime.task_requests where task_id like $1', [`${prefix}%`]);
      await pool.end();
    }
  },
);

test(
  'legacy replay installation ledger rejects tampering in Postgres',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await new PostgresHarnessStore(pool).applySchema();
      await new PostgresExecutionPlanSnapshotStore(pool).migrate();
      const inventory = new PostgresLegacyReplayInventory(pool);
      await inventory.migrateInstallationLedger();
      await pool.query(
        `insert into p1_legacy_replay_installation_ledger
           (singleton, deployment_id, migration_checksum, initial_legacy_count)
         values (true, $1, $2, 0)
         on conflict (singleton) do nothing`,
        [
          'v31-26a-legacy-replay-ledger-v1',
          createHash('sha256')
            .update('v31-26a-legacy-replay-ledger-v1')
            .digest('hex'),
        ],
      );
      await assert.rejects(
        () =>
          pool.query(
            `update p1_legacy_replay_installation_ledger
                set initial_legacy_count=1
              where singleton=true`,
          ),
        /immutable/,
      );
      assert.match((await inventory.installationEvidence()) ?? '', /migrationChecksum/);
    } finally {
      await pool.query('drop table if exists p1_legacy_replay_installation_ledger');
      await pool.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      await pool.end();
    }
  },
);

/**
 * V31-26a / U14: ledger migration still serializes against task admission.
 * Snapshot-less claims are archived fail-closed independently of the ledger.
 */
test(
  'legacy replay installation serializes and U14 refuses snapshot-less admission',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const suffix = randomUUID();
    const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const migrationPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      application_name: `legacy-ledger-migration-${suffix}`,
    });
    const admissionPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      application_name: `legacy-task-admission-${suffix}`,
    });
    const taskId = `legacy-ledger-race-${suffix}`;
    const blocker = await control.connect();
    try {
      await new PostgresHarnessStore(control).applySchema();
      await new PostgresExecutionPlanSnapshotStore(control).migrate();
      await control.query('drop table if exists p1_legacy_replay_installation_ledger cascade');
      await control.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      const before = await new PostgresLegacyReplayInventory(control).snapshot();
      if (before.activePendingCount !== 0 || before.lastLegacyTerminalAt !== null) {
        t.skip('shared Postgres fixture contains pre-existing legacy history');
        return;
      }

      await blocker.query('begin');
      await blocker.query('select pg_advisory_xact_lock(hashtext($1))', [
        LEGACY_REPLAY_ADMISSION_LOCK,
      ]);
      const migration = new PostgresLegacyReplayInventory(
        migrationPool,
      ).migrateInstallationLedger();
      await waitForAdvisoryLock(control, `legacy-ledger-migration-${suffix}`);

      const admission = new PostgresHarnessStore(admissionPool).claim({
        taskId,
        fingerprint: `fingerprint-${suffix}`,
        request: {
          actorId: 'owner-ledger-race',
          workspaceId: `workspace-ledger-race-${suffix}`,
          packageId: `package-ledger-race-${suffix}`,
          expectedRevision: 0,
          workflowRevision: 1,
          creationMode: 'customized',
          rawInput: '旧链并发准入',
          intent: {
            context: {
              workId: `work-ledger-race-${suffix}`,
              intent: '旧链并发准入',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
        },
      });
      await waitForAdvisoryLock(control, `legacy-task-admission-${suffix}`);
      await blocker.query('commit');

      await migration;
      // U14: snapshot-less claim is archived fail-closed even while the
      // installation ledger serializes on the same advisory lock.
      await assert.rejects(admission, /archived fail-closed \(U14\)/);
      const rows = await control.query<{ count: string }>(
        `select count(*)::text as count
           from harness_runtime.task_requests
          where workflow_id=$1`,
        [taskId],
      );
      assert.equal(rows.rows[0]?.count, '0');
      assert.match(
        (await new PostgresLegacyReplayInventory(control).installationEvidence()) ?? '',
        /migrationChecksum/,
      );

      await assert.rejects(
        new PostgresHarnessStore(admissionPool).claim({
          taskId: `${taskId}-sealed`,
          fingerprint: `fingerprint-sealed-${suffix}`,
          request: {
            actorId: 'owner-ledger-race',
            workspaceId: `workspace-ledger-race-${suffix}`,
            packageId: `package-ledger-race-${suffix}`,
            expectedRevision: 0,
            workflowRevision: 1,
            creationMode: 'customized',
            rawInput: '旧链并发准入',
            intent: {
              context: {
                workId: `work-ledger-race-${suffix}`,
                intent: '旧链并发准入',
                sourceSummaries: [],
              },
              assetReferences: [],
            },
          },
        }),
        /archived fail-closed \(U14\)/,
      );
    } finally {
      await blocker.query('rollback').catch(() => undefined);
      blocker.release();
      // The seal must not outlive this test: a leftover seal row closes legacy
      // admission for every later claim() against the same database. Truncate
      // does not fire the append-only row trigger.
      await control
        .query('truncate table harness_runtime.legacy_replay_admission_seal')
        .catch(() => undefined);
      await control.query(
        `delete from harness_runtime.audit_events where id=$1`,
        [`seal-proof-${suffix}`],
      );
      await control.query(
        'delete from harness_runtime.task_requests where workflow_id like $1',
        [`${taskId}%`],
      );
      await control.query('drop table if exists p1_legacy_replay_installation_ledger cascade');
      await control.query('drop function if exists p1_reject_legacy_replay_ledger_mutation()');
      await Promise.all([
        control.end(),
        migrationPool.end(),
        admissionPool.end(),
      ]);
    }
  },
);

async function waitForAdvisoryLock(pool: Pool, applicationName: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
          where application_name=$1
            and wait_event_type='Lock'
            and wait_event='advisory'
       ) as waiting`,
      [applicationName],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not wait for the admission lock.`);
}
