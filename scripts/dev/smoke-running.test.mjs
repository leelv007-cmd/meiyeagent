import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { writeStackState } from './stack-state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const smokeRunningScript = resolve(here, 'smoke-running.mjs');
const SECRET = 'never-print-running-smoke';
const SECRET_DATABASE_URL = `postgres://operator:${SECRET}@127.0.0.1:54329/should_not_drop`;

function listen(handler) {
  return new Promise((resolveListen, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP address.'));
        return;
      }
      resolveListen({ port: address.port, server });
    });
    server.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function healthyCoreHandler(request, response) {
  if (request.url === '/health/ready' || request.url?.startsWith('/health/ready?')) {
    sendJson(response, 200, {
      data: {
        checks: [
          { name: 'postgresql', status: 'pass' },
          {
            detail: 'Worker heartbeat ageMs=12',
            name: 'workerFreshness',
            status: 'pass',
          },
        ],
        ready: true,
        status: 'ready',
      },
    });
    return;
  }
  response.writeHead(404);
  response.end();
}

function runCli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [smokeRunningScript, ...args], {
      env: {
        ...process.env,
        DATABASE_URL: SECRET_DATABASE_URL,
        HARNESS_DBOS_SYSTEM_DATABASE_URL: `${SECRET_DATABASE_URL}_dbos`,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => resolveRun({ code, output }));
  });
}

async function withReadyStack(webHandler, fn) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-running-smoke-'));
  const statePath = join(directory, 'stack-state.json');
  const web = await listen(webHandler);
  const core = await listen(healthyCoreHandler);
  assert.notEqual(web.port, 3000);
  assert.notEqual(core.port, 3000);
  try {
    await writeStackState(
      {
        APP_ENV: 'e2e',
        CORE_PORT: String(core.port),
        DATABASE_URL: SECRET_DATABASE_URL,
        HARNESS_DBOS_SYSTEM_DATABASE_URL: `${SECRET_DATABASE_URL}_dbos`,
        JOB_QUEUE_PREFIX: 'meiye-running-smoke-test',
        MODEL_EXECUTION_MODE: 'fixture',
        PORT: String(web.port),
      },
      { path: statePath, pid: process.pid, status: 'ready' },
    );
    return await fn({
      corePort: core.port,
      directory,
      statePath,
      webPort: web.port,
    });
  } finally {
    await closeServer(web.server);
    await closeServer(core.server);
    await rm(directory, { force: true, recursive: true });
  }
}

function assertCredentialFree(text) {
  assert.doesNotMatch(text, new RegExp(SECRET, 'u'));
  assert.doesNotMatch(text, /postgres:\/\//u);
  assert.doesNotMatch(text, /should_not_drop/u);
  assert.doesNotMatch(text, /DROP DATABASE/iu);
}

test('running smoke goes red when Web /api/ping is 500 even if stack-state is ready', async () => {
  await withReadyStack((request, response) => {
    if (request.url === '/api/ping' || request.url?.startsWith('/api/ping?')) {
      sendJson(response, 500, { error: 'synthetic-web-500' });
      return;
    }
    response.writeHead(404);
    response.end();
  }, async ({ statePath }) => {
    const result = await runCli([], { MEIYE_STACK_STATE_PATH: statePath });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Web returned HTTP 500/u);
    assert.doesNotMatch(result.output, /dev:smoke:running passed/u);
    assert.doesNotMatch(result.output, /Lane-79 smoke/u);
    assert.doesNotMatch(result.output, /provision-test-db/u);
    assertCredentialFree(result.output);
    const state = await readFile(statePath, 'utf8');
    assertCredentialFree(state);
  });
});

test('dev:status goes red on the same ready stack when Web /api/ping is 500', async () => {
  await withReadyStack((request, response) => {
    if (request.url === '/api/ping' || request.url?.startsWith('/api/ping?')) {
      sendJson(response, 500, { error: 'synthetic-web-500' });
      return;
    }
    response.writeHead(404);
    response.end();
  }, async ({ directory, statePath }) => {
    const result = await runCli(['--status'], {
      MEIYE_STACK_STATE_PATH: statePath,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Web returned HTTP 500/u);
    assertCredentialFree(result.output);
    for (const entry of await readdir(directory)) {
      const body = await readFile(join(directory, entry), 'utf8');
      assertCredentialFree(body);
    }
  });
});

test('running smoke is green against a ready stack with healthy Web/Core/worker', async () => {
  await withReadyStack((request, response) => {
    if (request.url === '/api/ping' || request.url?.startsWith('/api/ping?')) {
      sendJson(response, 200, { message: 'pong' });
      return;
    }
    response.writeHead(404);
    response.end();
  }, async ({ corePort, statePath, webPort }) => {
    const result = await runCli([], { MEIYE_STACK_STATE_PATH: statePath });
    assert.equal(result.code, 0);
    assert.match(result.output, /dev:smoke:running passed/u);
    assert.match(result.output, new RegExp(`web=127\\.0\\.0\\.1:${webPort}`, 'u'));
    assert.match(result.output, new RegExp(`core=127\\.0\\.0\\.1:${corePort}`, 'u'));
    assert.match(result.output, /worker=ok/u);
    assertCredentialFree(result.output);
  });
});

test('running smoke does not create a replacement stack-state when none is ready', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-running-smoke-missing-'));
  const statePath = join(directory, 'stack-state.json');
  try {
    const result = await runCli([], { MEIYE_STACK_STATE_PATH: statePath });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /no running stack found/u);
    await assert.rejects(() => readFile(statePath), { code: 'ENOENT' });
    assertCredentialFree(result.output);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('package.json exposes isolated and running smoke as separate scripts', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(here, '../../package.json'), 'utf8'),
  );
  assert.match(packageJson.scripts['dev:smoke:isolated'], /smoke-stack\.mjs/u);
  assert.match(packageJson.scripts['dev:smoke:running'], /smoke-running\.mjs/u);
  assert.match(packageJson.scripts['dev:status'], /smoke-running\.mjs/u);
  assert.match(packageJson.scripts['dev:status'], /--status/u);
  assert.doesNotMatch(packageJson.scripts['dev:smoke'] ?? '', /smoke-stack\.mjs/u);
});
