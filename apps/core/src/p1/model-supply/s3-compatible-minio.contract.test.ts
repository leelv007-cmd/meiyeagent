import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { S3CompatibleObjectClient } from './s3-asset-storage.js';

const endpoint = process.env.P1_S3_CONTRACT_ENDPOINT;
const bucket = process.env.P1_S3_CONTRACT_BUCKET;
const accessKeyId = process.env.P1_S3_CONTRACT_ACCESS_KEY_ID;
const secretAccessKey = process.env.P1_S3_CONTRACT_SECRET_ACCESS_KEY;
const configured = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
const fixture = fileURLToPath(
  new URL('./s3-compatible-minio-process-fixture.ts', import.meta.url),
);

test(
  'fixed MinIO service contract crosses independent API and Worker processes',
  {
    skip: configured
      ? false
      : 'P1_S3_CONTRACT_* settings are required for the isolated MinIO contract test',
  },
  async () => {
    const client = new S3CompatibleObjectClient({
      accessKeyId: accessKeyId!,
      bucket: bucket!,
      endpoint: endpoint!,
      region: 'us-east-1',
      secretAccessKey: secretAccessKey!,
    });
    await client.createBucket();

    const workerWrite = await runFixture('write');
    const objectKey = requiredString(workerWrite.objectKey, 'worker object key');
    const storageRevision = requiredString(
      workerWrite.storageRevision,
      'worker receipt revision',
    );
    const apiRead = await runFixture('read', {
      P1_S3_CONTRACT_OBJECT_KEY: objectKey,
    });
    const workerReplay = await runFixture('repeat');
    assert.equal(requiredString(apiRead.contentType, 'API content type'), 'application/zip');
    assert.equal(requiredNumber(apiRead.sizeBytes, 'API object size'), 6);
    assert.equal(requiredString(workerReplay.objectKey, 'replayed object key'), objectKey);
    assert.equal(
      requiredString(workerReplay.storageRevision, 'replayed receipt revision'),
      storageRevision,
    );

    const failedWorker = await runFixture('failure');
    assert.match(
      requiredString(failedWorker.objectKey, 'failed object key'),
      /^minio-contract-workspace\/generated\//u,
    );
    const cleanupWorker = await runFixture('cleanup');
    assert.equal(cleanupWorker.deleted, true);
    const summary = requiredRecord(cleanupWorker.summary, 'cleanup summary');
    assert.equal(requiredNumber(summary.deletedCount, 'cleanup deleted count'), 1);
  },
);

async function runFixture(
  action: string,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', fixture],
        {
          cwd: fileURLToPath(new URL('../../../', import.meta.url)),
          env: {
            ...process.env,
            ...extra,
            P1_S3_CONTRACT_ACTION: action,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stderr, stdout }));
    },
  );
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`);
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function requiredRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
