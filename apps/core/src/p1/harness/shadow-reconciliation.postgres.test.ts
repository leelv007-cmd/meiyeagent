import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresShadowReconciliationStore } from './shadow-reconciliation-store.js';
import type {
  ShadowProgramState,
  ShadowReconciliationSample,
} from './shadow-reconciliation.js';

test(
  'Postgres shadow close and sample insertion have one serializable winner',
  {
    skip: process.env.TEST_DATABASE_URL
      ? false
      : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const store = new PostgresShadowReconciliationStore(pool);
    const suffix = randomUUID();
    const workflowId = `shadow-race-${suffix}`;
    let previousState: ShadowProgramState | null = null;
    try {
      await store.migrate();
      previousState = await store.getProgramState();
      const open: ShadowProgramState = {
        status: 'open',
        openedAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        closeReason: null,
        closedAt: null,
        closedBy: null,
        lastMismatchAt: null,
        sampleCount: 0,
        mismatchCount: 0,
      };
      const closed: ShadowProgramState = {
        ...open,
        status: 'closed',
        updatedAt: '2026-08-15T00:00:00.000Z',
        closeReason: 'early_achieved',
        closedAt: '2026-08-15T00:00:00.000Z',
        closedBy: 'test',
      };
      const sample: ShadowReconciliationSample = {
        id: suffix,
        workflowId,
        workspaceId: 'test-workspace',
        snapshotHash: `snapshot-${suffix}`,
        matched: true,
        diffs: [],
        sampledAt: '2026-08-15T00:00:00.000Z',
        newChain: {
          deliverables: [{ kind: 'copy', quantity: 1 }],
          factRefs: [],
          rightsRefs: ['rights-revision:1'],
          quoteRef: { id: 'quote-1', revision: 1 },
          bounds: {
            maxIterations: 1,
            maxCostCents: 1,
            maxWallClockMs: 1,
            maxDelegations: 1,
          },
        },
        oldChain: {
          deliverables: [{ kind: 'copy', quantity: 1 }],
          factRefs: [],
          rightsRefs: ['rights-revision:1'],
          quoteRef: { id: 'quote-1', revision: 1 },
          bounds: {
            maxIterations: 1,
            maxCostCents: 1,
            maxWallClockMs: 1,
            maxDelegations: 1,
          },
        },
      };
      await store.putProgramState(open);

      const [insert, closeWon] = await Promise.all([
        store.putSampleIfOpen(sample),
        store.closeProgramStateCas(open, closed),
      ]);

      assert.notEqual(insert.accepted, closeWon);
      const finalState = await store.getProgramState();
      if (closeWon) {
        assert.equal(finalState?.status, 'closed');
        assert.equal(
          (await store.listSamples(10_000)).some(
            (item) => item.workflowId === workflowId,
          ),
          false,
        );
      } else {
        assert.equal(insert.accepted, true);
        assert.equal(finalState?.status, 'open');
      }
    } finally {
      await pool.query(
        'DELETE FROM p1_shadow_reconciliation_samples WHERE workflow_id = $1',
        [workflowId],
      ).catch(() => undefined);
      if (previousState) {
        await store.putProgramState(previousState).catch(() => undefined);
      } else {
        await pool.query(
          "DELETE FROM p1_shadow_reconciliation_state WHERE id = 'global'",
        ).catch(() => undefined);
      }
      await pool.end();
    }
  },
);
