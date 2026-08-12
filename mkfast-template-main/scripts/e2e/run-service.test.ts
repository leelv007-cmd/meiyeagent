import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_EVIDENCE_DIRECTORY,
  createOutputTail,
  createViteWorkerdFailureDetector,
  instrumentFailureDirectory,
  readInstrumentFailureRecords,
  readServiceExitRecords,
  repositoryRoot,
  resolveEvidenceDirectory,
  serviceExitDirectory,
} from './service-exit-evidence.mjs';
import ServiceLivenessReporter from './service-liveness-reporter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = resolve(here, 'run-service.mjs');

async function loadConfiguredLivenessReporter(
  options: ConstructorParameters<typeof ServiceLivenessReporter>[0]
) {
  const config = (
    await import(`../../playwright.config.ts?reporter=${Date.now()}`)
  ).default;
  const reporters = Array.isArray(config.reporter) ? config.reporter : [];
  const configured = reporters.find(
    (entry) =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      entry[0].endsWith('/scripts/e2e/service-liveness-reporter.mjs')
  );
  assert.ok(configured && Array.isArray(configured));
  const reporterId = configured[0];
  assert.equal(typeof reporterId, 'string');
  const loaded = (await import(pathToFileURL(reporterId).href)) as {
    default: typeof ServiceLivenessReporter;
  };
  assert.equal(loaded.default, ServiceLivenessReporter);
  return { config, reporter: new loaded.default(options) };
}

type WrapperRun = {
  code: number | null;
  evidenceDirectory: string;
  record: {
    exitCode: number | null;
    pid: number;
    service: string;
    shutdownRequested: boolean;
    signal: string | null;
    tail: string[];
  };
  signal: string | null;
  stderr: string;
};

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await delay(10);
  }
  assert.fail(message);
}

async function runWrappedService(
  service: string,
  childSource: string,
  options: {
    destroyReaderAfterMs?: number;
    environment?: Record<string, string>;
    signalWrapperAfterMs?: number;
  } = {}
): Promise<WrapperRun> {
  const environment = {
    CI_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'run-service-evidence-')),
  };
  const child = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: environment.CI_EVIDENCE_DIR,
        E2E_SERVICE_NAME: service,
        ...options.environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  if (options.destroyReaderAfterMs !== undefined) {
    setTimeout(
      () => child.stdout.destroy(),
      options.destroyReaderAfterMs
    ).unref();
  }

  if (options.signalWrapperAfterMs !== undefined) {
    setTimeout(
      () => child.kill('SIGTERM'),
      options.signalWrapperAfterMs
    ).unref();
  }

  const [code, signal] = await new Promise<[number | null, string | null]>(
    (resolveExit, reject) => {
      const timer = setTimeout(
        () => reject(new Error('the service wrapper did not exit')),
        15_000
      );
      child.once('exit', (exitCode, exitSignal) => {
        clearTimeout(timer);
        resolveExit([exitCode, exitSignal as string | null]);
      });
    }
  );

  const exitDirectory = serviceExitDirectory(environment);
  const files = readdirSync(exitDirectory);
  assert.equal(files.length, 1, `expected one exit record, got ${files}`);
  const record = JSON.parse(
    readFileSync(join(exitDirectory, files[0]), 'utf8')
  ) as WrapperRun['record'];

  return {
    code,
    evidenceDirectory: environment.CI_EVIDENCE_DIR,
    record,
    signal,
    stderr,
  };
}

