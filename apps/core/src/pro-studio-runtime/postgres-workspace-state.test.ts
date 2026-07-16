import assert from 'node:assert/strict';
import test from 'node:test';

import {
  migrateProStudioWorkspaceState,
  PostgresWorkspaceStateRepository,
  type WorkspaceStateClient,
  type WorkspaceStatePool,
} from './postgres-workspace-state.js';

test('workspace migration removes the retired adoption relation shadow', async () => {
  const queries: string[] = [];

  await migrateProStudioWorkspaceState({
    async query(sql) {
      queries.push(sql);
      return {};
    },
  });

  assert.match(
    queries.join('\n'),
    /UPDATE pro_studio_workspace_state[\s\S]*state = state - 'relations'[\s\S]*namespace = 'adoption_v1'/,
  );
});

interface CounterState {
  count: number;
}

test('persists a workspace transaction behind a row lock', async () => {
  const pool = new FakePool();
  const repository = new PostgresWorkspaceStateRepository<CounterState>(pool, {
    createInitialState: () => ({ count: 0 }),
    namespace: 'generation',
  });

  await repository.transact('workspace-a', (state) => {
    state.count += 1;
  });

  assert.deepEqual(await repository.read('workspace-a'), { count: 1 });
  assert.equal(
    pool.queries.some((query) => /FOR UPDATE/i.test(query)),
    true
  );
});

test('rolls back a failed mutation without publishing the draft', async () => {
  const pool = new FakePool();
  const repository = new PostgresWorkspaceStateRepository<CounterState>(pool, {
    createInitialState: () => ({ count: 0 }),
    namespace: 'generation',
  });

  await assert.rejects(
    repository.transact('workspace-a', (state) => {
      state.count = 99;
      throw new Error('stop');
    }),
    /stop/
  );

  assert.deepEqual(await repository.read('workspace-a'), { count: 0 });
  assert.equal(
    pool.queries.some((query) => /^ROLLBACK$/i.test(query)),
    true
  );
});

test('isolates state by namespace and workspace', async () => {
  const pool = new FakePool();
  const generation = new PostgresWorkspaceStateRepository<CounterState>(pool, {
    createInitialState: () => ({ count: 0 }),
    namespace: 'generation',
  });
  const entitlement = new PostgresWorkspaceStateRepository<CounterState>(pool, {
    createInitialState: () => ({ count: 0 }),
    namespace: 'entitlement',
  });

  await generation.transact('workspace-a', (state) => {
    state.count = 7;
  });

  assert.deepEqual(await generation.read('workspace-b'), { count: 0 });
  assert.deepEqual(await entitlement.read('workspace-a'), { count: 0 });
});

class FakePool implements WorkspaceStatePool {
  readonly queries: string[] = [];
  private readonly committed = new Map<string, unknown>();

  async connect() {
    let transaction = new Map(this.committed);
    const client: WorkspaceStateClient = {
      query: async <T>(sql: string, parameters: unknown[] = []) => {
        const normalized = sql.trim().replace(/\s+/g, ' ');
        this.queries.push(normalized);
        if (/^BEGIN$/i.test(normalized)) {
          transaction = new Map(this.committed);
          return { rows: [] as T[] };
        }
        if (/^COMMIT$/i.test(normalized)) {
          this.committed.clear();
          for (const [key, value] of transaction)
            this.committed.set(key, value);
          return { rows: [] as T[] };
        }
        if (/^ROLLBACK$/i.test(normalized)) {
          transaction = new Map(this.committed);
          return { rows: [] as T[] };
        }
        const key = `${String(parameters[0])}:${String(parameters[1])}`;
        if (/^INSERT/i.test(normalized)) {
          if (!transaction.has(key)) transaction.set(key, parameters[2]);
          return { rows: [] as T[] };
        }
        if (/^SELECT/i.test(normalized)) {
          const state = transaction.get(key);
          return { rows: state === undefined ? [] : ([{ state }] as T[]) };
        }
        if (/^UPDATE/i.test(normalized)) {
          transaction.set(key, parameters[2]);
          return { rows: [] as T[] };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
      },
      release() {},
    };
    return client;
  }
}
