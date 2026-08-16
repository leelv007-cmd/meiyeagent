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
import { createServer, type RequestListener } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_EVIDENCE_DIRECTORY,
  createOutputTail,
  createProductionCandidateNetworkLossDetector,
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
const productionCandidateNetworkLossLine =
  '✘ [ERROR] Uncaught Error: Network connection lost.';

async function loadConfiguredLivenessReporter(
  options: ConstructorParameters<typeof ServiceLivenessReporter>[0]
) {
  const config = (
    await import(`../../playwright.config.ts?reporter=${Date.now()}`)
  ).default;
  const reporters = Array.isArray(config.reporter) ? config.reporter : [];
  const configured = reporters.find(
    (entry: unknown) =>
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

/**
 * V31-103: how long to wait for the wrapper to observe a startup signature
 * before giving up and tearing down anyway. Detection is a stderr read plus a
 * file write, so this is orders of magnitude above the real cost — it exists so
 * a genuinely missing signature fails the assertion instead of hanging.
 */
const SIGNATURE_OBSERVED_TIMEOUT_MS = 10_000;

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(
  check: () => boolean,
  // A thunk lets a caller fold state captured during the wait into the failure
  // text — the assertion message is the only thing CI prints for a node:test
  // failure, so anything not in it is lost (V31-102).
  message: string | (() => string),
  timeoutMs = 2_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(10);
  }
  assert.fail(typeof message === 'function' ? message() : message);
}

async function runWrappedService(
  service: string,
  childSource: string,
  options: {
    destroyReaderAfterMs?: number;
    environment?: Record<string, string>;
    signalWrapperAfterMs?: number;
    signalWrapperAfterSignature?: boolean;
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

  if (options.signalWrapperAfterSignature) {
    // V31-103. `signalWrapperAfterMs` fires a fixed number of milliseconds after
    // spawn, which is fine for the callers that only need the wrapper to be up:
    // theirs write their signature from inside the SIGTERM handler, so it can
    // only arrive after teardown by construction.
    //
    // It is not fine for a caller whose whole claim is that the signature landed
    // BEFORE teardown. There the delay is standing in for "the wrapper has
    // observed it", and under load it loses: shutdown() resolves
    // `currentInstrument?.` while that is still undefined, the optional chain
    // swallows it, nothing is written, and the assertion reads undefined.
    //
    // So wait for the fact instead of for a duration. The instrument record
    // appears when the detector fires, so its presence IS "the wrapper has seen
    // the signature". The bound below is a hang detector, not a latency budget —
    // if it expires the signature genuinely never arrived, and signalling anyway
    // lets the test fail on its own assertion rather than hanging.
    void (async () => {
      const deadline = Date.now() + SIGNATURE_OBSERVED_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (readInstrumentFailureRecords({ environment }).length > 0) break;
        await delay(10);
      }
      child.kill('SIGTERM');
    })();
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

test('the production detector accepts one chunked ANSI runtime failure', () => {
  const failures: Array<{
    kind: string;
    message: string;
    stream: string;
  }> = [];
  const detector = createProductionCandidateNetworkLossDetector((failure) => {
    failures.push(failure);
    return true;
  });

  detector.append('stderr', '\u001B[31m✘ \u001B[41;31m[ERROR]\u001B[0m ');
  detector.append('stderr', 'Uncaught Error: Network connec');
  detector.append('stderr', 'tion lost.\u001B[0m\n');
  detector.append('stderr', `${productionCandidateNetworkLossLine}\n`);

  assert.deepEqual(failures, [
    {
      kind: 'workerd-network-connection-lost',
      message: 'Network connection lost',
      stream: 'stderr',
    },
  ]);
});

test('the production detector ignores narrative and multiline lookalikes', () => {
  const failures: unknown[] = [];
  const detector = createProductionCandidateNetworkLossDetector((failure) => {
    failures.push(failure);
    return true;
  });

  detector.append(
    'stderr',
    'application recovered: Uncaught Error: Network connection lost. retrying\n'
  );
  detector.append('stderr', 'Uncaught Error:\nNetwork connection lost.\n');
  detector.append('stderr', `prefix ${productionCandidateNetworkLossLine}\n`);

  assert.deepEqual(failures, []);
});

test('the production detector waits for the physical line boundary', () => {
  const failures: unknown[] = [];
  const detector = createProductionCandidateNetworkLossDetector((failure) => {
    failures.push(failure);
    return true;
  });

  detector.append('stderr', productionCandidateNetworkLossLine);
  detector.append('stderr', ' retrying\n');

  assert.deepEqual(failures, []);
});

test('the production detector retries its cached first frame', () => {
  const failures: string[] = [];
  let attempts = 0;
  const detector = createProductionCandidateNetworkLossDetector((failure) => {
    attempts += 1;
    if (attempts === 1) return false;
    failures.push(failure.message);
    return true;
  });

  detector.append('stderr', `${productionCandidateNetworkLossLine}\n`);
  detector.retry();

  assert.equal(attempts, 2);
  assert.deepEqual(failures, ['Network connection lost']);
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
  const webServer = servers.find(
    (server: { name?: string }) => server.name === 'Web'
  );
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
    // V31-92: this assertion has gone red on CI and been undiagnosable, because
    // the wrapper's stderr is collected into a variable that nothing prints and
    // the directory listing is computed inline. Both are the evidence needed to
    // tell "rmSync threw" from "a second fallback was written" from "the
    // cleanup ran before fallbackRecordFile was assigned", so carry them in the
    // failure message rather than making the next reader reproduce a flake.
    const evidenceEntries = readdirSync(evidenceDirectory);
    assert.equal(
      evidenceEntries.some((entry) =>
        entry.startsWith('instrument-failure-fallback-')
      ),
      false,
      `fallback evidence survived the recovery write.\n` +
        `evidence dir: ${evidenceEntries.join(', ')}\n` +
        `recovered record: ${failure?.file}\n` +
        `wrapper stderr:\n${stderr}`
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

test('the production candidate fails closed on a lost runtime connection', async () => {
  const run = await runWrappedService(
    'production-candidate',
    [
      `process.stderr.write(${JSON.stringify(
        `${productionCandidateNetworkLossLine}\n`
      )});`,
      'setTimeout(() => process.exit(0), 1_000);',
    ].join('\n'),
    { environment: { PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true' } }
  );

  const [failure] = readInstrumentFailureRecords({
    environment: { CI_EVIDENCE_DIR: run.evidenceDirectory },
    since: 0,
  });
  assert.equal(failure?.record.service, 'production-candidate');
  assert.equal(failure?.record.kind, 'workerd-network-connection-lost');
  assert.equal(failure?.record.resolution, 'fatal');
});

async function startCandidateHealthFixture(
  prefix: string,
  options: {
    environment?: Record<string, string>;
    failureDelayMs?: number;
    healthHandler?: RequestListener;
  } = {}
) {
  const server = createServer(
    options.healthHandler ??
      ((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"message":"pong"}');
      })
  );
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen)
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const evidenceDirectory = mkdtempSync(join(tmpdir(), prefix));
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      `setTimeout(() => process.stderr.write(${JSON.stringify(
        `${productionCandidateNetworkLossLine}\n`
      )}), ${options.failureDelayMs ?? 0}); setInterval(() => {}, 1_000);`,
    ],
    {
      env: {
        ...process.env,
        ...options.environment,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_HEALTH_URL: `http://127.0.0.1:${address.port}/api/ping`,
        E2E_SERVICE_MAX_RESTARTS: '0',
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  wrapperProcess.stderr.resume();
  const interrupts: number[] = [];
  const reporter = new ServiceLivenessReporter({
    environment: { CI_EVIDENCE_DIR: evidenceDirectory },
    interrupt: () => interrupts.push(Date.now()),
    pollIntervalMs: 5,
    report: () => {},
    since: 0,
  });
  reporter.onBegin();
  return { evidenceDirectory, interrupts, reporter, server, wrapperProcess };
}

async function stopCandidateHealthFixture(
  fixture: Awaited<ReturnType<typeof startCandidateHealthFixture>>
) {
  fixture.wrapperProcess.kill('SIGTERM');
  await new Promise((resolveExit) =>
    fixture.wrapperProcess.once('exit', resolveExit)
  );
  fixture.reporter.onEnd();
  fixture.reporter.onExit();
  if (fixture.server.listening) {
    await closeHealthServer(fixture.server);
  }
}

async function closeHealthServer(
  server: ReturnType<typeof createServer>
): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  );
}

test('a responsive production candidate survives a control-channel loss', async () => {
  const fixture = await startCandidateHealthFixture(
    'run-service-candidate-responsive-'
  );

  try {
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
        })[0]?.record.resolution === 'healthy',
      'the responsive candidate was not classified as healthy',
      4_000
    );
    await delay(250);
    assert.equal(fixture.wrapperProcess.exitCode, null);
    assert.deepEqual(fixture.interrupts, []);
  } finally {
    await stopCandidateHealthFixture(fixture);
  }
  assert.equal(
    readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
    })[0]?.record.resolution,
    'healthy',
    'Playwright teardown must not rewrite a proven healthy verdict'
  );
});

