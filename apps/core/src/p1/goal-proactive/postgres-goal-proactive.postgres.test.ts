/**
 * PostgreSQL acceptance for MarketingGoal + opportunity decision log (V31-24).
 * Also covers coverage projection contract against durable package-shaped facts
 * (operations ContentPackage is the physical store; projection is pure over rows).
 * Skips when TEST_DATABASE_URL is unset (no self-started Postgres).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import type { ProactiveSignal } from '@meiye/contracts';

import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { MemoryAgentSessionStore } from '../agent-session/memory-agent-session-store.js';
import {
  ContentPackageEvidenceCoveragePort,
  projectEvidenceCoverageCounts,
  type OwnedContentPackageFact,
} from './content-package-facts.js';
import { GoalService } from './goal-service.js';
import { MarketingGoalStoreError } from './goal-store.js';
import { PostgresMarketingGoalStore } from './postgres-goal-store.js';
import { PostgresOpportunityDecisionStore } from './postgres-opportunity-decision-store.js';
import { buildCandidateId } from './proactive-pipeline.js';
import { ProactiveService } from './proactive-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

test(
  'Postgres marketing goals + opportunity decisions migrate and enforce OCC/idempotency',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const goals = new PostgresMarketingGoalStore(pool);
    const decisions = new PostgresOpportunityDecisionStore(pool);
    try {
      await migratePostgresSchema(pool, [goals, decisions]);
      await migratePostgresSchema(pool, [goals, decisions]);

      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('p1_marketing_goals', 'p1_opportunity_decisions')
          ORDER BY table_name`,
      );
      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        ['p1_marketing_goals', 'p1_opportunity_decisions'],
      );

      // No candidate aggregate table.
      const candidateTable = await pool.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'p1_opportunity_candidates'`,
      );
      assert.equal(candidateTable.rowCount, 0);

      const suffix = randomUUID().slice(0, 8);
      const resourceId = `ws-pg-goal-${suffix}`;
      const goalId = `goal-pg-${suffix}`;
      const service = new GoalService({ goals });

      const created = await goals.create({
        goalId,
        resourceId,
        objective: 'inquiry',
        statement: 'PG 目标',
        priority: 'high',
        now: '2026-08-08T12:00:00.000Z',
      });
      assert.equal(created.revision, 0);

      const paused = await goals.transitionStatus({
        resourceId,
        goalId,
        expectedRevision: 0,
        nextStatus: 'paused',
        now: '2026-08-08T13:00:00.000Z',
      });
      assert.equal(paused.revision, 1);
      assert.equal(paused.status, 'paused');

      await assert.rejects(
        () =>
          goals.transitionStatus({
            resourceId,
            goalId,
            expectedRevision: 0,
            nextStatus: 'active',
            now: '2026-08-08T14:00:00.000Z',
          }),
        (error: unknown) =>
          error instanceof MarketingGoalStoreError &&
          error.code === 'GOAL_REVISION_CONFLICT',
      );

      // Accept takes no candidate body: the reason and goal it records come
      // from reprojecting owned signals, so the PG round-trip has to go through
      // the same source production uses.
      const ownedSignal = {
        resourceId,
        kind: 'goal_stalled',
        summary: 'PG accept',
        goalId,
        weight: 2,
        observedAt: '2026-08-08T14:30:00.000Z',
        evidenceRefs: [{ kind: 'goal_stalled', ref: goalId }],
      } as unknown as ProactiveSignal;
      const candidateId = buildCandidateId({
        resourceId,
        signalKinds: ['goal_stalled'],
        goalId,
        reason: 'PG accept',
      });
      const openGate = {
        disableProactiveAgent: false,
        proactiveFeatureOn: true,
        workspaceAllowlisted: true,
        coverageThreshold: null,
      };
      const proactive = new ProactiveService({
        decisions,
        threads: new MemoryAgentSessionStore(),
        signals: { listSignals: () => [ownedSignal] },
        defaultHarnessReleaseId: 'release-pg',
      });

      const first = await proactive.acceptCandidate({
        resourceId,
        candidateId,
        actorId: 'merchant-pg',
        now: '2026-08-08T15:00:00.000Z',
        config: openGate,
      });
      assert.equal(first.replayed, false);
      assert.equal(first.paidSideEffect, false);

      const second = await proactive.acceptCandidate({
        resourceId,
        candidateId,
        actorId: 'merchant-pg',
        now: '2026-08-08T16:00:00.000Z',
        config: openGate,
      });
      assert.equal(second.replayed, true);
      assert.equal(second.threadId, first.threadId);
      assert.equal(second.runId, first.runId);

      // Service path still works against PG goal store.
      const listed = await service.listGoals({ resourceId });
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.goalId, goalId);

      // Coverage projection contract: durable decision log coexists with
      // ContentPackage-shaped facts (physical evidence lives on packages).
      // Store fixture rows in a scratch table to prove PG round-trip of counts.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS p1_goal_proactive_coverage_fixture (
          workspace_id text NOT NULL,
          package_id text NOT NULL,
          payload jsonb NOT NULL,
          PRIMARY KEY (workspace_id, package_id)
        )
      `);
      const packages: OwnedContentPackageFact[] = [
        {
          id: `cp-d-${suffix}`,
          workspaceId: resourceId,
          status: 'review_ready',
          updatedAt: '2026-07-01T00:00:00.000Z',
          resultSignals: [
            {
              id: `sig-${suffix}`,
              kind: 'inquiry',
              occurredAt: '2026-08-01T00:00:00.000Z',
              // Production rows always name the exact consumed revision;
              // quarantined `'unknown'` rows are not provable evidence.
              contentPackageRevision: 3,
              status: 'active',
            },
          ],
        },
        {
          id: `cp-bare-${suffix}`,
          workspaceId: resourceId,
          status: 'accepted',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ];
      for (const row of packages) {
        await pool.query(
          `INSERT INTO p1_goal_proactive_coverage_fixture
             (workspace_id, package_id, payload)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (workspace_id, package_id)
           DO UPDATE SET payload = EXCLUDED.payload`,
          [resourceId, row.id, JSON.stringify(row)],
        );
      }
      const loaded = await pool.query<{ payload: OwnedContentPackageFact }>(
        `SELECT payload FROM p1_goal_proactive_coverage_fixture
          WHERE workspace_id = $1`,
        [resourceId],
      );
      const fromDb = loaded.rows.map((row) => row.payload);
      const counts = projectEvidenceCoverageCounts({
        resourceId,
        packages: fromDb,
      });
      assert.equal(counts.denominator, 2);
      assert.equal(counts.numerator, 1);

      const coveragePort = new ContentPackageEvidenceCoveragePort({
        listPackages: async ({ resourceId: ws }) => {
          const result = await pool.query<{ payload: OwnedContentPackageFact }>(
            `SELECT payload FROM p1_goal_proactive_coverage_fixture
              WHERE workspace_id = $1`,
            [ws],
          );
          return result.rows.map((row) => row.payload);
        },
      });
      assert.equal(await coveragePort.countDelivered({ resourceId }), 2);
      assert.equal(await coveragePort.countWithEvidence({ resourceId }), 1);

      await pool.query(
        `DELETE FROM p1_goal_proactive_coverage_fixture WHERE workspace_id = $1`,
        [resourceId],
      );
    } finally {
      await pool.end();
    }
  },
);
