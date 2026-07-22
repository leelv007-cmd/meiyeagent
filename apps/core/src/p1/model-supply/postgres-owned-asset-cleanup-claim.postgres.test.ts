import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  PostgresOwnedAssetCleanupClaimCoordinator,
  assertOwnedAssetRegistrationAllowed,
} from './postgres-owned-asset-cleanup-claim.js';
import {
  S3CompatibleAssetStorage,
  type SharedObjectClient,
} from './s3-asset-storage.js';

const connectionString = process.env.TEST_DATABASE_URL;
const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);

test(
  'PostgreSQL object claims serialize cleanup, fence newer receipts, and replay a sidecar-only delete',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const workspaceId = `asset-claim-${randomUUID()}`;
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-asset-claim-'));
    t.after(async () => {
      await rm(cacheDirectory, { force: true, recursive: true });
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await new PostgresFoundationRepository(pool).migrate();
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'asset cleanup claim test')`,
      [workspaceId],
    );

    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const base = memoryClient(objects);
    let firstDelete = true;
    let markDeleteStarted!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      markDeleteStarted = resolve;
    });
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const storage = new S3CompatibleAssetStorage({
      cacheDirectory,
      client: {
        ...base,
        async delete(key) {
          if (key.startsWith(`${workspaceId}/generated/`) && firstDelete) {
            firstDelete = false;
            markDeleteStarted();
            await deleteGate;
          }
          await base.delete(key);
        },
      },
    });
    const asset = await storage.persistGeneratedAsset({
      bytes: archive,
      contentType: 'application/zip',
      sourceTaskRef: 'claim-concurrency',
      workspaceId,
    });
    await storage.recordOwnedAssetRegistrationFailure({
      asset,
      error: new Error('simulated database failure'),
      failureStage: 'result_persistence',
      workspaceId,
    });
    const [failure] = await storage.listOwnedAssetRegistrationFailures();
    assert.ok(failure);
    const coordinator = new PostgresOwnedAssetCleanupClaimCoordinator(
      pool,
      storage,
      { async isReferenced() { return false; } },
    );

    const cleanup = coordinator.cleanup(failure);
    await deleteStarted;
    const registrationClient = await pool.connect();
    await registrationClient.query('BEGIN');
    const staleRegistration = assertOwnedAssetRegistrationAllowed(registrationClient, {
      objectKey: asset.objectKey,
      storageRevision: asset.storageRevision,
      workspaceId,
    });
    const stillBlocked = await Promise.race([
      staleRegistration.then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 25)),
    ]);
    assert.equal(stillBlocked, true);
    releaseDelete();
    assert.equal(await cleanup, 'deleted');
    await assert.rejects(staleRegistration, /deleted during registration/);
    await registrationClient.query('ROLLBACK');
    registrationClient.release();

    const replacement = await storage.persistGeneratedAsset({
      bytes: archive,
      contentType: 'application/zip',
      sourceTaskRef: 'claim-concurrency',
      workspaceId,
    });
    const recoveryClient = await pool.connect();
    try {
      await recoveryClient.query('BEGIN');
      await assertOwnedAssetRegistrationAllowed(recoveryClient, {
        objectKey: replacement.objectKey,
        storageRevision: replacement.storageRevision,
        workspaceId,
      });
      await recoveryClient.query('COMMIT');
    } finally {
      recoveryClient.release();
    }
    const [recovered] = await pool.query<{
      status: string;
      receipt_storage_revision: string;
    }>(
      `SELECT status, receipt_storage_revision
         FROM p1_owned_asset_cleanup_claims
        WHERE workspace_id = $1 AND object_key = $2`,
      [workspaceId, replacement.objectKey],
    ).then((result) => result.rows);
    assert.equal(recovered?.status, 'registration_recovered');
    assert.equal(recovered?.receipt_storage_revision, replacement.storageRevision);

    const staleAsset = await storage.persistGeneratedAsset({
      bytes: Uint8Array.from([...archive, 8]),
      contentType: 'application/zip',
      sourceTaskRef: 'claim-stale-revision',
      workspaceId,
    });
    await storage.recordOwnedAssetRegistrationFailure({
      asset: staleAsset,
      error: new Error('simulated old registration failure'),
      failureStage: 'result_persistence',
      workspaceId,
    });
    const staleFailure = (await storage.listOwnedAssetRegistrationFailures()).find(
      (item) => item.objectKey === staleAsset.objectKey,
    );
    assert.ok(staleFailure?.storageRevision);
    const staleReceipt = await storage.readStoredReceipt(staleAsset.objectKey);
    const staleSidecar = [...objects.entries()].find(([key, value]) =>
      key.startsWith('_meiye-asset-receipts/') &&
      value.contentType === 'application/json' &&
      JSON.parse(new TextDecoder().decode(value.bytes)).objectKey === staleAsset.objectKey,
    );
    assert.ok(staleSidecar);
    const replacementRevision = `replacement-${randomUUID()}`;
    objects.set(staleSidecar[0], {
      bytes: new TextEncoder().encode(JSON.stringify({
        ...staleReceipt,
        storageRevision: replacementRevision,
      })),
      contentType: 'application/json',
    });
    assert.equal(await coordinator.cleanup(staleFailure), 'referenced');
    assert.equal(await storage.hasSharedObject(staleAsset.objectKey), true);
    const staleClaim = await pool.query<{
      receipt_storage_revision: string;
      status: string;
    }>(
      `SELECT status, receipt_storage_revision
         FROM p1_owned_asset_cleanup_claims
        WHERE workspace_id = $1 AND object_key = $2`,
      [workspaceId, staleAsset.objectKey],
    );
    assert.equal(staleClaim.rows[0]?.status, 'registration_recovered');
    assert.equal(
      staleClaim.rows[0]?.receipt_storage_revision,
      replacementRevision,
    );
    objects.delete(staleAsset.objectKey);
    assert.equal(await coordinator.cleanup(staleFailure), 'failed');
    const danglingRegistrationClient = await pool.connect();
    try {
      await danglingRegistrationClient.query('BEGIN');
      await assert.rejects(
        assertOwnedAssetRegistrationAllowed(danglingRegistrationClient, {
          objectKey: staleAsset.objectKey,
          storageRevision: replacementRevision,
          workspaceId,
        }),
        /cleanup is incomplete/,
      );
      await danglingRegistrationClient.query('ROLLBACK');
    } finally {
      danglingRegistrationClient.release();
    }

    const retryAsset = await storage.persistGeneratedAsset({
      bytes: Uint8Array.from([...archive, 9]),
      contentType: 'application/zip',
      sourceTaskRef: 'claim-retry',
      workspaceId,
    });
    await storage.recordOwnedAssetRegistrationFailure({
      asset: retryAsset,
      error: new Error('simulated database failure'),
      failureStage: 'result_persistence',
      workspaceId,
    });
    const retryFailure = (await storage.listOwnedAssetRegistrationFailures()).find(
      (item) => item.objectKey === retryAsset.objectKey,
    );
    assert.ok(retryFailure);
    let failSidecarDeleteOnce = true;
    const retryCacheDirectory = await mkdtemp(
      join(tmpdir(), 'meiye-asset-claim-retry-'),
    );
    const retryStorage = new S3CompatibleAssetStorage({
      cacheDirectory: retryCacheDirectory,
      client: {
        ...base,
        async delete(key) {
          if (key.startsWith('_meiye-asset-receipts/') && failSidecarDeleteOnce) {
            failSidecarDeleteOnce = false;
            throw new Error('simulated receipt sidecar delete failure');
          }
          await base.delete(key);
        },
      },
    });
    t.after(async () => {
      await rm(retryCacheDirectory, {
        force: true,
        recursive: true,
      });
    });
    const retryCoordinator = new PostgresOwnedAssetCleanupClaimCoordinator(
      pool,
      retryStorage,
      { async isReferenced() { return false; } },
    );
    assert.equal(await retryCoordinator.cleanup(retryFailure), 'failed');
    assert.equal(await retryStorage.hasSharedObject(retryAsset.objectKey), false);
    const partialRegistrationClient = await pool.connect();
    try {
      await partialRegistrationClient.query('BEGIN');
      await assert.rejects(
        assertOwnedAssetRegistrationAllowed(partialRegistrationClient, {
          objectKey: retryAsset.objectKey,
          storageRevision: retryAsset.storageRevision,
          workspaceId,
        }),
        /cleanup is incomplete/,
      );
      await partialRegistrationClient.query('ROLLBACK');
    } finally {
      partialRegistrationClient.release();
    }
    assert.equal(await retryCoordinator.cleanup(retryFailure), 'deleted');
  },
);

function memoryClient(
  objects: Map<string, { bytes: Uint8Array; contentType: string }>,
): SharedObjectClient {
  return {
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? { bytes: Uint8Array.from(object.bytes), contentType: object.contentType }
        : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? { contentType: object.contentType, sizeBytes: object.bytes.byteLength }
        : null;
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
    },
    async putIfAbsent(key, bytes, contentType) {
      if (objects.has(key)) return false;
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
      return true;
    },
  };
}