test('candidate health cannot resolve an instrument before its failure is detected', async () => {
  const fixture = await startCandidateHealthFixture(
    'run-service-candidate-health-before-failure-',
    {
      environment: { E2E_SERVICE_HEALTH_INTERVAL_MS: '50' },
      failureDelayMs: 500,
    }
  );

  try {
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
        })[0]?.record.resolution === 'healthy',
      'the delayed control-channel loss was not resolved',
      4_000
    );
    const record = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
    })[0]?.record;
    assert.ok(record);
    assert.ok(
      Date.parse(record.resolvedAt ?? '') >= Date.parse(record.detectedAt),
      'a health sample taken before detection must not resolve a future instrument'
    );
  } finally {
    await stopCandidateHealthFixture(fixture);
  }
});

test('a candidate that becomes unresponsive after a control loss fails closed', async () => {
  const fixture = await startCandidateHealthFixture(
    'run-service-candidate-health-loss-',
    {
      environment: {
        E2E_SERVICE_HEALTH_FAILURE_WINDOW_MS: '500',
        E2E_SERVICE_HEALTH_INTERVAL_MS: '100',
        E2E_SERVICE_HEALTH_TIMEOUT_MS: '100',
      },
    }
  );

  try {
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
        })[0]?.record.resolution === 'healthy',
      'the initial healthy verdict was not persisted',
      4_000
    );
    await closeHealthServer(fixture.server);
    await waitFor(
      () => fixture.interrupts.length === 1,
      'the later health loss did not reach the reporter interrupt seam',
      5_000
    );
    assert.equal(
      readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
      })[0]?.record.resolutionReason,
      'service-unresponsive'
    );
  } finally {
    await stopCandidateHealthFixture(fixture);
  }
});