test('the first Vite workerd failure frame writes one instrument record', async () => {
  const run = await runWrappedService(
    'web',
    [
      "process.stderr.write('8:32:57 PM [vite] Internal server error: fetch failed\\n');",
      "process.stderr.write('8:32:58 PM [vite] Internal server error: terminated\\n');",
      'setTimeout(() => process.exit(0), 200);',
    ].join('\n')
  );

  const directory = join(run.evidenceDirectory, 'instrument-failures');
  assert.ok(
    existsSync(directory),
    'the signature must create instrument evidence'
  );
  const files = readdirSync(directory);
  assert.equal(
    files.length,
    1,
    `only the first frame is evidence, got ${files}`
  );
  const failure = JSON.parse(
    readFileSync(join(directory, files[0]), 'utf8')
  ) as {
    detectedAt: string;
    kind: string;
    message: string;
    pid: number;
    resolution: string;
    service: string;
    stream: string;
  };
  assert.equal(failure.kind, 'vite-workerd-disconnected');
  assert.equal(failure.message, 'Internal server error: fetch failed');
  assert.equal(failure.service, 'web');
  assert.equal(failure.stream, 'stderr');
  assert.equal(failure.resolution, 'fatal');
  assert.equal(typeof failure.pid, 'number');
  assert.ok(!Number.isNaN(Date.parse(failure.detectedAt)));
});

test('the Vite detector accepts a chunked ANSI terminated frame once', () => {
  const failures: Array<{
    kind: string;
    message: string;
    stream: string;
  }> = [];
  const detector = createViteWorkerdFailureDetector((failure) => {
    failures.push(failure);
    return true;
  });

  detector.append('stderr', '\u001B[31m8:32:57 PM [vite] Internal server ');
  detector.append('stderr', 'error: terminated\u001B[0m\n');
  detector.append(
    'stderr',
    '8:32:58 PM [vite] Internal server error: fetch failed\n'
  );

  assert.deepEqual(failures, [
    {
      kind: 'vite-workerd-disconnected',
      message: 'Internal server error: terminated',
      stream: 'stderr',
    },
  ]);
});

test('the Vite detector ignores non-signature fetch failures', () => {
  const failures: unknown[] = [];
  const detector = createViteWorkerdFailureDetector((failure) => {
    failures.push(failure);
    return true;
  });

  detector.append('stderr', 'TypeError: fetch failed\n');
  detector.append(
    'stderr',
    '[vite] Internal server error: connection refused\n'
  );
  detector.append(
    'stdout',
    'HTTP 500 body: Internal server error: terminated\n'
  );

  assert.deepEqual(failures, []);
});

test('the Vite detector retries its cached first frame after a write fails', () => {
  const failures: string[] = [];
  let attempts = 0;
  const detector = createViteWorkerdFailureDetector((failure) => {
    attempts += 1;
    if (attempts === 1) return false;
    failures.push(failure.message);
    return true;
  });

  detector.append('stderr', '[vite] Internal server error: fetch failed\n');
  detector.retry();
  detector.append('stderr', '[vite] Internal server error: terminated\n');

  assert.equal(attempts, 2);
  assert.deepEqual(failures, ['Internal server error: fetch failed']);
});

test('the wrapper persists one cached frame after its first write fails', async () => {
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'run-service-retry-'));
  const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
  writeFileSync(instrumentDirectory, 'not a directory');
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      "process.stderr.write('[vite] Internal server error: fetch failed\\n'); setInterval(() => {}, 1_000);",
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    await waitFor(
      () => stderr.includes('failed to write instrument evidence'),
      'the first instrument write did not fail'
    );
    rmSync(instrumentDirectory);
    mkdirSync(instrumentDirectory, { recursive: true });
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        }).length === 1,
      'the cached first frame was not retried'
    );

    const [failure] = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    });
    assert.equal(
      failure?.record.message,
      'Internal server error: fetch failed'
    );
  } finally {
    wrapperProcess.kill('SIGTERM');
    if (
      wrapperProcess.exitCode === null &&
      wrapperProcess.signalCode === null
    ) {
      await new Promise((resolveExit) =>
        wrapperProcess.once('exit', resolveExit)
      );
    }
  }
});

