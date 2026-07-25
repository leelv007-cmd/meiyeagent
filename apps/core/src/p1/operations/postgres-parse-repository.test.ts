import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  FixtureAssetDraftCompiler,
  FixtureDocumentParseProvider,
  FixtureVisualAssetClassifier,
  ParseBatchJobEffect,
  ParseService,
} from './parse-service.js';
import { PostgresParseRepository } from './postgres-parse-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;
const now = '2026-07-26T01:00:00.000Z';

test(
  'Postgres persists immutable source, document and draft layers plus a recoverable task projection',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresParseRepository(pool);
    const workspaceId = `t24-parse-${randomUUID()}`;
    await repository.migrate();
    const service = new ParseService(
      repository,
      new FixtureDocumentParseProvider(),
      new FixtureAssetDraftCompiler(),
      new FixtureVisualAssetClassifier(),
      { isAuthorized: async () => true },
      undefined,
      undefined,
      () => now,
    );
    try {
      const result = await service.parseSingle(
        { workspaceId },
        {
          taskId: 'parse-single-pg',
          source: {
            assetId: 'price-sheet-pg',
            objectKey: `${workspaceId}/price-sheet.png`,
            sha256: 'b'.repeat(64),
            sizeBytes: 512,
            contentType: 'image/png',
            sourceUrl: 'https://assets.example.test/price-sheet.png',
            inputKind: 'document_image',
            target: 'price_list',
            rightsStatus: 'confirmed',
          },
        },
      );
      assert.equal(result.task.status, 'completed');
      assert.equal(result.draft.origin, 'parsed');
      assert.equal(result.draft.fields[0]?.status, 'unconfirmed');
      const counts = await pool.query<{
        sources: string;
        documents: string;
        drafts: string;
        tasks: string;
      }>(
        `SELECT
           (SELECT count(*) FROM p1_parse_owned_assets
             WHERE workspace_id = $1)::text AS sources,
           (SELECT count(*) FROM p1_parsed_documents
             WHERE workspace_id = $1)::text AS documents,
           (SELECT count(*) FROM p1_asset_draft_revisions
             WHERE workspace_id = $1)::text AS drafts,
           (SELECT count(*) FROM p1_parse_tasks
             WHERE workspace_id = $1)::text AS tasks`,
        [workspaceId],
      );
      assert.deepEqual(counts.rows[0], {
        sources: '1',
        documents: '1',
        drafts: '1',
        tasks: '1',
      });
      t.diagnostic(`parse_layers=${JSON.stringify(counts.rows[0])}`);

      const reopened = new PostgresParseRepository(pool);
      assert.deepEqual(
        await reopened.getTask(workspaceId, 'parse-single-pg'),
        result.task,
      );
      await assert.rejects(
        () =>
          pool.query(
            `UPDATE p1_asset_draft_revisions
                SET payload = payload || '{"origin":"manual"}'::jsonb
              WHERE workspace_id = $1`,
            [workspaceId],
          ),
        /immutable/u,
      );
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO p1_asset_draft_revisions (
               workspace_id, draft_id, revision, source_asset_id,
               parsed_document_id, payload, created_at
             ) VALUES (
               $1, $2, 2, $3, 'missing-document', '{}'::jsonb, $4
             )`,
            [
              workspaceId,
              result.draft.draftId,
              result.draft.sourceAssetId,
              now,
            ],
          ),
        /foreign key/u,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'Postgres marks the parse projection failed when its durable carrier dies',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresParseRepository(pool);
    const workspaceId = `t24-parse-failed-${randomUUID()}`;
    await repository.migrate();
    const service = new ParseService(
      repository,
      new FixtureDocumentParseProvider(),
      new FixtureAssetDraftCompiler(),
      new FixtureVisualAssetClassifier(),
      { isAuthorized: async () => true },
      undefined,
      undefined,
      () => now,
    );
    try {
      await repository.recordTask({
        taskId: 'dead-carrier-pg',
        workspaceId,
        mode: 'batch_async',
        status: 'queued',
        sourceAssetIds: ['missing-a', 'missing-b'],
        progress: {
          completed: 0,
          total: 2,
          message: '正在整理你上传的资料，已完成 0/2 份；离开后也会继续处理。',
        },
        disclosure:
          '为了帮你少打字，上传的内容会交给第三方解析服务处理；也可以随时跳过，直接手动填写。',
        createdAt: now,
        updatedAt: now,
      });
      const effect = new ParseBatchJobEffect(service);

      await assert.rejects(
        effect.execute({
          workspaceId,
          jobId: 'dead-carrier-pg',
          kind: 'asset.parse-batch',
          payload: { taskId: 'dead-carrier-pg' },
          idempotencyKey: 'dead-carrier-pg',
          effectIdempotencyKey: 'dead-carrier-pg:effect',
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'SOURCE_NOT_FOUND',
      );
      const failed = await repository.getTask(workspaceId, 'dead-carrier-pg');
      assert.equal(failed?.status, 'failed');
      assert.match(failed?.progress.message ?? '', /已经停止/u);
      assert.match(failed?.progress.message ?? '', /手动填写/u);
      t.diagnostic(
        `dead_carrier_projection=${JSON.stringify({
          status: failed?.status,
          completed: failed?.progress.completed,
        })}`,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
