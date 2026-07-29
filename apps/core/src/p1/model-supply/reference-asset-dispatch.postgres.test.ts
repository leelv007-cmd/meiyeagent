import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { Pool } from 'pg';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { createCanvasOwnedAssetExportPolicy } from '../../pro-studio/canvas-asset-facade.js';
import { PostgresCanvasAssetRepository } from '../../pro-studio/postgres-canvas-asset-repository.js';
import { PostgresProStudioMigration } from '../../pro-studio/postgres-pro-studio-migration.js';
import { ModelSupplyComposerRouteResolver } from '../execution-spine/composer-route-resolver.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { OperationsCanvasExportAssetAccessService } from '../operations/canvas-export-asset-access.js';
import { withServerDerivedReferenceDataClass } from './reference-asset-dispatch-guard.js';
import {
  CompositeReferenceAssetResolver,
  OwnedAssetReferenceResolver,
  ProductReferenceAssetResolver,
  ProductReferenceAssetPolicyResolver,
} from './reference-asset-resolver.js';
import type { ModelSupplySubmission } from './route-contracts.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
} from './index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'Postgres dispatch rechecks revocation and rejects expired, cross-workspace, and sensitive routes',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `t15-${randomUUID()}`;
    const otherWorkspaceId = `t15-other-${randomUUID()}`;
    const assets = new PostgresCanvasAssetRepository(pool);
    const products = new PostgresProductRepository(pool);
    const bytes = Uint8Array.from(Buffer.from('t15-owned-reference'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const basePolicy = createCanvasOwnedAssetExportPolicy({
      ownerId: 'user-t15',
      updatedAt: '2026-07-26T00:00:00.000Z',
      workspaceId,
    });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'T15'), ($2, 'T15 other')`,
        [workspaceId, otherWorkspaceId],
      );
      await new PostgresFoundationRepository(pool).migrate();
      const client = await pool.connect();
      try {
        await new PostgresProStudioMigration().migrate(client);
      } finally {
        client.release();
      }
      await products.migrate();
      await products.save({
        workspaceId,
        assets: [
          {
            aigcStatus: 'not_ai',
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            containsPerson: true,
            containsSensitiveData: true,
            createdAt: '2026-07-26T00:00:00.000Z',
            id: 'product-sensitive',
            mediaType: 'image',
            minorStatus: 'none',
            objectKey: `${workspaceId}/assets/${sha256}.png`,
            replacementRequired: false,
            rightsEvidence: 'owner-consent',
            rightsNoFixedExpiry: true,
            rightsOwner: 'merchant',
            rightsPlatforms: ['xiaohongshu'],
            sourceType: 'real',
            tags: [],
          },
        ],
        store: { regulated: true },
      } as unknown as ProductState);
      await assets.insert({
        contentType: 'image/png',
        createdAt: '2026-07-26T00:00:00.000Z',
        exportPolicy: basePolicy,
        fileName: 'sensitive.png',
        id: 'owned-sensitive',
        objectKey: `${workspaceId}/canvas/assets/sensitive.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: {
          kind: 'product_asset',
          sourceAssetId: 'product-sensitive',
        },
        workspaceId,
      });
      await assets.insert({
        contentType: 'image/png',
        createdAt: '2026-07-26T00:00:00.000Z',
        exportPolicy: {
          ...basePolicy,
          expiresAt: '2026-07-25T23:59:59.000Z',
        },
        fileName: 'expired.png',
        id: 'owned-expired',
        objectKey: `${workspaceId}/canvas/assets/expired.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: { kind: 'local_import' },
        workspaceId,
      });

      let revokeDuringRead = false;
      const resolver = new OwnedAssetReferenceResolver(
        assets,
        {
          async read() {
            if (revokeDuringRead) {
              await assets.updateExportPolicy({
                assetId: 'owned-sensitive',
                expectedVersion: 1,
                exportPolicy: {
                  ...basePolicy,
                  revokedAt: '2026-07-26T01:00:00.000Z',
                  updatedAt: '2026-07-26T01:00:00.000Z',
                  version: 2,
                },
                workspaceId,
              });
            }
            return bytes;
          },
        },
        {
          clock: () => new Date('2026-07-26T02:00:00.000Z'),
          productPolicyResolver: new ProductReferenceAssetPolicyResolver(
            products,
            () => new Date('2026-07-26T02:00:00.000Z'),
          ),
        },
      );

      assert.deepEqual(await resolver.inspect(workspaceId, ['owned-expired']), [
        {
          assetId: 'owned-expired',
          kind: 'failure',
          reason: 'rights_incomplete',
        },
      ]);
      assert.deepEqual(
        await resolver.inspect(otherWorkspaceId, ['owned-sensitive']),
        [
          {
            assetId: 'owned-sensitive',
            kind: 'failure',
            reason: 'not_found',
          },
        ],
      );

      const guarded = await withServerDerivedReferenceDataClass(
        submission(workspaceId),
        resolver,
      );
      assert.deepEqual(guarded.dataClass, [
        'contains_face',
        'medical',
        'pii',
      ]);
      const routeResolver = new ModelSupplyComposerRouteResolver(
        {
          async freezeFixedRouteForExecution(input) {
            assert.deepEqual(input.dataClass, [
              'contains_face',
              'medical',
              'pii',
            ]);
            throw new Error('No compliant sensitive route.');
          },
        },
        {
          async getRouteSnapshot() {
            return null;
          },
          async insertRouteSnapshot() {
            assert.fail('an invalid sensitive route must not be stored');
          },
        },
      );
      await assert.rejects(
        routeResolver.resolve({
          catalogModel: { id: 'model-image', revision: 'catalog-r1' },
          dataClass: guarded.dataClass,
          operation: 'image.generate',
          workspaceId,
        }),
        /No compliant sensitive route/u,
      );

      revokeDuringRead = true;
      let externalSends = 0;
      const [resolution] = await resolver.resolve(workspaceId, [
        'owned-sensitive',
      ]);
      if (resolution?.kind === 'resolved') externalSends += 1;
      assert.deepEqual(resolution, {
        assetId: 'owned-sensitive',
        kind: 'failure',
        reason: 'authorization_withdrawn',
      });
      assert.equal(externalSends, 0);
    } finally {
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query('DELETE FROM workspaces WHERE id = ANY($1::text[])', [
        [workspaceId, otherWorkspaceId],
      ]);
      await pool.end();
    }
  },
);

test(
  'Postgres union rechecks generation input lineage before exporting a real p1_owned_assets row',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `t15-p1-${randomUUID()}`;
    const routeSnapshotId = `route-${randomUUID()}`;
    const jobId = `job-${randomUUID()}`;
    const attemptId = `attempt-${randomUUID()}`;
    const assetId = `asset-${randomUUID()}`;
    const parentAssetId = `parent-${randomUUID()}`;
    const bytes = Uint8Array.from(Buffer.from('p1-owned-reference'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'T15 p1 owned')`,
        [workspaceId],
      );
      const foundation = new PostgresFoundationRepository(pool);
      await foundation.migrate();
      const client = await pool.connect();
      try {
        await new PostgresProStudioMigration().migrate(client);
      } finally {
        client.release();
      }
      const createdAt = '2026-07-26T00:00:00.000Z';
      const canvasAssets = new PostgresCanvasAssetRepository(pool);
      await canvasAssets.insert({
        contentType: 'image/png',
        createdAt,
        exportPolicy: createCanvasOwnedAssetExportPolicy({
          ownerId: 'user-t15',
          updatedAt: createdAt,
          workspaceId,
        }),
        fileName: 'parent.png',
        id: parentAssetId,
        objectKey: `${workspaceId}/canvas/assets/${parentAssetId}.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: { kind: 'local_import' },
        workspaceId,
      });
      await foundation.insertRouteSnapshot({
        allowedCandidates: [
          {
            catalogModelId: 'image-model',
            credentialMode: 'platform',
            credentialVersion: 'credential-r1',
            deploymentId: 'deployment-domestic',
            region: 'cn',
          },
        ],
        catalogRevision: 'catalog-r1',
        createdAt,
        dataClass: 'public',
        fallbackConsent: false,
        id: routeSnapshotId,
        policyRevision: 'policy-r1',
        priceRevision: 'price-r1',
        requestedCatalogModelId: 'image-model',
        selectionMode: 'fixed',
        workspaceId,
      });
      await foundation.insertGenerationJob({
        correlationId: `correlation-${jobId}`,
        createdAt,
        createdBy: 'user-t15',
        id: jobId,
        operation: 'image',
        result: {
          inputAssets: [
            { assetId: parentAssetId, role: 'reference_image' },
          ],
        },
        routeSnapshotId,
        status: 'completed',
        updatedAt: createdAt,
        usageReservationId: `usage-${jobId}`,
        workspaceId,
      });
      await foundation.insertProviderAttempt({
        acceptance: 'accepted',
        createdAt,
        deploymentId: 'deployment-domestic',
        id: attemptId,
        jobId,
        ordinal: 1,
        providerTaskRef: `provider-${attemptId}`,
        status: 'completed',
        updatedAt: createdAt,
        workspaceId,
      });
      await foundation.insertOwnedAsset({
        attemptId,
        createdAt,
        id: assetId,
        jobId,
        mediaType: 'image/png',
        objectKey: `${workspaceId}/owned/${assetId}.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        workspaceId,
      });

      const resolver = new CompositeReferenceAssetResolver([
        new OwnedAssetReferenceResolver(
          canvasAssets,
          { async read() { return bytes; } },
        ),
      ]);
      const [resolved] = await resolver.resolve(workspaceId, [assetId]);

      assert.equal(resolved?.kind, 'resolved');
      if (!resolved || resolved.kind !== 'resolved') return;
      assert.equal(resolved.sha256, sha256);
      assert.equal(resolved.classificationSource, 'unclassified');
      assert.equal(Buffer.from(resolved.bytes).toString(), 'p1-owned-reference');

      const unionAsset = await canvasAssets.get(workspaceId, assetId);
      assert.deepEqual(unionAsset?.source, {
        jobId,
        kind: 'generation_job',
      });
      let storageReads = 0;
      const exportAccess = new OperationsCanvasExportAssetAccessService({
        canvasAssets,
        contentPackageAssets: {
          async readOwnedAsset() {
            throw new Error('No ContentPackage asset is referenced.');
          },
        },
        contentPackageRights: {
          async resolve() {
            return { knownAssetIds: [], unauthorizedAssetIds: [] };
          },
        },
        generationJobs: foundation,
        ownedAssetStorage: {
          async read() {
            storageReads += 1;
            return { bytes, contentType: 'image/png' };
          },
          async verifyCanvasAssetReceipt() {
            return true;
          },
        },
        productAssets: {
          async resolve() {
            return [];
          },
        },
        productPolicy: {
          async resolveExportPolicy() {
            return { kind: 'unknown' as const };
          },
        },
      });
      assert.equal(
        (
          await exportAccess.resolve({
            assetId,
            contentPackages: [],
            workspaceId,
          })
        ).kind,
        'available',
      );
      assert.equal(storageReads, 1);

      await canvasAssets.updateExportPolicy?.({
        assetId: parentAssetId,
        expectedVersion: 1,
        exportPolicy: {
          ...createCanvasOwnedAssetExportPolicy({
            ownerId: 'user-t15',
            updatedAt: createdAt,
            workspaceId,
          }),
          revokedAt: '2026-07-26T01:00:00.000Z',
          version: 2,
        },
        workspaceId,
      });
      assert.deepEqual(
        await exportAccess.resolve({
          assetId,
          contentPackages: [],
          workspaceId,
        }),
        { code: 'ASSET_REVOKED', kind: 'unavailable' },
      );
      assert.equal(storageReads, 1);
    } finally {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    }
  },
);