test('transient candidate health latency does not consume restart budget', async () => {
  let slow = false;
  const fixture = await startCandidateHealthFixture(
    'run-service-candidate-transient-latency-',
    {
      environment: {
        E2E_SERVICE_HEALTH_FAILURE_WINDOW_MS: '5000',
        E2E_SERVICE_HEALTH_INTERVAL_MS: '100',
        E2E_SERVICE_HEALTH_TIMEOUT_MS: '100',
      },
      healthHandler: (_request, response) => {
        const sendPong = () => {
          if (response.destroyed) return;
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"message":"pong"}');
        };
        if (slow) setTimeout(sendPong, 1_200);
        else sendPong();
      },
    }
  );

  try {
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
        })[0]?.record.resolution === 'healthy',
      'the initial candidate health was not confirmed',
      4_000
    );
    slow = true;
    await delay(3_500);
    slow = false;
    await delay(250);
    assert.equal(fixture.wrapperProcess.exitCode, null);
    assert.deepEqual(fixture.interrupts, []);
    assert.equal(
      readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
      })[0]?.record.resolution,
      'healthy'
    );
    assert.equal(
      readServiceExitRecords({
        environment: { CI_EVIDENCE_DIR: fixture.evidenceDirectory },
        since: 0,
      }).length,
      0
    );
  } finally {
    await stopCandidateHealthFixture(fixture);
  }
});