test('bounded shutdown settlement asynchronously persists a cached first frame', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-shutdown-retry-')
  );
  const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
  writeFileSync(instrumentDirectory, 'not a directory');
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      "process.stderr.write('[vite] Internal server error: fetch failed\\n'); setInterval(() => {}, 1_000);",
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  await waitFor(
    () => stderr.includes('failed to write instrument evidence'),
    'the first instrument write did not fail'
  );
  const wrapperExit = new Promise<[number | null, string | null]>(
    (resolveExit) =>
      wrapperProcess.once('exit', (code, exitSignal) =>
        resolveExit([code, exitSignal as string | null])
      )
  );
  wrapperProcess.kill('SIGTERM');
  await delay(10);
  rmSync(instrumentDirectory);
  mkdirSync(instrumentDirectory, { recursive: true });
  const [, signal] = await wrapperExit;

  const [failure] = readInstrumentFailureRecords({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
  });
  assert.equal(signal, 'SIGTERM');
  assert.equal(failure?.record.message, 'Internal server error: fetch failed');
  assert.equal(failure?.record.resolution, 'fatal');
  assert.equal(failure?.record.resolutionReason, 'shutdown-requested');
  const interrupts: number[] = [];
  const reported: string[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    report: (line: string) => reported.push(line),
    since: 0,
  });
  reporter.check();
  assert.equal(interrupts.length, 1);
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
});

test('shutdown publishes a reporter-consumable fallback when evidence cannot settle', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-shutdown-fail-closed-')
  );
  const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
  writeFileSync(instrumentDirectory, 'not a directory');
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      "process.stderr.write('[vite] Internal server error: fetch failed\\n'); setInterval(() => {}, 1_000);",
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  await waitFor(
    () => stderr.includes('failed to write instrument evidence'),
    'the first instrument write did not fail'
  );
  const wrapperExit = new Promise<[number | null, string | null]>(
    (resolveExit) =>
      wrapperProcess.once('exit', (code, signal) =>
        resolveExit([code, signal as string | null])
      )
  );
  wrapperProcess.kill('SIGTERM');
  const [code, signal] = await wrapperExit;

  assert.equal(code, 2);
  assert.equal(signal, null);
  assert.match(stderr, /instrument evidence did not settle.*failing closed/u);
  const interrupts: number[] = [];
  const reported: string[] = [];
  const { config, reporter } = await loadConfiguredLivenessReporter({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    report: (line: string) => reported.push(line),
    since: 0,
  });
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  const webServer = servers.find((server) => server.name === 'Web');
  assert.deepEqual(webServer?.gracefulShutdown, {
    signal: 'SIGTERM',
    timeout: 10_000,
  });

  reporter.check();

  const [failure] = readInstrumentFailureRecords({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
  });
  assert.equal(failure?.record.resolution, 'fatal');
  assert.equal(failure?.record.resolutionReason, 'shutdown-requested');
  assert.equal(dirname(failure?.file ?? ''), evidenceDirectory);
  assert.equal(interrupts.length, 1);
  assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
});

