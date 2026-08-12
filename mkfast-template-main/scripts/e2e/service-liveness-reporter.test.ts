import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { writeServiceExitRecord } from './service-exit-evidence.mjs';
import ServiceLivenessReporter from './service-liveness-reporter.mjs';

function freshEnvironment() {
  return {
    CI_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'service-liveness-')),
  };
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function watch(environment: { CI_EVIDENCE_DIR: string }, since = 0) {
  const reported: string[] = [];
  const interrupts: number[] = [];
  const reporter = new ServiceLivenessReporter({
    environment,
    interrupt: () => interrupts.push(Date.now()),
    pollIntervalMs: 5,
    report: (line: string) => reported.push(line),
    since,
  });
  return { interrupts, reported, reporter };
}

function killedCore(environment: { CI_EVIDENCE_DIR: string }) {
  return writeServiceExitRecord({
    args: ['--dir', '..'],
    code: null,
    command: 'pnpm',
    environment,
    pid: 4242,
    service: 'core',
    signal: 'SIGKILL',
    startedAt: Date.now() - 60_000,
    tail: ['[stdout] Harness observability drift detected'],
  });
}

test('a healthy stack is never reported on', async () => {
  const environment = freshEnvironment();
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  await delay(60);
  reporter.onEnd();
  reporter.onExit();

  assert.deepEqual(reported, []);
  assert.equal(interrupts.length, 0);
});

test('a service exit record stops the run as an instrument failure', async () => {
  const environment = freshEnvironment();
  const { file } = killedCore(environment);
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  for (let attempt = 0; attempt < 100 && interrupts.length === 0; attempt++) {
    await delay(10);
  }
  assert.equal(interrupts.length, 1, 'the run must be interrupted once');

  assert.equal(
    reported[0],
    `GATE INSTRUMENT FAILURE: core (pid 4242) exited mid-run with signal ` +
      `SIGKILL — remaining specs NOT evaluated; exit evidence: ${file}`
  );
  assert.ok(existsSync(file));
  assert.match(reported[1], /scripts\/e2e\/run-service\.mjs/u);

  // Polling stops with the first verdict: one failure, not one per poll.
  const settled = reported.length;
  await delay(40);
  assert.equal(reported.length, settled);
  assert.equal(interrupts.length, 1);

  // The verdict is repeated after the run summary.
  reporter.onExit();
  assert.equal(reported.length, settled + 1);
  assert.equal(reported[settled], reported[0]);
});

test('a requested shutdown is never an instrument failure', async () => {
  const environment = freshEnvironment();
  // Playwright's own teardown: the supervisor was asked to stop, and the
  // record says so. The reporter's timer is still alive at that point
  // (webServers come down before onEnd), so only this flag protects a
  // healthy run from a false GATE INSTRUMENT FAILURE.
  writeServiceExitRecord({
    args: ['--dir', '..'],
    code: null,
    command: 'pnpm',
    environment,
    pid: 4243,
    service: 'web',
    shutdownRequested: true,
    signal: 'SIGTERM',
    startedAt: Date.now() - 60_000,
    tail: [],
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  await delay(60);
  reporter.onEnd();
  reporter.onExit();

  assert.deepEqual(reported, []);
  assert.equal(interrupts.length, 0);
});

test('an exit record from an earlier run is ignored', async () => {
  const environment = freshEnvironment();
  killedCore(environment);
  const { interrupts, reported, reporter } = watch(
    environment,
    Date.now() + 60_000
  );

  reporter.onBegin();
  await delay(60);
  reporter.onEnd();

  assert.deepEqual(reported, []);
  assert.equal(interrupts.length, 0);
});

test('the default watch window starts no later than this process', () => {
  const reporter = new ServiceLivenessReporter();
  const processStartedAt = Date.now() - Math.round(process.uptime() * 1_000);
  assert.ok(reporter.since <= processStartedAt + 50);
  assert.ok(reporter.since > processStartedAt - 50);
});

test('Playwright loads the liveness reporter from the real config', async () => {
  // Load the actual config object instead of regex-reading its source: the
  // first spelling of this pin replicated an assumed resolution rule and
  // stayed green while the real `playwright test` crashed on config load
  // (MODULE_NOT_FOUND, kill-acceptance probe 2026-08-12).
  const config = (await import('../../playwright.config.ts')).default;
  const reporters = Array.isArray(config.reporter) ? config.reporter : [];
  const reporterId = reporters
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
    .find(
      (id) => typeof id === 'string' && id.includes('service-liveness-reporter')
    );
  assert.ok(reporterId, 'the config must register the liveness reporter');
  // Playwright resolves string reporter ids with require.resolve from its own
  // package directory, so only an absolute path is resolution-proof.
  assert.ok(
    isAbsolute(reporterId),
    `reporter id must be an absolute path, got: ${reporterId}`
  );
  assert.ok(existsSync(reporterId), `${reporterId} does not exist`);
  const loaded = await import(pathToFileURL(reporterId).href);
  assert.equal(loaded.default, ServiceLivenessReporter);
});