test('a replacement candidate that never becomes ready fails closed', async () => {
  let healthRequests = 0;
  const server = createServer((_request, response) => {
    healthRequests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"message":"pong"}');
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen)
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-candidate-silent-health-loss-')
  );
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      "process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1_000);",
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_HEALTH_URL: `http://127.0.0.1:${address.port}/api/ping`,
        E2E_SERVICE_HEALTH_FAILURE_WINDOW_MS: '500',
        E2E_SERVICE_HEALTH_INTERVAL_MS: '100',
        E2E_SERVICE_MAX_RESTARTS: '1',
        // V31-102: was 100ms, and that is what made this test hang on CI.
        // This budget only bounds a *successful* probe against a live server;
        // once the server is closed the fetch fails immediately (connection
        // refused), so a generous value does not slow failure detection at
        // all. At 100ms a loaded runner could time out the very first probe,
        // healthConfirmed never became true, and run-service.mjs:403 then let
        // the first incarnation wait forever by design — no SIGTERM, no
        // restart, no exit. Reproduced locally by delaying only the first
        // response past 100ms: identical message, identical duration.
        E2E_SERVICE_HEALTH_TIMEOUT_MS: '2000',
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  // V31-102: this stderr used to be resumed and discarded, which is why three
  // CI reds could not be told apart. The wrapper prints `[run-service]
  // restarting …` when it spends its restart budget, so the presence or absence
  // of that line splits the two live candidates on the first red that carries
  // it: printed means the first SIGTERM landed and the second window is where it
  // hangs; absent means the first signal never reached the child at all.
  //
  // Keeping it here rather than in the assertion's own text because the failure
  // message is the only thing CI prints for a node:test assertion.
  let wrapperStderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk: string) => {
    wrapperStderr += chunk;
  });

  try {
    // V31-102: `> 0` was the wrong precondition. It fires when a request
    // ARRIVES, which proves the monitor started but says nothing about whether
    // the wrapper ever confirmed health — and this test's whole premise is a
    // candidate that WAS healthy and then went silent. `>= 2` is the tightest
    // signal available from out here: checkProductionCandidateHealth guards on
    // healthCheckInFlight and clears it in a `finally`
    // (run-service.mjs:376,382,431-433), so a second request can only be issued
    // after the first cycle fully finished. Paired with the raised timeout
    // above — which is what makes that first cycle actually succeed — the
    // candidate is confirmed healthy before the server goes away.
    await waitFor(
      () => healthRequests >= 2,
      'the production candidate health monitor did not complete a check cycle',
      8_000
    );
    await closeHealthServer(server);
    await waitFor(
      () => wrapperProcess.exitCode !== null,
      () =>
        'the replacement candidate remained unready without failing closed; ' +
        `wrapper stderr was ${
          wrapperStderr.trim() === ''
            ? '(empty — no restart was ever announced)'
            : JSON.stringify(wrapperStderr.trim())
        }`,
      5_000
    );
    const exitRecords = readServiceExitRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      since: 0,
    });
    assert.equal(
      exitRecords.filter(({ record }) => record.restarted).length,
      1
    );
    assert.equal(exitRecords.at(-1)?.record.restarted, false);
    assert.equal(wrapperProcess.exitCode, 2);
    assert.equal(
      readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        since: 0,
      }).length,
      0
    );
  } finally {
    if (wrapperProcess.exitCode === null) {
      wrapperProcess.kill('SIGTERM');
      await new Promise((resolveExit) =>
        wrapperProcess.once('exit', resolveExit)
      );
    }
    if (server.listening) await closeHealthServer(server);
  }
});

