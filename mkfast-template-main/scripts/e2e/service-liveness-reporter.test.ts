import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  writeInstrumentFailureRecord,
  writeServiceExitRecord,
} from './service-exit-evidence.mjs';
import ServiceLivenessReporter from './service-liveness-reporter.mjs';

function freshEnvironment() {
  return {
    CI_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'service-liveness-')),
  };
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function watch(
  environment: { CI_EVIDENCE_DIR: string },
  options: {
    correlationGraceMs?: number;
    now?: () => number;
    since?: number;
  } = {}
) {
  const reported: string[] = [];
  const interrupts: number[] = [];
  const reporter = new ServiceLivenessReporter({
    correlationGraceMs: options.correlationGraceMs ?? 0,
    environment,
    interrupt: () => interrupts.push(Date.now()),
    now: options.now,
    pollIntervalMs: 5,
    report: (line: string) => reported.push(line),
    since: options.since ?? 0,
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

test('a Vite workerd failure frame stops the run as an instrument failure', async () => {
  const environment = freshEnvironment();
  const { file } = writeInstrumentFailureRecord({
    environment,
    incarnationId: 'web:4343:instrument-only',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: terminated',
    pid: 4343,
    service: 'web',
    shutdownRequested: false,
    startedAt: Date.now() - 60_000,
    stream: 'stderr',
    tail: ['[stderr] 8:32:57 PM [vite] Internal server error: terminated'],
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  for (let attempt = 0; attempt < 100 && interrupts.length === 0; attempt++) {
    await delay(10);
  }
  reporter.onEnd();

  assert.equal(interrupts.length, 1, 'the run must be interrupted once');
  assert.equal(
    reported[0],
    `GATE INSTRUMENT FAILURE: web (pid 4343) emitted Vite workerd ` +
      `disconnect signature "Internal server error: terminated" ` +
      `— remaining specs NOT evaluated; instrument evidence: ${file}`
  );
});

test('onEnd flushes a recent signature before the current door closes', () => {
  const environment = freshEnvironment();
  const now = Date.now();
  writeInstrumentFailureRecord({
    detectedAt: now,
    environment,
    incarnationId: 'web:4344:door-end',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: terminated',
    pid: 4344,
    service: 'web',
    shutdownRequested: false,
    startedAt: now - 1_000,
    stream: 'stderr',
  });
  const { interrupts, reported, reporter } = watch(environment, {
    correlationGraceMs: 5_000,
    now: () => now + 100,
  });

  reporter.onBegin();
  reporter.onEnd();

  assert.equal(interrupts.length, 1);
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
});

test('a signature waits for and follows its healed incarnation exit', () => {
  const environment = freshEnvironment();
  const incarnationId = 'web:4344:healed';
  let now = Date.now();
  writeInstrumentFailureRecord({
    detectedAt: now,
    environment,
    incarnationId,
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: fetch failed',
    pid: 4344,
    service: 'web',
    shutdownRequested: false,
    startedAt: now - 1_000,
    stream: 'stderr',
  });
  const { interrupts, reported, reporter } = watch(environment, {
    correlationGraceMs: 500,
    now: () => now,
  });

  reporter.check();
  assert.deepEqual(interrupts, [], 'the correlation window must not race');
  assert.deepEqual(reported, []);

  writeServiceExitRecord({
    args: ['exec', 'vite', 'dev'],
    code: 1,
    command: 'pnpm',
    environment,
    incarnationId,
    pid: 4344,
    restarted: true,
    service: 'web',
    startedAt: now - 1_000,
  });
  now += 1_000;
  reporter.check();

  assert.deepEqual(interrupts, []);
  assert.equal(
    reported.filter((line) => /died unexpectedly and was restarted/u.test(line))
      .length,
    1
  );
  assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
});

test('a healed Core restart owns its concurrent Web fetch failure', () => {
  const environment = freshEnvironment();
  const now = Date.now();
  writeServiceExitRecord({
    args: ['--dir', '..'],
    code: 1,
    command: 'pnpm',
    environment,
    exitedAt: now,
    pid: 4246,
    restarted: true,
    service: 'core',
    startedAt: now - 60_000,
  });
  writeInstrumentFailureRecord({
    detectedAt: now + 50,
    environment,
    incarnationId: 'web:4346:core-restart-proxy-error',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: fetch failed',
    pid: 4346,
    service: 'web',
    shutdownRequested: false,
    startedAt: now - 10_000,
    stream: 'stderr',
  });
  const { interrupts, reported, reporter } = watch(environment, {
    now: () => now + 50,
  });

  reporter.check();

  assert.deepEqual(interrupts, []);
  assert.equal(
    reported.filter((line) => /died unexpectedly and was restarted/u.test(line))
      .length,
    1
  );
  assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
});

test('a later Core restart cannot erase an earlier workerd signature', () => {
  const environment = freshEnvironment();
  const now = Date.now();
  writeInstrumentFailureRecord({
    detectedAt: now,
    environment,
    incarnationId: 'web:4347:workerd-first',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: fetch failed',
    pid: 4347,
    service: 'web',
    shutdownRequested: false,
    startedAt: now - 10_000,
    stream: 'stderr',
  });
  writeServiceExitRecord({
    args: ['--dir', '..'],
    code: 1,
    command: 'pnpm',
    environment,
    exitedAt: now + 50,
    pid: 4247,
    restarted: true,
    service: 'core',
    startedAt: now - 60_000,
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.check();

  assert.equal(interrupts.length, 1);
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
});

test('an embedded workerd signature becomes fatal when web stays alive', () => {
  const environment = freshEnvironment();
  const now = Date.now();
  writeInstrumentFailureRecord({
    detectedAt: now,
    environment,
    incarnationId: 'web:4345:still-alive',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: fetch failed',
    pid: 4345,
    service: 'web',
    shutdownRequested: false,
    startedAt: now - 1_000,
    stream: 'stderr',
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.check();

  assert.equal(interrupts.length, 1);
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
});

test('an instrument record marked as teardown is ignored defensively', () => {
  const environment = freshEnvironment();
  writeInstrumentFailureRecord({
    environment,
    incarnationId: 'web:4346:teardown',
    kind: 'vite-workerd-disconnected',
    message: 'Internal server error: terminated',
    pid: 4346,
    service: 'web',
    shutdownRequested: true,
    startedAt: Date.now() - 1_000,
    stream: 'stderr',
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.check();

  assert.deepEqual(interrupts, []);
  assert.deepEqual(reported, []);
});

test('a death the supervisor healed is a warning, not a verdict', async () => {
  const environment = freshEnvironment();
  // V31-70: run-service respawned the service after this death, so the run
  // keeps going. The reporter says so exactly once and never interrupts.
  writeServiceExitRecord({
    args: ['exec', 'wrangler', 'dev'],
    code: 1,
    command: 'pnpm',
    environment,
    pid: 4244,
    restarted: true,
    service: 'production-candidate',
    startedAt: Date.now() - 60_000,
    tail: ['[stderr] kj::getCaughtExceptionAsKj() ... Broken pipe'],
  });
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  await delay(120);
  reporter.onEnd();
  reporter.onExit();

  assert.equal(interrupts.length, 0);
  const healedLines = reported.filter((line) =>
    /died unexpectedly and was restarted/u.test(line)
  );
  assert.equal(healedLines.length, 1, `healed warning once, got ${reported}`);
  assert.match(healedLines[0]!, /production-candidate/u);
  assert.ok(
    reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)),
    'a healed death must not be an instrument failure'
  );
});

test('a healed death does not mask a later fatal one', async () => {
  const environment = freshEnvironment();
  writeServiceExitRecord({
    args: [],
    code: 1,
    command: 'pnpm',
    environment,
    pid: 4245,
    restarted: true,
    service: 'core',
    startedAt: Date.now() - 60_000,
    tail: [],
  });
  killedCore(environment);
  const { interrupts, reported, reporter } = watch(environment);

  reporter.onBegin();
  for (let attempt = 0; attempt < 100 && interrupts.length === 0; attempt++) {
    await delay(5);
  }
  reporter.onEnd();
  reporter.onExit();

  assert.equal(interrupts.length, 1, 'the fatal death must interrupt the run');
  assert.ok(
    reported.some((line) => /died unexpectedly and was restarted/u.test(line))
  );
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
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
  const { interrupts, reported, reporter } = watch(environment, {
    since: Date.now() + 60_000,
  });

  reporter.onBegin();
  await delay(60);
  reporter.onEnd();

  assert.deepEqual(reported, []);
  assert.equal(interrupts.length, 0);
});

test('touching stale evidence cannot move it into the current watch window', () => {
  const environment = freshEnvironment();
  const { file } = killedCore(environment);
  const since = Date.now() + 1_000;
  const future = new Date(since + 60_000);
  utimesSync(file, future, future);
  const { interrupts, reported, reporter } = watch(environment, { since });

  reporter.check();

  assert.deepEqual(reported, []);
  assert.deepEqual(interrupts, []);
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
      (id): id is string =>
        typeof id === 'string' && id.includes('service-liveness-reporter')
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
