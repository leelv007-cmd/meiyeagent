import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { Pool } from 'pg';
import { P1ApplicationService } from '../foundation/application-service.js';
import { ProductEntitlementApplicationService } from '../foundation/entitlement-service.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { PostgresRelationalProductRepository } from '../../product/relational-product-repository.js';
import { ProductService } from '../../product/product-service.js';
import { P1CutoverExecutionService } from './execution-service.js';
import { PostgresLegacyInFlightDecisionPort } from './inflight-decision-port.js';
import { legacyStateRevision } from './legacy-mapper.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function legacyState(workspaceId: string, marker: string) {
  return {
    workspaceId,
    assets: [
      {
        id: `asset-${marker}`,
        objectKey: `legacy/${marker}.jpg`,
        authorizationStatus: 'authorized',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    contents: [
      {
        id: `content-${marker}`,
        status: 'draft',
        createdAt: '2026-07-01T00:00:00.000Z',
        variants: [
          {
            id: `variant-${marker}`,
            platform: 'xiaohongshu',
            versions: [
              {
                id: `version-${marker}-1`,
                createdAt: '2026-07-01T00:00:00.000Z',
              },
              {
                id: `version-${marker}-2`,
                createdAt: '2026-07-02T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
    storyboards: [],
    videoJobs: [
      {
        id: `video-${marker}`,
        storyboardId: `story-${marker}`,
        status: 'queued',
        leaseOwner: `legacy-worker-${marker}`,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    videoRenderEvidence: [],
    videoArtifacts: [],
    handoffPackages: [],
    entitlement: {
      plan: 'starter',
      content: { allowance: 10, remaining: 9 },
      image: { allowance: 3, remaining: 3 },
      video: { allowance: 5, remaining: 5 },
      package: { allowance: 2, remaining: 2 },
      storageMb: { allowance: 100, remaining: 100 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard',
    },
    usageEvents: [
      {
        id: `usage-${marker}-reserved`,
        resource: 'content',
        status: 'reserved',
        amount: 1,
        reservationId: `reservation-${marker}`,
        reason: 'Legacy content reservation',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: `usage-${marker}-committed`,
        resource: 'content',
        status: 'committed',
        amount: 1,
        reservationId: `reservation-${marker}`,
        reason: 'Legacy content commit',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ],
    auditEvents: [],
    complianceResults: [],
    agentRuns: [],
    toolCalls: [],
    updatedAt: '2026-07-10T00:00:00.000Z',
  } as unknown as ProductState;
}

test(
  'Postgres cutover is isolated, repeatable and rolls back only future entry',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString: databaseUrl, max: 6 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS product_states (
        workspace_id text PRIMARY KEY,
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );
    `);
    await new PostgresRelationalProductRepository(pool).migrate();
    const service = new P1CutoverExecutionService(pool);
    await service.migrate();
    const suffix = randomUUID();
    const workspaceA = `cutover-a-${suffix}`;
    const workspaceB = `cutover-b-${suffix}`;
    const operatorA = `operator-a-${suffix}`;
    const operatorB = `operator-b-${suffix}`;
    const stateA = legacyState(workspaceA, 'a');
    const stateB = legacyState(workspaceB, 'b');
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Cutover A'), ($2, 'Cutover B')`,
      [workspaceA, workspaceB]
    );
    await pool.query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Cutover operator A', $2), ($3, 'Cutover operator B', $4)`,
      [
        operatorA,
        `${operatorA}@example.test`,
        operatorB,
        `${operatorB}@example.test`,
      ]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [workspaceA, operatorA, workspaceB, operatorB]
    );
    await pool.query(
      `INSERT INTO product_states (workspace_id, state)
       VALUES ($1, $2::jsonb), ($3, $4::jsonb)`,
      [workspaceA, JSON.stringify(stateA), workspaceB, JSON.stringify(stateB)]
    );
    t.after(async () => {
      for (const table of [
        'p1_rollback_rehearsals',
        'p1_restore_rehearsal_snapshots',
        'p1_restore_rehearsals',
        'p1_cutover_inflight_decisions',
        'p1_legacy_backups',
        'p1_cutover_execution_runs',
        'p1_migration_manifests',
        'p1_write_ownership',
      ]) {
        await pool.query(
          `DELETE FROM ${table} WHERE workspace_id = ANY($1::text[])`,
          [[workspaceA, workspaceB]]
        );
      }
      await pool.query(
        'DELETE FROM p1_relation_facts WHERE workspace_id = ANY($1::text[])',
        [[workspaceA, workspaceB]]
      );
      await pool.query(
        'DELETE FROM product_states WHERE workspace_id = ANY($1::text[])',
        [[workspaceA, workspaceB]]
      );
      await pool.query('DELETE FROM workspaces WHERE id = ANY($1::text[])', [
        [workspaceA, workspaceB],
      ]);
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [
        [operatorA, operatorB],
      ]);
      await pool.end();
    });

    const contextA = {
      workspaceId: workspaceA,
      actorId: operatorA,
      correlationId: 'cutover-a',
    };
    const contextB = {
      workspaceId: workspaceB,
      actorId: operatorB,
      correlationId: 'cutover-b',
    };
    const firstPlan = await service.plan(contextA);
    const replayedPlan = await service.plan(contextA);
    assert.equal(replayedPlan.runId, firstPlan.runId);
    assert.deepEqual(replayedPlan.manifest, firstPlan.manifest);
    await assert.rejects(
      service.backup(contextB, firstPlan.runId),
      /does not match the current legacy revision/
    );

    const backup = await service.backup(contextA, firstPlan.runId);
    assert.equal(backup.backupHash, firstPlan.manifest.sourceRevision);
    const restore = await service.rehearseRestore(contextA, firstPlan.runId);
    assert.equal(restore.status, 'passed');
    assert.equal(restore.verifiedWithoutOverwrite, true);
    assert.equal(restore.rpoSeconds, 0);
    assert.match(restore.evidenceRef, /^postgres:p1_restore_rehearsals\//);
    const decisions = await service.freeze(contextA, firstPlan.runId);
    assert.deepEqual(decisions, [
      {
        allowRegeneration: false,
        decision: 'legacy_drain',
        jobId: 'video-a',
        owner: 'legacy-worker-a',
        preserveOriginalTaskRef: true,
        reason:
          'No provider acceptance evidence exists; drain the original legacy job.',
        status: 'queued',
      },
    ]);
    assert.deepEqual(
      await new PostgresLegacyInFlightDecisionPort(pool).get(
        workspaceA,
        'video-a'
      ),
      decisions[0]
    );
    const firstBackfill = await service.backfill(contextA, firstPlan.runId);
    assert.equal(
      firstBackfill.differenceCount,
      0,
      JSON.stringify(firstBackfill, null, 2)
    );
    assert.ok(
      firstBackfill.usageDifferences.quotaReconciliation.every(
        (item) => item.matches
      )
    );
    const foundation = new P1ApplicationService(
      new PostgresFoundationRepository(pool)
    );
    const foundationContext = {
      workspaceId: workspaceA,
      userId: operatorA,
      correlationId: 'cutover-usage-continuity',
    };
    assert.equal(
      (await foundation.getUsageProjection(foundationContext, 'copy'))
        .available,
      9
    );
    const countAfterFirst = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_relation_facts
        WHERE workspace_id = $1 AND legacy_source = $2`,
      [workspaceA, `product_states:${workspaceA}`]
    );
    const replayedBackfill = await service.backfill(contextA, firstPlan.runId);
    const countAfterReplay = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_relation_facts
        WHERE workspace_id = $1 AND legacy_source = $2`,
      [workspaceA, `product_states:${workspaceA}`]
    );
    assert.equal(replayedBackfill.differenceCount, 0);
    assert.equal(
      countAfterReplay.rows[0]?.count,
      countAfterFirst.rows[0]?.count
    );
    assert.equal(
      Number(countAfterReplay.rows[0]?.count),
      firstPlan.manifest.factCount
    );
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM p1_relation_facts WHERE workspace_id = $1',
          [workspaceB]
        )
      ).rowCount,
      0
    );

    const activated = await service.activate(contextA, firstPlan.runId);
    assert.equal(activated.futureWriteOwner, 'p1');
    await foundation.appendUsageEvent(
      foundationContext,
      {
        id: 'post-cutover-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'post-cutover-copy',
        reason: 'first P1 copy after cutover',
      },
      'post-cutover-copy-reserve'
    );
    await foundation.appendUsageEvent(
      foundationContext,
      {
        id: 'post-cutover-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 1,
        reservationId: 'post-cutover-copy',
        reason: 'first P1 copy after cutover',
      },
      'post-cutover-copy-commit'
    );
    const afterFirstP1Copy = await foundation.getUsageProjection(
      foundationContext,
      'copy'
    );
    assert.equal(afterFirstP1Copy.available, 8);
    assert.equal(afterFirstP1Copy.committed, 2);
    const relational = new PostgresRelationalProductRepository(pool);
    const p1State = await new ProductService(
      relational,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'p1'
    ).bootstrap({
      actor: 'user',
      correlationId: 'post-cutover-product-change',
      userId: operatorA,
      workspaceId: workspaceA,
    });
    p1State.auditEvents.push({
      action: 'content.created_after_cutover',
      correlationId: 'post-cutover-product-change',
      createdAt: '2026-07-11T01:00:00.000Z',
      entityId: 'post-cutover-content',
      entityType: 'content',
      id: 'post-cutover-product-audit',
      userId: operatorA,
    });
    p1State.updatedAt = '2026-07-11T01:00:00.000Z';
    await relational.withWorkspaceLock(workspaceA, (repository) =>
      repository.save(p1State, {
        actor: 'user',
        correlationId: 'post-cutover-product-change',
        userId: operatorA,
        workspaceId: workspaceA,
      })
    );
    const entitlementService = new ProductEntitlementApplicationService(
      new PostgresFoundationRepository(pool)
    );
    await entitlementService.activatePlan(
      foundationContext,
      {
        paymentEventId: 'paid-pro-upgrade-before-rollback',
        policy: {
          allowance: { audio: 0, copy: 15, image: 3, video: 5 },
          concurrencyLimit: 8,
          periodEndsAt: '2026-08-01T00:00:00.000Z',
          periodId: '2026-07',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          queuePriority: 10,
          revision: 'pro-2026-07',
          supportLabel: 'priority',
          tier: 'pro',
        },
      },
      'activate-pro-before-rollback'
    );
    assert.equal(
      (await foundation.getUsageProjection(foundationContext, 'copy'))
        .available,
      13
    );
    await pool.query(
      `INSERT INTO p1_relation_facts
         (workspace_id, id, kind, data, actor_id, correlation_id, created_at)
       VALUES ($1, 'post-cutover-job', 'video_job', '{"status":"queued"}'::jsonb,
               'p1-worker', 'post-cutover', now())`,
      [workspaceA]
    );
    await foundation.checkpointGenerationAttempt(
      foundationContext,
      {
        attempt: {
          deploymentId: 'copy-rollback-direct',
          id: 'copy-rollback-attempt',
        },
        jobId: 'copy-rollback-inflight',
        operation: 'copy',
        routeSnapshot: {
          allowedCandidates: [
            {
              catalogModelId: 'copy-model',
              credentialMode: 'platform',
              credentialVersion: 'v1',
              deploymentId: 'copy-rollback-direct',
              fallbackRank: 1,
              region: 'cn',
            },
          ],
          catalogRevision: 'catalog-v1',
          dataClass: 'public',
          dataClasses: ['public'],
          fallbackConsent: false,
          id: 'copy-rollback-route',
          policyRevision: 'policy-v1',
          priceRevision: 'price-v1',
          providerRetryDisabled: true,
          requestedCatalogModelId: 'copy-model',
          retryOwner: 'product',
          selectionMode: 'fixed',
        },
        usageAmount: 1,
        usageReservationId: 'copy-rollback-reservation',
      },
      'copy-rollback-checkpoint'
    );
    await pool.query(
      `INSERT INTO p1_product_command_results
         (workspace_id, idempotency_key, payload_hash, result)
       VALUES ($1, 'pending-before-rollback', 'payload-hash',
               '{"kind":"pending","startedAt":"2026-07-11T00:00:00.000Z","correlationId":"pending-cutover"}'::jsonb)`,
      [workspaceA]
    );
    const legacyBeforeRow = (
      await pool.query<{ state: ProductState }>(
        'SELECT state FROM product_states WHERE workspace_id = $1',
        [workspaceA]
      )
    ).rows[0];
    assert.ok(legacyBeforeRow);
    const legacyBeforeRollback = legacyStateRevision(legacyBeforeRow.state);
    const rollback = await service.rollbackFutureWrites(
      contextA,
      firstPlan.runId,
      'future entry rollback with P1 recovery preserved'
    );
    assert.equal(rollback.futureWriteOwner, 'legacy');
    assert.equal(rollback.restoredLegacySnapshot, false);
    assert.equal(rollback.materializedP1Projection, true);
    assert.equal(rollback.rpoSeconds, 0);
    assert.deepEqual(rollback.pendingP1ProductCommandKeys, [
      'pending-before-rollback',
    ]);
    assert.deepEqual(rollback.inFlightP1Jobs, [
      {
        allowRegeneration: false,
        jobId: 'copy-rollback-inflight',
        owner: 'p1',
        routeSnapshotId: 'copy-rollback-route',
      },
    ]);
    assert.match(rollback.evidenceRef, /^postgres:p1_rollback_rehearsals\//);
    assert.equal(
      (
        await pool.query(
          `SELECT 1 FROM p1_relation_facts
            WHERE workspace_id = $1 AND id = 'post-cutover-job'`,
          [workspaceA]
        )
      ).rowCount,
      1
    );
    const legacyAfterRow = (
      await pool.query<{ state: ProductState }>(
        'SELECT state FROM product_states WHERE workspace_id = $1',
        [workspaceA]
      )
    ).rows[0];
    assert.ok(legacyAfterRow);
    const legacyAfterRollback = legacyStateRevision(legacyAfterRow.state);
    assert.notEqual(legacyAfterRollback, legacyBeforeRollback);
    assert.ok(
      legacyAfterRow.state.auditEvents.some(
        (event) => event.id === 'post-cutover-product-audit'
      )
    );
    assert.equal(legacyAfterRow.state.entitlement.plan, 'pro');
    assert.equal(legacyAfterRow.state.entitlement.content.allowance, 15);
    assert.equal(legacyAfterRow.state.entitlement.content.remaining, 12);
    assert.equal(legacyAfterRow.state.entitlement.concurrencyLimit, 8);
    assert.equal(legacyAfterRow.state.entitlement.queuePriority, 10);
    assert.equal(legacyAfterRow.state.entitlement.supportLabel, 'priority');

    const routeBeforeRecovery = await foundation.getRouteSnapshot(
      foundationContext,
      'copy-rollback-route'
    );
    await foundation.settleGenerationFailure(
      foundationContext,
      {
        jobId: 'copy-rollback-inflight',
        reason: 'the original P1 owner settled after future entry rollback',
      },
      'copy-rollback-failed'
    );
    const routeAfterRecovery = await foundation.getRouteSnapshot(
      foundationContext,
      'copy-rollback-route'
    );
    assert.deepEqual(routeAfterRecovery, routeBeforeRecovery);
    assert.equal(
      (
        await foundation.getGenerationJob(
          foundationContext,
          'copy-rollback-inflight'
        )
      ).status,
      'failed'
    );
    assert.equal(
      (await foundation.getUsageProjection(foundationContext, 'copy'))
        .available,
      13
    );

    const ledgerCountBeforeReplay = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_usage_events
        WHERE workspace_id = $1 AND id LIKE 'legacy:usage:%'`,
      [workspaceA]
    );
    const repeatedPlan = await service.plan(contextA);
    assert.notEqual(repeatedPlan.runId, firstPlan.runId);
    await service.backup(contextA, repeatedPlan.runId);
    const repeatedRestore = await service.rehearseRestore(
      contextA,
      repeatedPlan.runId
    );
    assert.notEqual(repeatedRestore.rehearsalId, restore.rehearsalId);
    await service.freeze(contextA, repeatedPlan.runId);
    const repeatedWindow = await service.backfill(contextA, repeatedPlan.runId);
    assert.equal(
      repeatedWindow.differenceCount,
      0,
      JSON.stringify(repeatedWindow, null, 2)
    );
    const ledgerCountAfterNewSource = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_usage_events
        WHERE workspace_id = $1 AND id LIKE 'legacy:usage:%'`,
      [workspaceA]
    );
    await service.backfill(contextA, repeatedPlan.runId);
    const ledgerCountAfterSameRunReplay = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_usage_events
        WHERE workspace_id = $1 AND id LIKE 'legacy:usage:%'`,
      [workspaceA]
    );
    assert.equal(
      ledgerCountAfterSameRunReplay.rows[0]?.count,
      ledgerCountAfterNewSource.rows[0]?.count
    );
    await service.activate(contextA, repeatedPlan.runId);
    await service.rollbackFutureWrites(
      contextA,
      repeatedPlan.runId,
      'repeat rollback rehearsal'
    );
    const ledgerCountAfterReplay = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM p1_usage_events
        WHERE workspace_id = $1 AND id LIKE 'legacy:usage:%'`,
      [workspaceA]
    );
    assert.ok(
      Number(ledgerCountAfterReplay.rows[0]?.count) >=
        Number(ledgerCountBeforeReplay.rows[0]?.count)
    );
    const afterRecutover = await foundation.getUsageProjection(
      foundationContext,
      'copy'
    );
    assert.equal(afterRecutover.allowance, 15);
    assert.equal(afterRecutover.available, 13);
    assert.equal(afterRecutover.committed, 2);
    assert.equal(
      (
        await pool.query(
          `SELECT 1 FROM p1_relation_facts
            WHERE workspace_id = $1 AND id = 'post-cutover-job'`,
          [workspaceA]
        )
      ).rowCount,
      1
    );
    await assert.rejects(
      service.rollbackFutureWrites(
        contextA,
        repeatedPlan.runId,
        'invalid repeated rollback'
      ),
      /Only an active cutover run/
    );
    const failedRollbackEvidence = await pool.query(
      `SELECT 1 FROM p1_rollback_rehearsals
        WHERE workspace_id = $1 AND run_id = $2
          AND evidence->>'status' = 'failed'
          AND evidence->>'operator' = $3`,
      [workspaceA, repeatedPlan.runId, contextA.actorId]
    );
    assert.equal(failedRollbackEvidence.rowCount, 1);
    const inspection = await service.inspect(contextA, repeatedPlan.runId);
    assert.equal(inspection.run.status, 'rolled_back');
    assert.equal(inspection.run.dryRunDifferenceCount, 0);
    assert.equal(inspection.futureWriteOwner, 'legacy');
    assert.equal(inspection.restoreRehearsals.length, 1);
    assert.equal(inspection.rollbackRehearsals.length, 2);
    assert.equal(inspection.manifest?.workspaceId, workspaceA);
    await assert.rejects(
      service.inspect(contextB, repeatedPlan.runId),
      /Cutover run was not found/
    );

    const planB = await service.plan(contextB);
    await service.backup(contextB, planB.runId);
    await service.rehearseRestore(contextB, planB.runId);
    await pool.query(
      `UPDATE product_states
          SET state = jsonb_set(state, '{updatedAt}', '"2026-07-11T12:00:00.000Z"')
        WHERE workspace_id = $1`,
      [workspaceB]
    );
    await assert.rejects(
      service.freeze(contextB, planB.runId),
      /Legacy state changed after the migration manifest was created/
    );
    const ownerB = await pool.query<{ owner: string }>(
      'SELECT owner FROM p1_write_ownership WHERE workspace_id = $1',
      [workspaceB]
    );
    assert.equal(ownerB.rows[0], undefined);
  }
);