test('a live production disconnect reaches the reporter interrupt seam', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-candidate-seam-')
  );
  const wrapperProcess = spawn(
    process.execPath,
    [
      wrapper,
      process.execPath,
      '-e',
      `process.stderr.write(${JSON.stringify(
        `${productionCandidateNetworkLossLine}\n`
      )}); setInterval(() => {}, 1_000);`,
    ],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
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
    reporter.onBegin();
    await waitFor(
      () => interrupts.length === 1,
      'the candidate detector -> JSON -> reporter seam did not interrupt'
    );
    assert.equal(
      readInstrumentFailureRecords({
        environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      })[0]?.record.kind,
      'workerd-network-connection-lost'
    );
    assert.ok(reported[0]?.includes('workerd runtime disconnect signature'));
  } finally {
    reporter.onExit();
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('candidate teardown ignores a later lost runtime connection frame', async () => {
  const run = await runWrappedService(
    'production-candidate',
    [
      "process.on('SIGTERM', () => {",
      `  process.stderr.write(${JSON.stringify(
        `${productionCandidateNetworkLossLine}\n`
      )}, () => setTimeout(() => process.exit(0), 25));`,
      '});',
      "process.stdout.write('READY\\n');",
      'setInterval(() => {}, 1_000);',
    ].join('\n'),
    {
      environment: { PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true' },
      signalWrapperAfterMs: 200,
    }
  );

  assert.equal(
    readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: run.evidenceDirectory },
      since: 0,
    }).length,
    0
  );
  assert.ok(
    run.record.tail.some((line) =>
      line.includes(productionCandidateNetworkLossLine)
    ),
    'the ignored teardown frame must have reached the wrapper tail'
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
  assert.deepEqual(interrupts, []);
  assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
});

test('a delayed production candidate exit is healed before the verdict', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-candidate-delayed-restart-')
  );
  const marker = join(evidenceDirectory, 'first-incarnation');
  const childSource = [
    "const { existsSync, writeFileSync } = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    'if (!existsSync(marker)) {',
    "  writeFileSync(marker, 'first');",
    "  process.on('SIGTERM', () => {});",
    `  process.stderr.write(${JSON.stringify(
      `${productionCandidateNetworkLossLine}\n`
    )});`,
    '  setTimeout(() => process.exit(7), 1_000);',
    '} else {',
    "  process.stderr.write('replacement-ready\\n');",
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
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
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
    reporter.onBegin();
    await waitFor(
      () => stderr.includes('replacement-ready'),
      'the delayed candidate incarnation did not restart'
    );
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        })[0]?.record.resolution === 'restarted',
      'the delayed candidate restart did not heal its signature'
    );
    assert.deepEqual(interrupts, []);
    assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
  } finally {
    reporter.onExit();
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('a stubborn candidate is killed and its replacement remains healthy', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-candidate-stubborn-')
  );
  const marker = join(evidenceDirectory, 'first-incarnation');
  const childSource = [
    "const { existsSync, writeFileSync } = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    'if (!existsSync(marker)) {',
    "  writeFileSync(marker, 'first');",
    "  process.on('SIGTERM', () => {});",
    `  process.stderr.write(${JSON.stringify(
      `${productionCandidateNetworkLossLine}\n`
    )});`,
    '  setInterval(() => {}, 1_000);',
    '} else {',
    "  process.stderr.write('replacement-ready\\n');",
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
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  wrapperProcess.stderr.setEncoding('utf8');
  wrapperProcess.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
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
    reporter.onBegin();
    await waitFor(
      () => stderr.includes('replacement-ready'),
      'the stubborn candidate was not killed and restarted',
      5_000
    );
    const [failure] = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      since: 0,
    });
    const [exit] = readServiceExitRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      since: 0,
    });
    assert.equal(failure?.record.resolution, 'restarted');
    assert.equal(exit?.record.signal, 'SIGKILL');
    assert.equal(exit?.record.restarted, true);
    await delay(350);
    assert.equal(wrapperProcess.exitCode, null);
    assert.deepEqual(interrupts, []);
    assert.ok(reported.every((line) => !/GATE INSTRUMENT FAILURE/u.test(line)));
  } finally {
    reporter.onExit();
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
});

