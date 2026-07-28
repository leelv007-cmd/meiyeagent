import assert from 'node:assert/strict';
import test from 'node:test';

import type { Pool } from 'pg';

import { buildContentPackage } from '../operations/content-package.js';
import { PostgresHarnessStore } from './postgres-store.js';

test('today recommendation reads the fact revision through the ledger API', async () => {
  const sql: string[] = [];
  const pool = {
    async query(statement: string) {
      sql.push(statement);
      return { rows: [] };
    },
  } as unknown as Pool;
  const revisionReads: string[] = [];
  const store = new PostgresHarnessStore(pool, {
    async currentRevision(workspaceId: string) {
      revisionReads.push(workspaceId);
      return 7;
    },
  });

  const recommendation = await store.readTodayRecommendation('workspace-1');

  assert.deepEqual(revisionReads, ['workspace-1']);
  assert.equal(recommendation.currentFactsRevision, 7);
  assert.equal(recommendation.recommendation, null);
  assert.equal(
    sql.some((statement) =>
      statement.includes('p1_store_fact_workspace_heads')
    ),
    false
  );
});

test('today recommendation selects the frozen revision trace when context injection has multiple traces', async () => {
  const timestamp = new Date().toISOString();
  const versionId = 'version-1';
  const contentPackage = {
    ...buildContentPackage({
      id: 'package-1',
      kind: 'image_text',
      source: { assetIds: [], workId: 'work-1' },
      timestamp,
      workspaceId: 'workspace-1',
    }),
    currentVersionId: versionId,
    status: 'review_ready' as const,
    versions: [
      {
        body: '从真实需求出发，介绍本店已确认的服务。',
        conversionHook: '私信预约',
        createdAt: timestamp,
        id: versionId,
        orderedAssetIds: [],
        title: '本周服务推荐',
        topics: [],
      },
    ],
  };
  let queryIndex = 0;
  const pool = {
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return {
          rows: [
            {
              content_package: contentPackage,
              delivered_at: timestamp,
              delivery: { packageId: 'package-1', versionId },
              request: { rawInput: '写一条本周服务文案' },
              task_id: 'task-1',
            },
          ],
        };
      }
      return {
        rows: [
          {
            payload: {
              factSatisfaction: {
                action: 'continue',
                factRefs: ['store_fact:service-1:1'],
                status: 'satisfied',
              },
            },
            stage: 'context_injection',
          },
          {
            payload: { sourceRevisions: { facts: 1 } },
            stage: 'context_injection',
          },
          {
            payload: { factRefs: ['store_fact:service-1:1'] },
            stage: 'brief_compilation',
          },
          {
            payload: {
              candidateScores: [
                { candidateId: 'c01', reason: '适合本周持续介绍服务' },
              ],
              winnerCandidateId: 'c01',
            },
            stage: 'execution_selection',
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool, {
    async currentRevision() {
      return 1;
    },
  });

  const recommendation =
    await store.readTodayRecommendation('workspace-1');

  assert.equal(recommendation.stale, false);
  assert.equal(recommendation.recommendation?.packageId, 'package-1');
  assert.equal(recommendation.recommendation?.factsRevision, 1);
  assert.deepEqual(recommendation.recommendation?.factReferences, [
    'store_fact:service-1:1',
  ]);
});

test('business audit facts are read from PostgreSQL without Langfuse storage', async () => {
  const sql: string[] = [];
  const pool = {
    async query(statement: string) {
      sql.push(statement);
      if (statement.includes('harness_runtime.task_requests')) {
        return { rows: [{ runtime_id: 'workspace-1:task-1' }] };
      }
      return {
        rows: [
          {
            payload: {
              code: 'HARNESS_COPY_ONLY',
              status: 409,
            },
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.deepEqual(await store.readTerminalFailure('workspace-1', 'task-1'), {
    code: 'HARNESS_COPY_ONLY',
    status: 409,
  });
  assert.equal(sql.length, 2);
  assert.ok(sql.every((statement) => statement.includes('harness_runtime.')));
  assert.ok(
    sql.every(
      (statement) =>
        !statement.toLowerCase().includes('clickhouse') &&
        !statement.includes('langfuse_outbox'),
    ),
  );
});

test('Langfuse dead letters use an additive terminal marker', async () => {
  const queries: Array<{ statement: string; values?: unknown[] }> = [];
  const pool = {
    async query(statement: string, values?: unknown[]) {
      queries.push({ statement, values });
      return { rows: [] };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  await store.applySchema();
  await store.markLangfuseDeadLetter('audit-1', 'attempt limit reached');

  assert.ok(
    queries[0]?.statement.includes(
      'add column if not exists dead_lettered_at timestamptz',
    ),
  );
  assert.match(
    queries[0]?.statement ?? '',
    /set status='dead_letter'[\s\S]*where status='failed' and dead_lettered_at is not null/u,
  );
  assert.match(queries[1]!.statement, /dead_lettered_at=now\(\)/u);
  assert.deepEqual(queries[1]!.values, [
    'audit-1',
    'attempt limit reached',
  ]);
});

test('pending decision projection reads its frozen timeout instead of live config', async () => {
  let queryIndex = 0;
  const pool = {
    async query() {
      queryIndex += 1;
      if (queryIndex === 1) {
        return { rows: [{ runtime_id: 'workspace-1:task-1' }] };
      }
      return {
        rows: [
          {
            payload: {
              questionId: 'question-1',
              workflowId: 'task-1',
              workflowRevision: 1,
              question: '当前团购价是多少？',
              options: [],
              freeText: { enabled: true },
              response: {
                field: 'offer_price',
                reason: '补充当前任务所需的权威事实',
              },
              unattended: 'continue',
              scope: 'current_task',
            },
            pending_projection: { timeoutSeconds: 17 },
            request: {},
            resolution_source: null,
            status: 'pending',
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresHarnessStore(pool);

  assert.equal(
    (await store.readDecisionTarget('workspace-1', 'task-1'))
      ?.timeoutSeconds,
    17,
  );
});
