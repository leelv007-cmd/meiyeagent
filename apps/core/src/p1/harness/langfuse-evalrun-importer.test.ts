import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  LANGFUSE_EVAL_RUN_DATASET_ITEM_FIELDS,
  LangfuseEvalRunImporter,
} from './langfuse-evalrun-importer.js';

const REDLINES_BASELINE = fileURLToPath(
  new URL(
    '../../evals/redlines/redlines.baseline.eval-run.json',
    import.meta.url,
  ),
);
const PREFERENCE_MEMORY_BASELINE = fileURLToPath(
  new URL(
    '../../evals/preference-memory/preference-memory.baseline.eval-run.json',
    import.meta.url,
  ),
);
const CLI_ENTRY = fileURLToPath(
  new URL('./langfuse-evalrun-importer-cli.ts', import.meta.url),
);
const CORE_DIRECTORY = fileURLToPath(new URL('../../../', import.meta.url));
const WORKSPACE_DIRECTORY = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);

test('imports both versioned EvalRun baselines through the dataset-item whitelist', async (t) => {
  const requests: Array<{
    authorization?: string;
    url?: string;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    requests.push({
      authorization: request.headers.authorization,
      url: request.url,
      body: await readJson(request),
    });
    sendJson(response, 200, { id: requests.at(-1)?.body.id });
  });
  const importer = new LangfuseEvalRunImporter({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  const redlines = await importer.importArtifact(REDLINES_BASELINE);
  const preferenceMemory = await importer.importArtifact(
    PREFERENCE_MEMORY_BASELINE,
  );

  assert.deepEqual(redlines, {
    datasetName: 'harness-evalrun:harness-seven-redlines',
    importedItems: 21,
    runId: 'harness-seven-redlines-recorded-v2',
  });
  assert.deepEqual(preferenceMemory, {
    datasetName: 'harness-evalrun:beauty-preference-memory',
    importedItems: 4,
    runId: 'beauty-preference-memory-canonical-v1',
  });
  assert.equal(requests.length, 25);
  assert.equal(
    requests[0]?.authorization,
    `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
  );
  assert.ok(
    requests.every(({ url }) => url === '/api/public/dataset-items'),
  );
  for (const { body } of requests) {
    assert.deepEqual(Object.keys(body).sort(), [
      ...LANGFUSE_EVAL_RUN_DATASET_ITEM_FIELDS,
    ].sort());
  }

  assert.deepEqual(requests[0]?.body, {
    id: 'eb262db6-4f61-5daa-ac71-2491e7ca672d',
    datasetName: 'harness-evalrun:harness-seven-redlines',
    input: {
      caseId: 'cross-workspace-source-injection',
      gateId: 'cross_workspace_lineage',
      promptRevision: 'redline-prompts-v2',
      scorerRevision: 'visible-copy-redlines-v2',
    },
    expectedOutput: { passed: true },
    metadata: {
      schemaVersion: 'eval-run/v1',
      runId: 'harness-seven-redlines-recorded-v2',
      suiteId: 'harness-seven-redlines',
      suiteRevision: 'redlines-fixtures-v2',
      mode: 'recorded_fixture',
      createdAt: '2026-07-18T08:00:00.000Z',
      runPassed: true,
    },
  });

  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes('reason'), false);
  assert.equal(serialized.includes('memoryDiff'), false);
  assert.equal(serialized.includes('signal-temporary'), false);
});

test('reimporting the same EvalRun leaves zero duplicate dataset items', async (t) => {
  let requests = 0;
  const items = new Map<string, Record<string, unknown>>();
  const server = createServer(async (request, response) => {
    requests += 1;
    const body = await readJson(request);
    items.set(String(body.id), body);
    sendJson(response, 200, { id: body.id });
  });
  const importer = new LangfuseEvalRunImporter({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await importer.importArtifact(REDLINES_BASELINE);
  const firstImport = structuredClone([...items]);
  await importer.importArtifact(REDLINES_BASELINE);

  assert.equal(requests, 42);
  assert.equal(items.size, 21);
  assert.deepEqual([...items], firstImport);
});

test('rejects an artifact that fails the EvalRun schema before HTTP import', async (t) => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    await readJson(request);
    sendJson(response, 200, {});
  });
  const importer = new LangfuseEvalRunImporter({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const directory = await mkdtemp(join(tmpdir(), 'evalrun-importer-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const invalidArtifactPath = join(directory, 'invalid.eval-run.json');
  const artifact = JSON.parse(
    await readFile(PREFERENCE_MEMORY_BASELINE, 'utf8'),
  ) as Record<string, unknown>;
  artifact.schemaVersion = 'eval-run/v0';
  await writeFile(invalidArtifactPath, JSON.stringify(artifact), 'utf8');

  await assert.rejects(
    importer.importArtifact(invalidArtifactPath),
    /EvalRun artifact validation failed/u,
  );
  assert.equal(requests, 0);
});

test('CLI exits nonzero when Langfuse environment is not configured', () => {
  const env = { ...process.env };
  delete env.LANGFUSE_BASE_URL;
  delete env.LANGFUSE_PUBLIC_KEY;
  delete env.LANGFUSE_SECRET_KEY;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', CLI_ENTRY, REDLINES_BASELINE],
    {
      cwd: CORE_DIRECTORY,
      encoding: 'utf8',
      env,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /EvalRun importer is not configured: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY/u,
  );
});

test('CLI imports a workspace-relative EvalRun artifact', async (t) => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    const body = await readJson(request);
    sendJson(response, 200, { id: body.id });
  });
  const baseUrl = await listen(t, server);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      CLI_ENTRY,
      'apps/core/src/evals/redlines/redlines.baseline.eval-run.json',
    ],
    {
      cwd: CORE_DIRECTORY,
      env: {
        ...process.env,
        INIT_CWD: WORKSPACE_DIRECTORY,
        LANGFUSE_BASE_URL: baseUrl,
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
      },
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

  const [exitCode] = (await once(child, 'close')) as [number];

  assert.equal(exitCode, 0, stderr);
  assert.equal(requests, 21);
  assert.match(
    stdout,
    /Imported 21 EvalRun items from harness-seven-redlines-recorded-v2/u,
  );
});

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listen(
  t: test.TestContext,
  server: ReturnType<typeof createServer>,
) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
