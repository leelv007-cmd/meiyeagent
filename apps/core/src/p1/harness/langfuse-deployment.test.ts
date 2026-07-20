import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const deploymentDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../ops/langfuse',
);

test('self-hosted Langfuse deployment pins every stateful component', async () => {
  const compose = await readFile(
    resolve(deploymentDirectory, 'compose.yaml'),
    'utf8',
  );

  for (const image of [
    'langfuse/langfuse:3.217.0',
    'langfuse/langfuse-worker:3.217.0',
    'postgres:17.10-alpine3.24',
    'clickhouse/clickhouse-server:25.8.27.1-alpine',
    'redis:7.4.9-alpine',
    'minio/minio:RELEASE.2025-05-24T17-08-30Z',
  ]) {
    assert.match(compose, new RegExp(`image: ${escapeRegExp(image)}`));
  }
  assert.doesNotMatch(compose, /image:\s*\S+:latest(?:\s|$)/u);
});

test('deployment assets require secrets and document readiness plus PG authority', async () => {
  const [compose, example, readme] = await Promise.all([
    readFile(resolve(deploymentDirectory, 'compose.yaml'), 'utf8'),
    readFile(resolve(deploymentDirectory, '.env.example'), 'utf8'),
    readFile(resolve(deploymentDirectory, 'README.md'), 'utf8'),
  ]);

  for (const secret of [
    'POSTGRES_PASSWORD',
    'CLICKHOUSE_PASSWORD',
    'REDIS_AUTH',
    'MINIO_ROOT_PASSWORD',
    'SALT',
    'ENCRYPTION_KEY',
    'NEXTAUTH_SECRET',
  ]) {
    assert.match(compose, new RegExp(`\\$\\{${secret}:\\?`));
    assert.match(example, new RegExp(`^${secret}=$`, 'mu'));
  }
  assert.match(readme, /\/api\/public\/health/u);
  assert.match(readme, /\/api\/public\/ready/u);
  assert.match(readme, /harness_runtime\.audit_events/u);
  assert.match(readme, /ClickHouse TTL/u);
  assert.match(readme, /harness-structured-node-metrics/u);
});

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
