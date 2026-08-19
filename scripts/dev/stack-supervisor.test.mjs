import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { superviseStack } from './stack-supervisor.mjs';

function spawnFakeStack(markerDirectory) {
  const descendantSource = `
    const { writeFileSync } = require('node:fs');
    const markerDirectory = process.argv[1];
    process.on('SIGTERM', () => {
      writeFileSync(markerDirectory + '/' + process.pid, 'stopped');
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `;
  const source = `
    const { spawn } = require('node:child_process');
    const http = require('node:http');
    const markerDirectory = process.argv[1];
    const childSource = ${JSON.stringify(descendantSource)};
    const children = Array.from({ length: 3 }, () =>
      spawn(process.execPath, ['-e', childSource, markerDirectory], {
        stdio: 'ignore',
      })
    );
    let webRequests = 0;
    const web = http.createServer((_request, response) => {
      webRequests += 1;
      response.statusCode = webRequests === 1 ? 200 : 500;
      response.end();
    });
    const core = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.end();
    });
    Promise.all([
      new Promise((resolve) => web.listen(0, '127.0.0.1', resolve)),
      new Promise((resolve) => core.listen(0, '127.0.0.1', resolve)),
    ]).then(() => {
      process.stdout.write(JSON.stringify({
        corePort: core.address().port,
        childPids: children.map((child) => child.pid),
        webPort: web.address().port,
      }) + '\\n');
    });
    setInterval(() => {}, 1000);
  `;
  return spawn(process.execPath, ['-e', source, markerDirectory], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readFirstJsonLine(child) {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    let stderr = '';
    const timeout = setTimeout(
      () => reject(new Error(`fake stack did not start: ${stderr}`)),
      1_000,
    );
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) {
        clearTimeout(timeout);
        resolveLine(JSON.parse(buffer.slice(0, newline)));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!buffer.includes('\n')) {
        clearTimeout(timeout);
        reject(new Error(`fake stack exited ${code}: ${stderr}`));
      }
    });
  });
}

test('supervisor marks ready then closes the whole process group after consecutive Web failures', async () => {
  const markerDirectory = await mkdtemp(join(tmpdir(), 'meiye-supervisor-'));
  const child = spawnFakeStack(markerDirectory);
  try {
    const ports = await readFirstJsonLine(child);
    let readyCount = 0;
    const startedAt = Date.now();
    const result = await superviseStack({
      child,
      consecutiveFailureLimit: 2,
      coreHealthUrl: `http://127.0.0.1:${ports.corePort}/health/ready`,
      healthRequestTimeoutMs: 100,
      monitorIntervalMs: 20,
      onReady: async () => {
        readyCount += 1;
      },
      readinessIntervalMs: 10,
      readinessTimeoutMs: 500,
      shutdownGraceMs: 500,
      webHealthUrl: `http://127.0.0.1:${ports.webPort}/auth/login`,
    });

    assert.equal(readyCount, 1);
    assert.equal(result.reason, 'unhealthy');
    assert.equal(result.code, 1);
    assert.ok(Date.now() - startedAt < 2_000);

    const deadline = Date.now() + 1_000;
    let markers = [];
    while (Date.now() < deadline) {
      markers = await readdir(markerDirectory);
      if (markers.length === ports.childPids.length) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
    assert.equal(markers.length, ports.childPids.length);
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The supervisor already closed the process group.
    }
    await rm(markerDirectory, { force: true, recursive: true });
  }
});
