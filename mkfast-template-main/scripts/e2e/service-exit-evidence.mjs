import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

// scripts/e2e -> scripts -> mkfast-template-main -> repository root.
export const repositoryRoot = resolve(moduleDirectory, '..', '..', '..');

// Every browser gate job in .github/workflows/core-quality.yml hands its script
// a repository-root-relative CI_EVIDENCE_DIR (`output/ci/<gate>`) and uploads
// exactly that directory as the job artifact. The service wrapper runs with
// mkfast-template-main as its working directory, so a relative value is
// resolved against the repository root — resolving it against the wrapper's
// own cwd would drop the evidence outside the uploaded artifact.
export const DEFAULT_EVIDENCE_DIRECTORY = 'output/ci/e2e-services';

const DEFAULT_TAIL_LINES = 200;
const DEFAULT_MAX_LINE_LENGTH = 2_000;
const MAX_SERVICE_SLUG_LENGTH = 80;

export function resolveEvidenceDirectory(environment = process.env) {
  const configured =
    environment.CI_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_DIRECTORY;
  return isAbsolute(configured)
    ? configured
    : resolve(repositoryRoot, configured);
}

export function serviceExitDirectory(environment = process.env) {
  return join(resolveEvidenceDirectory(environment), 'service-exits');
}

function slugifyService(service) {
  const slug = String(service)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SERVICE_SLUG_LENGTH);
  return slug || 'service';
}

/**
 * Bounded tail of a service's interleaved stdout/stderr. Only the last
 * `maxLines` lines are retained, so a service that logs for an hour costs the
 * wrapper a fixed amount of memory.
 */
export function createOutputTail({
  maxLines = DEFAULT_TAIL_LINES,
  maxLineLength = DEFAULT_MAX_LINE_LENGTH,
} = {}) {
  const lines = [];
  const pending = { stderr: '', stdout: '' };

  const push = (stream, text) => {
    lines.push(`[${stream}] ${text.slice(0, maxLineLength)}`);
    if (lines.length > maxLines) lines.shift();
  };

  return {
    append(stream, chunk) {
      const parts = `${pending[stream]}${chunk}`.split('\n');
      pending[stream] = parts.pop() ?? '';
      for (const part of parts) push(stream, part.replace(/\r$/u, ''));
      // A service that never emits a newline must not grow the buffer.
      if (pending[stream].length >= maxLineLength) {
        push(stream, pending[stream]);
        pending[stream] = '';
      }
    },
    lines() {
      const flushed = [...lines];
      for (const stream of ['stdout', 'stderr']) {
        if (!pending[stream]) continue;
        flushed.push(`[${stream}] ${pending[stream].slice(0, maxLineLength)}`);
      }
      return flushed.slice(-maxLines);
    },
  };
}

export function writeServiceExitRecord({
  args = [],
  code = null,
  command,
  environment = process.env,
  pid,
  service,
  shutdownRequested = false,
  signal = null,
  startedAt,
  tail = [],
}) {
  const directory = serviceExitDirectory(environment);
  mkdirSync(directory, { recursive: true });
  const exitedAt = Date.now();
  const record = {
    args,
    command,
    exitCode: code ?? null,
    exitedAt: new Date(exitedAt).toISOString(),
    pid,
    service,
    // Whether the supervisor was asked to stop (SIGTERM/SIGINT) before the
    // child exited. Playwright tears its webServers down BEFORE reporters see
    // onEnd, so lifecycle timing cannot separate a teardown exit from a
    // mid-run death — this flag is what can (control probe, 2026-08-12).
    shutdownRequested,
    signal: signal ?? null,
    startedAt: new Date(startedAt).toISOString(),
    tail,
    uptimeMs: exitedAt - startedAt,
  };
  const file = join(directory, `${slugifyService(service)}-${pid}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record };
}

/**
 * Exit records written at or after `since`. Records from an earlier run (a
 * previous local `pnpm e2e`, say) keep their older mtime and are ignored, so a
 * stale evidence directory cannot fail the current run.
 */
export function readServiceExitRecords({
  environment = process.env,
  since = 0,
} = {}) {
  const directory = serviceExitDirectory(environment);
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = join(directory, entry);
    try {
      if (statSync(file).mtimeMs < since) continue;
      found.push({ file, record: JSON.parse(readFileSync(file, 'utf8')) });
    } catch {
      // A record still being written is picked up by the next poll.
    }
  }
  return found.sort((left, right) =>
    left.record.exitedAt < right.record.exitedAt ? -1 : 1
  );
}

export function formatInstrumentFailure({ file, record }) {
  const cause =
    record.signal === null || record.signal === undefined
      ? `exit code ${record.exitCode}`
      : `signal ${record.signal}`;
  return [
    `GATE INSTRUMENT FAILURE: ${record.service} (pid ${record.pid})`,
    `exited mid-run with ${cause}`,
    '— remaining specs NOT evaluated;',
    `exit evidence: ${file}`,
  ].join(' ');
}