test(
  'child exit during settlement preserves status without an eight-second delay',
  { timeout: 12_000 },
  async () => {
    const evidenceDirectory = mkdtempSync(
      join(tmpdir(), 'run-service-shutdown-child-exit-')
    );
    const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
    const exitTrigger = join(evidenceDirectory, 'exit-child');
    writeFileSync(instrumentDirectory, 'not a directory');
    const wrapperProcess = spawn(
      process.execPath,
      [
        wrapper,
        process.execPath,
        '-e',
        [
          "const { existsSync } = require('node:fs');",
          `const exitTrigger = ${JSON.stringify(exitTrigger)};`,
          "process.stderr.write('[vite] Internal server error: fetch failed\\n');",
          'const poll = setInterval(() => {',
          '  if (!existsSync(exitTrigger)) return;',
          '  clearInterval(poll);',
          '  setTimeout(() => process.exit(7), 80);',
          '}, 1);',
        ].join('\n'),
      ],
      {
        env: {
          ...process.env,
          CI_EVIDENCE_DIR: evidenceDirectory,
          E2E_SERVICE_NAME: 'web',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );
    let stderr = '';
    wrapperProcess.stderr.setEncoding('utf8');
    wrapperProcess.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    await waitFor(
      () => stderr.includes('failed to write instrument evidence'),
      'the first instrument write did not fail'
    );
    const wrapperExit = new Promise<[number | null, string | null]>(
      (resolveExit) =>
        wrapperProcess.once('exit', (code, signal) =>
          resolveExit([code, signal as string | null])
        )
    );
    const shutdownStartedAt = Date.now();
    wrapperProcess.kill('SIGTERM');
    writeFileSync(exitTrigger, 'exit');
    await delay(120);
    rmSync(instrumentDirectory);
    mkdirSync(instrumentDirectory, { recursive: true });
    const [code, signal] = await wrapperExit;

    assert.equal(code, 7);
    assert.equal(signal, null);
    assert.ok(
      Date.now() - shutdownStartedAt < 1_000,
      'an exited child must not leave the eight-second kill timer alive'
    );
  }
);

test('a later frame recovers evidence after burst retries are exhausted', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-recovery-retry-')
  );
  const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
  writeFileSync(instrumentDirectory, 'not a directory');
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      [
        "process.stderr.write('[vite] Internal server error: fetch failed\\n');",
        "setTimeout(() => process.stderr.write('[vite] Internal server error: terminated\\n'), 1_500);",
        'setInterval(() => {}, 1_000);',
      ].join(''),
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    await waitFor(
      () => stderr.includes('entering recovery retries'),
      'the burst retry budget was not exhausted'
    );
    rmSync(instrumentDirectory);
    mkdirSync(instrumentDirectory, { recursive: true });
    await waitFor(() => {
      const [failure] = readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      });
      return dirname(failure?.file ?? '') === instrumentDirectory;
    }, 'the later frame did not recover the cached first frame');

    const [failure] = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    });
    assert.equal(
      failure?.record.message,
      'Internal server error: fetch failed'
    );
    assert.equal(failure?.record.resolution, 'fatal');
    assert.equal(dirname(failure?.file ?? ''), instrumentDirectory);
    assert.equal(
      readdirSync(evidenceDirectory).some((entry) =>
        entry.startsWith('instrument-failure-fallback-')
      ),
      false
    );
  } finally {
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('a Vite frame from a non-web service is not instrument evidence', async () => {
  const run = await runWrappedService(
    'core',
    [
      "process.stderr.write('[vite] Internal server error: fetch failed\\n');",
      'setTimeout(() => process.exit(0), 200);',
    ].join('\n')
  );

  assert.equal(
    existsSync(join(run.evidenceDirectory, 'instrument-failures')),
    false
  );
});

test('the production door does not inspect its auxiliary Vite service', async () => {
  const run = await runWrappedService(
    'web',
    [
      "process.stderr.write('[vite] Internal server error: fetch failed\\n');",
      'setTimeout(() => process.exit(0), 200);',
    ].join('\n'),
    { environment: { PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true' } }
  );

  assert.equal(
    existsSync(join(run.evidenceDirectory, 'instrument-failures')),
    false
  );
});

test('an unexpected exit within the restart budget respawns the service', async () => {
  // V31-70: workerd dies mid-gate even in healthy runs. With a budget the
  // supervisor heals the death instead of forwarding it; every incarnation
  // still writes its own evidence record and only the final one is a verdict.
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-evidence-')
  );
  const child = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', 'process.exit(7)'],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_MAX_RESTARTS: '2',
        E2E_SERVICE_NAME: 'core',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stderr = '';
  child.stdout.on('data', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await new Promise<[number | null, string | null]>(
    (resolveExit, reject) => {
      const timer = setTimeout(
        () => reject(new Error('the restarting wrapper did not exit')),
        15_000
      );
      child.once('exit', (exitCode, exitSignal) => {
        clearTimeout(timer);
        resolveExit([exitCode, exitSignal as string | null]);
      });
    }
  );

  // Budget of 2 → three incarnations, and only the last exit is forwarded.
  assert.equal(code, 7);
  assert.match(
    stderr,
    /restarting core after unexpected exit code 7 \(1\/2\)/u
  );
  assert.match(
    stderr,
    /restarting core after unexpected exit code 7 \(2\/2\)/u
  );
  const exitDirectory = serviceExitDirectory({
    CI_EVIDENCE_DIR: evidenceDirectory,
  });
  const records = readdirSync(exitDirectory)
    .map(
      (file) =>
        JSON.parse(readFileSync(join(exitDirectory, file), 'utf8')) as {
          restarted: boolean;
          shutdownRequested: boolean;
        }
    )
    .sort((a, b) => Number(a.restarted) - Number(b.restarted));
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map(({ restarted }) => restarted),
    [false, true, true]
  );
  assert.ok(records.every(({ shutdownRequested }) => !shutdownRequested));
});

test('the production-default poll waits for the same incarnation restart', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-resolution-race-')
  );
  const marker = join(evidenceDirectory, 'first-incarnation');
  const childSource = [
    "const { existsSync, writeFileSync } = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    'if (!existsSync(marker)) {',
    "  writeFileSync(marker, 'first');",
    "  setTimeout(() => process.stderr.write('[vite] Internal server error: fetch failed\\n'), 1_850);",
    '  setTimeout(() => process.exit(7), 2_250);',
    '} else {',
    '  setInterval(() => {}, 1_000);',
    '}',
  ].join('\n');
  const wrapperProcess = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_MAX_RESTARTS: '1',
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  wrapperProcess.stderr.resume();
  const interrupts: number[] = [];
  const reported: string[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    report: (line: string) => reported.push(line),
    since: 0,
  });

  try {
    reporter.onBegin();
    await delay(2_100);
    const [pending] = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    });
    assert.equal(
      pending?.record.resolution,
      'pending',
      'the first production-default poll must observe a pending verdict'
    );
    assert.deepEqual(
      interrupts,
      [],
      'the default poll must not race a still-pending incarnation'
    );
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        })[0]?.record.resolution === 'restarted',
      'the healed incarnation did not publish its resolution'
    );
    assert.deepEqual(interrupts, []);
    assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
  } finally {
    reporter.onEnd();
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('a healed incarnation keeps retrying its own pending evidence', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-old-retry-')
  );
  const instrumentDirectory = join(evidenceDirectory, 'instrument-failures');
  const marker = join(evidenceDirectory, 'first-incarnation');
  writeFileSync(instrumentDirectory, 'not a directory');
  const childSource = [
    "const { existsSync, writeFileSync } = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    'if (!existsSync(marker)) {',
    "  writeFileSync(marker, 'first');",
    "  process.stderr.write('first-only [vite] Internal server error: fetch failed\\n');",
    '  setTimeout(() => process.exit(7), 100);',
    '} else {',
    "  process.stderr.write('replacement-only-tail\\n');",
    '  setInterval(() => {}, 1_000);',
    '}',
  ].join('\n');
  const wrapperProcess = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_MAX_RESTARTS: '1',
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    await waitFor(
      () => stderr.includes('replacement-only-tail'),
      'the replacement incarnation did not start'
    );
    rmSync(instrumentDirectory);
    mkdirSync(instrumentDirectory);
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        })[0]?.record.resolution === 'restarted',
      'the healed incarnation did not finish its cached write'
    );

    const [failure] = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    });
    const [healed] = readServiceExitRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    });
    assert.equal(failure?.record.resolutionReason, 'service-restarted');
    assert.equal(failure?.record.incarnationId, healed?.record.incarnationId);
    assert.equal(failure?.record.pid, healed?.record.pid);
    assert.ok(failure?.record.tail.some((line) => line.includes('first-only')));
    assert.ok(
      failure?.record.tail.every((line) => !line.includes('replacement-only'))
    );
  } finally {
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('late output from a healed incarnation keeps its original pid and tail', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-incarnation-')
  );
  const marker = join(evidenceDirectory, 'first-incarnation');
  const delayedSource = [
    "setTimeout(() => process.stderr.write('[vite] Internal server error: fetch failed\\n'), 250);",
    'setTimeout(() => process.exit(0), 300);',
  ].join('');
  const childSource = [
    "const { existsSync, writeFileSync } = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    `const marker = ${JSON.stringify(marker)};`,
    'if (!existsSync(marker)) {',
    "  writeFileSync(marker, 'first');",
    `  spawn(process.execPath, ['-e', ${JSON.stringify(delayedSource)}],`,
    "    { stdio: ['ignore', 'ignore', 'inherit'] });",
    '  setTimeout(() => process.exit(7), 20);',
    '} else {',
    "  process.stderr.write('replacement-only-tail\\n');",
    "  setTimeout(() => process.stderr.write('[vite] Internal server error: terminated\\n'), 100);",
    '  setTimeout(() => process.exit(0), 500);',
    '}',
  ].join('\n');
  const wrapperProcess = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_MAX_RESTARTS: '1',
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  wrapperProcess.stderr.resume();
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the incarnation probe did not exit')),
      15_000
    );
    wrapperProcess.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });

  const exits = readServiceExitRecords({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
  });
  const failures = readInstrumentFailureRecords({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
  });
  const healed = exits.find(({ record }) => record.restarted);
  const replacement = exits.find(({ record }) => !record.restarted);
  assert.ok(healed);
  assert.ok(replacement);
  const delayedFailure = failures.find(
    ({ record }) => record.incarnationId === healed.record.incarnationId
  );
  const replacementFailure = failures.find(
    ({ record }) => record.incarnationId === replacement.record.incarnationId
  );
  assert.ok(delayedFailure);
  assert.ok(replacementFailure);
  assert.equal(delayedFailure.record.pid, healed.record.pid);
  assert.notEqual(delayedFailure.record.pid, replacement.record.pid);
  assert.ok(
    delayedFailure.record.tail.some((line) => line.includes('fetch failed'))
  );
  assert.ok(
    delayedFailure.record.tail.every(
      (line) => !line.includes('replacement-only-tail')
    )
  );
  assert.ok(
    replacementFailure.record.tail.some((line) =>
      line.includes('replacement-only-tail')
    )
  );
  assert.ok(
    replacementFailure.record.tail.every(
      (line) => !line.includes('fetch failed')
    )
  );
});