test('production candidate network loss exhausts the real restart budget', async () => {
  const evidenceDirectory = mkdtempSync(
    join(tmpdir(), 'run-service-candidate-budget-')
  );
  const childSource = [
    `process.stderr.write(${JSON.stringify(
      `${productionCandidateNetworkLossLine}\n`
    )});`,
    "process.on('SIGTERM', () => process.exit(7));",
    'setInterval(() => {}, 1_000);',
  ].join('\n');
  const wrapperProcess = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        E2E_SERVICE_MAX_RESTARTS: '2',
        E2E_SERVICE_NAME: 'production-candidate',
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  wrapperProcess.stderr.resume();
  try {
    await waitFor(
      () =>
        readInstrumentFailureRecords({
          environment: { CI_EVIDENCE_DIR: evidenceDirectory },
        }).some(({ record }) => record.resolution === 'fatal'),
      'the third candidate signature did not exhaust the restart budget',
      7_000
    );

    const signatures = readInstrumentFailureRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      since: 0,
    });
    assert.deepEqual(
      signatures.map(({ record }) => record.resolution),
      ['restarted', 'restarted', 'fatal']
    );
    const exits = readServiceExitRecords({
      environment: { CI_EVIDENCE_DIR: evidenceDirectory },
      since: 0,
    });
    assert.deepEqual(
      exits.map(({ record }) => record.restarted),
      [true, true]
    );

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
    assert.equal(
      reported.filter((line) => /GATE INSTRUMENT FAILURE/u.test(line)).length,
      1
    );
  } finally {
    wrapperProcess.kill('SIGTERM');
    await new Promise((resolveExit) =>
      wrapperProcess.once('exit', resolveExit)
    );
  }
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
    { signalWrapperAfterSignature: true }
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
  const priorMaxRestarts = process.env.E2E_SERVICE_MAX_RESTARTS;
  process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE = 'true';
  process.env.E2E_SERVICE_MAX_RESTARTS = '0';
  const config = (
    await import(`../../playwright.config.ts?services=${Date.now()}`)
  ).default;
  if (priorCandidate === undefined) {
    delete process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE;
  } else {
    process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE = priorCandidate;
  }
  if (priorMaxRestarts === undefined) {
    delete process.env.E2E_SERVICE_MAX_RESTARTS;
  } else {
    process.env.E2E_SERVICE_MAX_RESTARTS = priorMaxRestarts;
  }
  const servers = Array.isArray(config.webServer) ? config.webServer : [];
  const commands = servers.map((server: { command: string }) => server.command);

  const coreCommand = commands.find(
    (command: string) =>
      command.includes('E2E_SERVICE_NAME=core') &&
      command.includes('node scripts/e2e/run-service.mjs')
  );
  assert.ok(coreCommand);
  assert.match(coreCommand, /APP_BASE_URL=http:\/\/127\.0\.0\.1:\d+/u);
  const workerCommand = commands.find(
    (command: string) =>
      command.includes('E2E_SERVICE_NAME=p1-worker') &&
      command.includes('node scripts/e2e/run-service.mjs')
  );
  assert.ok(workerCommand);
  assert.match(workerCommand, /APP_BASE_URL=http:\/\/127\.0\.0\.1:\d+/u);
  const webCommand = commands.find(
    (command: string) =>
      command.includes('E2E_SERVICE_NAME=web') &&
      command.includes('node scripts/e2e/run-service.mjs pnpm exec vite dev')
  );
  assert.ok(webCommand);
  assert.match(webCommand, /ensure-miniflare-v8-flags\.mjs/u);
  assert.match(webCommand, /vite dev --host 127\.0\.0\.1 --port \d+/u);
  assert.match(
    webCommand,
    /MINIFLARE_WORKERD_V8_FLAGS=--max-old-space-size=8192/u
  );
  const productionCandidateCommand = commands.find(
    (command: string) =>
      command.includes('E2E_SERVICE_NAME=production-candidate') &&
      command.includes(
        'node scripts/e2e/run-service.mjs pnpm exec wrangler dev'
      )
  );
  assert.ok(productionCandidateCommand);
  assert.match(productionCandidateCommand, /E2E_SERVICE_MAX_RESTARTS=0/u);
  assert.doesNotMatch(
    productionCandidateCommand,
    /E2E_SERVICE_MAX_RESTARTS=2/u
  );
  assert.match(
    productionCandidateCommand,
    /E2E_SERVICE_HEALTH_URL=http:\/\/127\.0\.0\.1:\d+\/api\/ping/u
  );
  // The candidate wrangler embeds the same miniflare copy the Web project
  // patches; without the splice and the env on this process, the candidate
  // workerd keeps the ~1.4 GB default heap and dies with "Network connection
  // lost" on the first heavy request (2/2 CI samples, 2026-08-14).
  assert.match(productionCandidateCommand, /ensure-miniflare-v8-flags\.mjs/u);
  assert.match(
    productionCandidateCommand,
    /MINIFLARE_WORKERD_V8_FLAGS=--max-old-space-size=8192/u
  );
});