test(
  'Postgres routing keeps unclassified local imports domestic while a public product asset retains overseas candidates',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `t15-routing-${randomUUID()}`;
    const assets = new PostgresCanvasAssetRepository(pool);
    const products = new PostgresProductRepository(pool);
    const bytes = Uint8Array.from(Buffer.from('routing-reference'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const productAssetId = 'product-public';
    const localAssetId = 'local-unclassified';
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'T15 routing')`,
        [workspaceId],
      );
      await new PostgresFoundationRepository(pool).migrate();
      const client = await pool.connect();
      try {
        await new PostgresProStudioMigration().migrate(client);
      } finally {
        client.release();
      }
      await products.migrate();
      await assets.insert({
        contentType: 'image/png',
        createdAt: '2026-07-26T00:00:00.000Z',
        fileName: 'local.png',
        id: localAssetId,
        objectKey: `${workspaceId}/canvas/assets/local.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: { kind: 'local_import' },
        workspaceId,
      });
      await products.save({
        assets: [
          {
            aigcStatus: 'not_ai',
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            containsPerson: false,
            containsSensitiveData: false,
            createdAt: '2026-07-26T00:00:00.000Z',
            id: productAssetId,
            mediaType: 'image',
            minorStatus: 'none',
            objectKey: `${workspaceId}/assets/asset-golden-journey.png`,
            replacementRequired: false,
            rightsEvidence: 'merchant-owned',
            rightsOwner: 'merchant',
            sourceType: 'real',
            tags: [],
          },
        ],
        workspaceId,
      } as unknown as ProductState);

      const productResolver = new ProductReferenceAssetResolver(products, {
        appBaseUrl: 'http://app.example.test',
        serviceToken: 'service-token-t15',
        fetch: async (_input, init) =>
          init?.method === 'HEAD'
            ? new Response(null, {
                headers: {
                  'content-length': String(bytes.byteLength),
                  'content-type': 'image/png',
                  'x-content-sha256': sha256,
                },
              })
            : new Response(bytes, {
                headers: { 'content-type': 'image/png' },
              }),
      });
      const resolver = new CompositeReferenceAssetResolver([
        new OwnedAssetReferenceResolver(
          assets,
          {
            async head() {
              return {
                contentType: 'image/png',
                sizeBytes: bytes.byteLength,
              };
            },
            async read() {
              return bytes;
            },
          },
          {
            productPolicyResolver: new ProductReferenceAssetPolicyResolver(
              products,
            ),
          },
        ),
        productResolver,
      ]);
      const models: CatalogModel[] = [
        {
          displayName: 'Image model',
          id: 'image-model',
          modality: 'image',
          operations: ['image.edit'],
          qualityRank: 10,
        },
      ];
      const deployments: ModelDeployment[] = [
        {
          apiFamily: 'image',
          catalogModelId: 'image-model',
          channel: 'direct',
          id: 'image-domestic',
          region: 'domestic',
          status: 'active',
        },
        {
          apiFamily: 'image',
          catalogModelId: 'image-model',
          channel: 'managed',
          id: 'image-global',
          region: 'overseas',
          status: 'active',
        },
      ];
      const service = new ModelSupplyApplicationService({
        deployments,
        execution: new RecordedProviderExecutionPort(),
        models,
        referenceAssets: resolver,
      });

      const localResult = await service.submit({
        actorId: 'user-t15',
        dataClass: [],
        idempotencyKey: 'local-domestic-only',
        input: {
          inputAssets: [
            { assetId: localAssetId, role: 'reference_image' },
          ],
        },
        operation: 'image.edit',
        prompt: 'Use the local reference.',
        selection: { catalogModelId: 'image-model', mode: 'fixed' },
        workspaceId,
      });
      assert.equal(localResult.status, 'completed');
      assert.deepEqual(
        localResult.snapshot.allowedCandidates?.map(
          (candidate) => candidate.deploymentId,
        ),
        ['image-domestic'],
      );

      const productResult = await service.submit({
        actorId: 'user-t15',
        dataClass: [],
        idempotencyKey: 'product-global-retained',
        input: {
          inputAssets: [
            { assetId: productAssetId, role: 'reference_image' },
          ],
        },
        operation: 'image.edit',
        prompt: 'Use the product reference.',
        selection: { catalogModelId: 'image-model', mode: 'fixed' },
        workspaceId,
      });
      assert.equal(productResult.status, 'completed');
      assert.deepEqual(
        productResult.snapshot.allowedCandidates?.map(
          (candidate) => candidate.deploymentId,
        ),
        ['image-domestic', 'image-global'],
      );
      const [resolvedProduct] = await resolver.resolve(workspaceId, [
        productAssetId,
      ]);
      assert.equal(resolvedProduct?.kind, 'resolved');
      if (resolvedProduct?.kind === 'resolved') {
        assert.equal(resolvedProduct.sha256, sha256);
      }
    } finally {
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    }
  },
);

function submission(workspaceId: string): ModelSupplySubmission {
  return {
    actorId: 'user-t15',
    dataClass: [],
    idempotencyKey: 't15-sensitive-route',
    input: {
      inputAssets: [
        { assetId: 'owned-sensitive', role: 'reference_image' },
      ],
    },
    operation: 'image.edit',
    prompt: 'Use the selected source.',
    selection: { catalogModelId: 'model-image', mode: 'fixed' },
    workspaceId,
  };
}
