import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_SOURCE_REVISION_KEYS,
  type ContextContribution,
} from '@meiye/contracts';
import { Pool } from 'pg';
import { compileContextBundle } from './context-compiler.js';
import { PostgresContextBundleRepository } from './postgres-context-bundle-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres freezes immutable ContextBundle revisions and retains recompile history',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresContextBundleRepository(pool);
    const workspaceId = `context-bundle-${Date.now()}`;
    const revisions = Object.fromEntries(
      CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 1]),
    );
    const compile = (facts: number) =>
      compileContextBundle({
        workspaceId,
        taskId: 'task-a',
        sourceRevisions: { ...revisions, facts } as never,
        contributions: [],
      });
    await repository.migrate();
    try {
      const firstCommand = {
        workspaceId,
        bundleId: 'bundle-a',
        compiled: compile(1),
        expectedRevision: 0,
        frozenAt: '2026-07-18T01:00:00.000Z',
        frozenBy: 'owner-a',
        idempotencyKey: 'freeze-1',
        reason: 'initial compile',
      };
      const first = await repository.freeze(firstCommand);
      assert.deepEqual(await repository.freeze(firstCommand), first);
      const second = await repository.freeze({
        ...firstCommand,
        compiled: compile(2),
        expectedRevision: 1,
        frozenAt: '2026-07-18T02:00:00.000Z',
        idempotencyKey: 'freeze-2',
        reason: 'facts changed',
      });

      assert.equal(second.revision, 2);
      assert.deepEqual(
        (await repository.history(workspaceId, 'bundle-a')).map(
          (bundle) => [bundle.revision, bundle.sourceRevisions.facts],
        ),
        [
          [1, 1],
          [2, 2],
        ],
      );
      const events = await repository.listRecompileEvents(
        workspaceId,
        'bundle-a',
      );
      assert.equal(events.length, 1);
      assert.deepEqual(events[0]?.changedSources, ['facts']);
      await assert.rejects(
        pool.query(
          `UPDATE p1_context_bundle_revisions
              SET payload = '{}'::jsonb
            WHERE workspace_id = $1 AND bundle_id = $2 AND revision = 1`,
          [workspaceId, 'bundle-a'],
        ),
        /immutable/,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'Postgres resolves invalidation targets by exact fact revision',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresContextBundleRepository(pool);
    const workspaceId = `context-bundle-reference-${Date.now()}`;
    const sourceRevisions = Object.fromEntries(
      CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 1]),
    ) as never;
    const contribution = (revision: number): ContextContribution => ({
      dimension: 'store_facts_assets',
      factRevision: { factId: 'price-a', revision },
      key: 'offer.price',
      layer: 'current_fact',
      pool: 'store_personal',
      sourceRef: `store_fact:price-a:${revision}`,
      value: 199,
    });
    await repository.migrate();
    try {
      for (const revision of [1, 2]) {
        await repository.freeze({
          bundleId: `bundle-price-${revision}`,
          compiled: compileContextBundle({
            contributions: [contribution(revision)],
            sourceRevisions,
            taskId: `task-price-${revision}`,
            workspaceId,
          }),
          expectedRevision: 0,
          frozenAt: '2026-07-19T07:00:00.000Z',
          frozenBy: 'owner-a',
          idempotencyKey: `freeze-price-${revision}`,
          reason: 'exact revision invalidation target',
          workspaceId,
        });
      }

      assert.deepEqual(
        (
          await repository.listReferencingBundles(workspaceId, 'price-a', 1)
        ).map((bundle) => bundle.bundleId),
        ['bundle-price-1'],
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