test('a signal death leaves evidence and keeps the signal', async () => {
  const run = await runWrappedService(
    'core',
    [
      "process.stdout.write('core boot line\\n');",
      "process.stderr.write('core warning line\\n');",
      "setTimeout(() => process.kill(process.pid, 'SIGKILL'), 200);",
    ].join('')
  );

  // The wrapper must still re-raise the child's signal unchanged.
  assert.equal(run.signal, 'SIGKILL');
  assert.equal(run.code, null);

  assert.equal(run.record.service, 'core');
  assert.equal(run.record.signal, 'SIGKILL');
  assert.equal(run.record.exitCode, null);
  // Nobody asked the supervisor to stop — this is the mid-run-death shape
  // the liveness reporter must alarm on.
  assert.equal(run.record.shutdownRequested, false);
  assert.equal(typeof run.record.pid, 'number');
  assert.ok(run.record.tail.includes('[stdout] core boot line'));
  assert.ok(run.record.tail.includes('[stderr] core warning line'));
  assert.match(run.stderr, /\[run-service\] core exited with signal SIGKILL/u);
});

test('a requested shutdown marks its exit record as such', async () => {
  // Playwright tears its webServers down with SIGTERM to the supervisor
  // BEFORE reporters see onEnd, so this flag — not lifecycle timing — is what
  // keeps a healthy teardown from reading as an instrument failure (control
  // probe, 2026-08-12).
  const run = await runWrappedService('web', 'setInterval(() => {}, 1_000);', {
    signalWrapperAfterMs: 200,
  });

  assert.equal(run.record.shutdownRequested, true);
  assert.equal(run.record.service, 'web');
  assert.equal(run.record.signal, 'SIGTERM');
});

