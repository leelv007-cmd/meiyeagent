import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_EVIDENCE_DIRECTORY,
  createOutputTail,
  repositoryRoot,
  resolveEvidenceDirectory,
  serviceExitDirectory,
} from './service-exit-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = resolve(here, 'run-service.mjs');

type WrapperRun = {
  code: number | null;
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

async function runWrappedService(
  service: string,
  childSource: string,
  options: {
    destroyReaderAfterMs?: number;
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

  return { code, record, signal, stderr };
}

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

test('every Playwright service names itself for the exit evidence', () => {
  const config = readFileSync(resolve(here, '../../playwright.config.ts'), {
    encoding: 'utf8',
  });
  const names = [...config.matchAll(/E2E_SERVICE_NAME=([\w-]+)/gu)].map(
    (match) => match[1]
  );
  assert.deepEqual(names.sort(), [
    'core',
    'p1-worker',
    'production-candidate',
    'web',
  ]);
});
