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
import type { EvalRunRegistryPort } from './eval-run-registry.js';

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
const SKILLS_BASELINE = fileURLToPath(
  new URL('../../evals/skills/skills.baseline.eval-run.json', import.meta.url),
);
const CLI_ENTRY = fileURLToPath(
  new URL('./langfuse-evalrun-importer-cli.ts', import.meta.url),
);
const CORE_DIRECTORY = fileURLToPath(new URL('../../../', import.meta.url));
const WORKSPACE_DIRECTORY = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);

function memoryRegistry() {
  const runs = new Map<
    string,
    Parameters<EvalRunRegistryPort['putImmutable']>[1]
  >();
  const port: EvalRunRegistryPort = {
    async putImmutable(runId, fullRun) {
      runs.set(runId, structuredClone(fullRun));
      return structuredClone(fullRun);
    },
    async get(runId) {
      const run = runs.get(runId);
      return run ? structuredClone(run) : null;
    },
  };
  return { port, runs };
}

test('imports versioned redline, memory and Skill EvalRuns through the dataset-item whitelist', async (t) => {
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
  const registry = memoryRegistry();
  const importer = new LangfuseEvalRunImporter(
    {
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
    registry.port,
  );

  const redlines = await importer.importArtifact(REDLINES_BASELINE);
  const preferenceMemory = await importer.importArtifact(
    PREFERENCE_MEMORY_BASELINE,
  );
  const skills = await importer.importArtifact(SKILLS_BASELINE);

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
  assert.deepEqual(skills, {
    datasetName: 'harness-evalrun:harness-skills',
    importedItems: 2,
    runId: 'skills-five-piece-recorded-v2',
  });
  assert.equal(requests.length, 27);
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
  assert.deepEqual(requests.at(-1)?.body.input, {
    caseId: 'different-skill-eval-is-rejected',
    gateId: 'skill_revision_acceptance',
    promptRevision: 'skills/daily-industry@1',
    scorerRevision: 'skill-routing-scorer@2',
    skillRevisionRef: 'skill.daily-industry@1',
  });
  assert.equal(registry.runs.size, 3);
  assert.equal(
    registry.runs.get('skills-five-piece-recorded-v2')?.results.length,
    2,
  );
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
  const registry = memoryRegistry();
  const importer = new LangfuseEvalRunImporter(
    {
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
    registry.port,
  );

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
  const registry = memoryRegistry();
  const importer = new LangfuseEvalRunImporter(
    {
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
    registry.port,
  );
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
  assert.equal(registry.runs.size, 0);
});

test('a partial Langfuse failure leaves the immutable EvalRun registry untouched', async (t) => {
  let requests = 0;
  let registryPuts = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    await readJson(request);
    sendJson(response, requests === 2 ? 503 : 200, {});
  });
  const registry: EvalRunRegistryPort = {
    async putImmutable(_runId, fullRun) {
      registryPuts += 1;
      return fullRun;
    },
    async get() {
      return null;
    },
  };
  const importer = new LangfuseEvalRunImporter(
    {
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
    registry,
  );

  await assert.rejects(
    importer.importArtifact(SKILLS_BASELINE),
    /Langfuse dataset item import failed with HTTP 503/u,
  );
  assert.equal(requests, 2);
  assert.equal(registryPuts, 0);
});

test('a registry failure can replay the stable Langfuse projections and then succeed', async (t) => {
  const requestIds: string[] = [];
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    requestIds.push(String(body.id));
    sendJson(response, 200, { id: body.id });
  });
  let registryAttempts = 0;
  let storedRunId: string | null = null;
  const registry: EvalRunRegistryPort = {
    async putImmutable(runId, fullRun) {
      registryAttempts += 1;
      if (registryAttempts === 1) {
        throw new Error('fixture registry write failed');
      }
      storedRunId = runId;
      return structuredClone(fullRun);
    },
    async get() {
      return null;
    },
  };
  const importer = new LangfuseEvalRunImporter(
    {
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
    registry,
  );

  await assert.rejects(
    importer.importArtifact(SKILLS_BASELINE),
    /fixture registry write failed/u,
  );
  const result = await importer.importArtifact(SKILLS_BASELINE);

  assert.deepEqual(result, {
    datasetName: 'harness-evalrun:harness-skills',
    importedItems: 2,
    runId: 'skills-five-piece-recorded-v2',
  });
  assert.equal(registryAttempts, 2);
  assert.equal(storedRunId, 'skills-five-piece-recorded-v2');
  assert.deepEqual(requestIds.slice(0, 2), requestIds.slice(2));
});

test('CLI exits nonzero when Langfuse environment is not configured', () => {
  const env = { ...process.env };
  env.DATABASE_URL = 'postgres://fixture.invalid/unused';
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

test('CLI exits nonzero when the EvalRun registry database is not configured', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LANGFUSE_BASE_URL: 'https://langfuse.invalid',
    LANGFUSE_PUBLIC_KEY: 'pk-test',
    LANGFUSE_SECRET_KEY: 'sk-test',
  };
  delete env.DATABASE_URL;
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
    /DATABASE_URL is required to persist the imported EvalRun/u,
  );
});

test(
  'CLI imports a workspace-relative EvalRun artifact into Langfuse and PostgreSQL',
  {
    skip: process.env.TEST_DATABASE_URL
      ? false
      : 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
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
        DATABASE_URL: process.env.TEST_DATABASE_URL!,
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
  },
);

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