test('teardown output is ignored by the real wrapper and reporter', async () => {
  const run = await runWrappedService(
    'web',
    [
      "process.on('SIGTERM', () => {",
      "  process.stderr.write('[vite] Internal server error: terminated\\n');",
      '  setTimeout(() => process.exit(0), 20);',
      '});',
      'setInterval(() => {}, 1_000);',
    ].join('\n'),
    { signalWrapperAfterMs: 200 }
  );
  const interrupts: number[] = [];
  const reported: string[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: run.evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    report: (line: string) => reported.push(line),
    since: 0,
  });

  reporter.check();

  assert.equal(run.record.shutdownRequested, true);
  assert.equal(
    existsSync(
      instrumentFailureDirectory({
        CI_EVIDENCE_DIR: run.evidenceDirectory,
      })
    ),
    false
  );
  assert.deepEqual(interrupts, []);
  assert.deepEqual(reported, []);
});

test('a real signature before teardown remains a gate verdict', async () => {
  const run = await runWrappedService(
    'web',
    [
      "process.stderr.write('[vite] Internal server error: terminated\\n');",
      'setInterval(() => {}, 1_000);',
    ].join('\n'),
    { signalWrapperAfterMs: 200 }
  );
  const interrupts: number[] = [];
  const reported: string[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: run.evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    report: (line: string) => reported.push(line),
    since: 0,
  });

  reporter.onEnd();

  const [failure] = readInstrumentFailureRecords({
    environment: { CI_EVIDENCE_DIR: run.evidenceDirectory },
  });
  assert.equal(run.record.shutdownRequested, true);
  assert.equal(failure?.record.resolution, 'fatal');
  assert.equal(failure?.record.resolutionReason, 'shutdown-requested');
  assert.equal(interrupts.length, 1);
  assert.ok(reported[0]?.includes('Internal server error: terminated'));
});

