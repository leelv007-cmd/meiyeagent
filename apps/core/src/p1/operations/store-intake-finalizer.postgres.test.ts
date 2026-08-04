import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import type { P1Context } from '../foundation/domain.js';
import type { IntentDeclaration } from '../harness/structured-nodes.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import { LedgerBackedHarnessContextPort } from '../harness/production-context-port.js';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { ProductService } from '../../product/product-service.js';
import { AssetIntakeService } from './asset-intake-service.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import { MemoryContextSourceRevisionRepository } from './context-source-revisions.js';
import { PostgresAssetIntakeRepository } from './postgres-asset-intake-repository.js';
import { PostgresContextBundleRepository } from './postgres-context-bundle-repository.js';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';
import {
  PostgresStoreIntakeFinalizationRepository,
  StoreIntakeFinalizer,
} from './store-intake-finalizer.js';

const connectionString = process.env.TEST_DATABASE_URL;
const now = '2026-07-27T10:00:00.000Z';

test(
  'finalize_store_intake exposes one confirmed store fact to a customized ContextBundle',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const workspaceId = `w01-${randomUUID()}`;
    const userId = `w01-user-${randomUUID()}`;
    const context: P1Context = {
      actor: 'owner',
      correlationId: 'w01-finalize-store-intake',
      userId,
      workspaceId,
    };
    const productRepository = new PostgresProductRepository(pool);
    const product = new ProductService({ repository: productRepository });
    const facts = new PostgresStoreFactLedger(pool);
    const bundles = new PostgresContextBundleRepository(pool);
    const intakeRepository = new PostgresAssetIntakeRepository(pool);
    const finalizations = new PostgresStoreIntakeFinalizationRepository(pool);
    const intake = new AssetIntakeService(intakeRepository, facts, () => now);
    const finalizer = new StoreIntakeFinalizer(
      intake,
      finalizations,
      {
        completedRevision: (projectionContext, patch, idempotencyKey) =>
          product.completedStoreProfileMergeRevision(
            { ...projectionContext, actor: 'user' },
            patch,
            idempotencyKey,
          ),
        currentRevision: async (projectionContext) =>
          (
            await product.bootstrap({
              ...projectionContext,
              actor: 'user',
            })
          ).store?.revision ?? 0,
        merge: (projectionContext, patch, idempotencyKey) =>
          product.mergeStoreProfile(
            { ...projectionContext, actor: 'user' },
            patch,
            idempotencyKey,
          ),
      },
    );
    const module = new AssetMemoryFoundationModule(
      intake,
      undefined,
      finalizer,
    );

    try {
      await createWorkspace(pool, workspaceId, userId);
      await productRepository.migrate();
      await facts.migrate();
      await bundles.migrate();
      await intakeRepository.migrate();
      await finalizations.migrate();

      await product.execute(
        { ...context, actor: 'user' },
        {
          type: 'confirm_store',
          store: {
            accounts: [
              { nickname: '青禾美甲', platform: 'xiaohongshu' },
            ],
            address: '湖墅南路 88 号',
            booking: '提前一天预约',
            brandVoice: '真实、克制',
            city: '杭州',
            district: '拱墅区',
            name: '青禾美甲',
            prohibitions: ['不虚构价格'],
            projects: [
              {
                confirmed: true,
                durationMinutes: 90,
                id: 'project-cat-eye',
                name: '透亮猫眼',
                price: 299,
              },
            ],
            regulated: true,
          },
        },
        'w01-existing-profile',
      );

      await module.execute({
        context,
        idempotencyKey: 'w01-finalize',
        input: {
          action: 'finalize_store_intake',
          payload: {
            batch: {
              batchId: 'w01-progressive-batch',
              taskId: 'w01-progressive-task',
              source: {
                sourceId: 'w01-progressive-card',
                kind: 'manual',
                referenceId: 'w01-progressive-card',
                capabilityStatus: 'verified',
                sourceWorkspaceId: workspaceId,
                capturedAt: now,
                example: false,
              },
              summary: '商家确认了门店项目。',
              candidates: [
                {
                  candidateId: 'w01-project-name',
                  status: 'pending',
                  objectKind: 'store_fact',
                  fact: {
                    kind: 'service',
                    key: 'service.project-cat-eye.name',
                    value: { name: '透亮猫眼' },
                    scope: { storeId: workspaceId },
                    source: {
                      kind: 'user_confirmation',
                      referenceId: 'w01-progressive-card',
                      capturedAt: now,
                    },
                    effectiveFrom: now,
                    expiresAt: null,
                  },
                },
                {
                  candidateId: 'w01-project-price',
                  status: 'pending',
                  objectKind: 'store_fact',
                  fact: {
                    kind: 'price',
                    key: 'service.project-cat-eye.price',
                    value: { amount: 299, currency: 'CNY' },
                    scope: { storeId: workspaceId },
                    source: {
                      kind: 'user_confirmation',
                      referenceId: 'w01-progressive-card',
                      capturedAt: now,
                    },
                    effectiveFrom: now,
                    expiresAt: null,
                  },
                },
              ],
            },
            confirmations: [
              {
                candidateId: 'w01-project-name',
                factId: 'store-project:project-cat-eye:service',
                expectedFactRevision: 0,
              },
              {
                candidateId: 'w01-project-price',
                factId: 'store-project:project-cat-eye:price',
                expectedFactRevision: 0,
              },
            ],
            profilePatch: {
              expectedRevision: 1,
              projects: {
                upsert: [
                  {
                    confirmed: true,
                    durationMinutes: 90,
                    id: 'project-cat-eye',
                    name: '透亮猫眼',
                    price: 299,
                    priceValidUntil: null,
                  },
                ],
              },
            },
          },
        },
      });

      const contextPort = new LedgerBackedHarnessContextPort(
        facts,
        bundles,
        () => now,
        new MemoryContextSourceRevisionRepository(),
      );
      const snapshot = await contextPort.compileAndFreeze({
        workflowId: 'w01-customized-creation',
        request: workflowRequest(workspaceId, userId),
        declaration: declaration(),
      });
      const contribution =
        snapshot.bundle.dimensions.store_facts_assets[
          'service.project-cat-eye.name'
        ];
      assert.deepEqual(contribution?.value, { name: '透亮猫眼' });
      assert.equal(contribution?.layer, 'current_fact');
      assert.equal(contribution?.pool, 'store_personal');
      assert.equal(
        contribution?.factSnapshot?.source.kind,
        'user_confirmation',
      );
      assert.equal(contribution?.factSnapshot?.expiresAt, null);
    } finally {
      await bundles.deleteWorkspaceForTest(workspaceId);
      await finalizations.deleteWorkspaceForTest(workspaceId);
      await intakeRepository.deleteWorkspaceForTest(workspaceId);
      await facts.deleteWorkspaceForTest(workspaceId);
      await pool.query(
        'DELETE FROM product_command_results WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    }
  },
);

async function createWorkspace(
  pool: Pool,
  workspaceId: string,
  userId: string,
) {
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
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  await pool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES ($1, 'W01 test user', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, 'W01 workspace')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id)
     VALUES ($1, $2)`,
    [workspaceId, userId],
  );
}

function workflowRequest(
  workspaceId: string,
  userId: string,
): HarnessWorkflowInput {
  return {
    actorId: userId,
    workspaceId,
    packageId: 'w01-package',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '写一条猫眼美甲种草文案',
    factScope: { storeId: workspaceId, serviceId: 'project-cat-eye' },
    intent: {
      context: {
        workId: 'w01-work',
        intent: '写一条猫眼美甲种草文案',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function declaration(): IntentDeclaration {
  return {
    normalizedIntent: '写一条猫眼美甲种草文案',
    taskType: 'promotion_groupbuy_conversion',
    deliveryLayer: 'copy',
    relevantAssetCategories: [],
    usedAssetCategories: [],
    route: 'customized',
    routingSource: 'model',
    implicitConstraints: ['只使用已确认事实'],
  };
}
