import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
  S3AssetRegistrationCleanupRunner,
} from './owned-asset-registration-cleanup.js';
import {
  S3CompatibleAssetStorage,
  S3CompatibleObjectClient,
} from './s3-asset-storage.js';

const endpoint = required('P1_S3_CONTRACT_ENDPOINT');
const bucket = required('P1_S3_CONTRACT_BUCKET');
const accessKeyId = required('P1_S3_CONTRACT_ACCESS_KEY_ID');
const secretAccessKey = required('P1_S3_CONTRACT_SECRET_ACCESS_KEY');
const action = required('P1_S3_CONTRACT_ACTION');
const workspaceId = 'minio-contract-workspace';
const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-minio-contract-'));
try {
  const client = new S3CompatibleObjectClient({
    accessKeyId,
    bucket,
    endpoint,
    region: 'us-east-1',
    secretAccessKey,
  });
  if (action === 'write' || action === 'repeat') {
    const storage = new S3CompatibleAssetStorage({ cacheDirectory, client });
    const receipt = await storage.persistGeneratedAsset({
      bytes: archive,
      contentType: 'application/zip',
      sourceTaskRef: 'minio-contract-export',
      workspaceId,
    });
    emit({ objectKey: receipt.objectKey, storageRevision: receipt.storageRevision });
  } else if (action === 'read') {
    const objectKey = required('P1_S3_CONTRACT_OBJECT_KEY');
    const storage = new S3CompatibleAssetStorage({ cacheDirectory, client });
    const stored = await storage.read(objectKey);
    emit({ contentType: stored.contentType, sizeBytes: stored.bytes.byteLength });
  } else if (action === 'failure') {
    const storage = new S3CompatibleAssetStorage({
      cacheDirectory,
      client,
    });
    const asset = await storage.persistGeneratedAsset({
      bytes: archive,
      contentType: 'application/zip',
      sourceTaskRef: 'minio-contract-failure',
      workspaceId,
    });
    await storage.recordOwnedAssetRegistrationFailure({
      asset,
      error: new Error('simulated database registration failure'),
      failureStage: 'result_persistence',
      workspaceId,
    });
    const [failure] = await storage.listOwnedAssetRegistrationFailures();
    if (!failure) throw new Error('Expected a durable cleanup failure record.');
    emit({ objectKey: failure.objectKey, recordedAt: failure.recordedAt });
  } else if (action === 'cleanup') {
    const storage = new S3CompatibleAssetStorage({ cacheDirectory, client });
    const failures = await storage.listOwnedAssetRegistrationFailures();
    const first = failures[0];
    if (!first) throw new Error('Expected a durable cleanup failure record.');
    const summary = await new S3AssetRegistrationCleanupRunner(storage, {
      async isReferenced() {
        return false;
      },
    }).run(
      new Date(
        Date.parse(first.recordedAt) +
          S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
      ).toISOString(),
    );
    emit({
      deleted: !(await storage.hasSharedObject(first.objectKey)),
      summary,
    });
  } else {
    throw new Error(`Unsupported P1_S3_CONTRACT_ACTION: ${action}`);
  }
} finally {
  await rm(cacheDirectory, { force: true, recursive: true });
}

function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