test('a live wrapped web signature reaches the real reporter interrupt seam', async () => {
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'run-service-seam-'));
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      "process.stderr.write('[vite] Internal server error: fetch failed\\n'); setInterval(() => {}, 1_000);",
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'web',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  wrapperProcess.stderr.resume();
  const interrupts: number[] = [];
  const reported: string[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    pollIntervalMs: 5,
    report: (line: string) => reported.push(line),
    since: 0,
  });

  try {
    const startedWatchingAt = Date.now();
    reporter.onBegin();
    await waitFor(
      () => interrupts.length === 1,
      'the detector -> JSON -> reporter seam did not interrupt'
    );
    assert.equal(
      readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      }).length,
      1
    );
    assert.ok(
      Date.now() - startedWatchingAt < 2_000,
      'a live parent must resolve and interrupt within one production poll'
    );
    assert.ok(reported.some((line) => /GATE INSTRUMENT FAILURE/u.test(line)));
  } finally {
    reporter.onEnd();
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('a clean exit leaves evidence and keeps the exit code', async () => {
  const run = await runWrappedService(
    'production-candidate',
    [
      'for (let index = 1; index <= 300; index += 1)',
      "  process.stdout.write('line ' + index + '\\n');",
      "process.stderr.write('read ECONNRESET\\n');",
      'setTimeout(() => process.exit(7), 200);',
    ].join('\n')
  );

  // The wrapper must still forward the child's exit code unchanged.
  assert.equal(run.code, 7);
  assert.equal(run.signal, null);

  assert.equal(run.record.service, 'production-candidate');
  assert.equal(run.record.exitCode, 7);
  assert.equal(run.record.signal, null);
  // Bounded tail: the last lines survive, the first ones are dropped.
  assert.equal(run.record.tail.length, 200);
  assert.ok(run.record.tail.includes('[stdout] line 300'));
  assert.ok(run.record.tail.includes('[stderr] read ECONNRESET'));
  assert.ok(!run.record.tail.includes('[stdout] line 1'));
});

test('a lost reader neither kills the wrapper nor loses the record', async () => {
  const run = await runWrappedService(
    'web',
    [
      "const noise = 'noise '.repeat(4000);",
      'const timer = setInterval(',
      '  () => process.stdout.write(noise + String.fromCharCode(10)),',
      '  5',
      ');',
      'setTimeout(() => { clearInterval(timer); process.exit(5); }, 800);',
    ].join('\n'),
    { destroyReaderAfterMs: 100 }
  );

  // An unhandled EPIPE here would orphan the detached child and lose the
  // record the liveness reporter reads.
  assert.equal(run.code, 5);
  assert.equal(run.signal, null);
  assert.equal(run.record.exitCode, 5);
  assert.ok(run.record.tail.length > 0);
});

test('CI_EVIDENCE_DIR follows the repository-root gate convention', () => {
  assert.ok(existsSync(join(repositoryRoot, 'mkfast-template-main')));
  assert.equal(
    resolveEvidenceDirectory({
      CI_EVIDENCE_DIR: 'output/ci/v31-browser-acceptance',
    }),
    resolve(repositoryRoot, 'output/ci/v31-browser-acceptance')
  );
  assert.equal(
    resolveEvidenceDirectory({}),
    resolve(repositoryRoot, DEFAULT_EVIDENCE_DIRECTORY)
  );
  assert.equal(
    resolveEvidenceDirectory({ CI_EVIDENCE_DIR: '/tmp/evidence' }),
    '/tmp/evidence'
  );
});

test('the output tail bounds both the line count and a single line', () => {
  const tail = createOutputTail({ maxLineLength: 10, maxLines: 3 });
  tail.append('stdout', 'a\nb\nc\nd\n');
  assert.deepEqual(tail.lines(), ['[stdout] b', '[stdout] c', '[stdout] d']);

  const unterminated = createOutputTail({ maxLineLength: 10, maxLines: 3 });
  unterminated.append('stdout', 'x'.repeat(5_000));
  for (const line of unterminated.lines()) {
    assert.ok(line.length <= '[stdout] '.length + 10);
  }
  assert.ok(unterminated.lines().length <= 3);
});

test('the real Playwright config wraps every browser-gate service', async () => {
  const priorCandidate = process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE;
  process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE = 'true';
  const config = (
    await import(`../../playwright.config.ts?services=${Date.now()}`)
  ).default;
  if (priorCandidate === undefined) {
    delete process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE;
  } else {
    process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE = priorCandidate;
  }
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  const commands = servers.map((server) => server.command);

  assert.ok(
    commands.some(
      (command) =>
        command.includes('E2E_SERVICE_NAME=core') &&
        command.includes('node scripts/e2e/run-service.mjs')
    )
  );
  assert.ok(
    commands.some(
      (command) =>
        command.includes('E2E_SERVICE_NAME=p1-worker') &&
        command.includes('node scripts/e2e/run-service.mjs')
    )
  );
  assert.ok(
    commands.some(
      (command) =>
        command.includes('E2E_SERVICE_NAME=web') &&
        command.includes('node scripts/e2e/run-service.mjs pnpm exec vite dev')
    )
  );
  assert.ok(
    commands.some(
      (command) =>
        command.includes('E2E_SERVICE_NAME=production-candidate') &&
        command.includes(
          'node scripts/e2e/run-service.mjs pnpm exec wrangler dev'
        )
    )
  );
});
