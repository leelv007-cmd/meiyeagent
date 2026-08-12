import { spawn } from 'node:child_process';

import {
  createOutputTail,
  createServiceIncarnationId,
  createViteWorkerdFailureDetector,
  writeInstrumentFailureRecord,
  writeServiceExitRecord,
} from './service-exit-evidence.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('run-service requires a command.');
}

const service = process.env.E2E_SERVICE_NAME ?? [command, ...args].join(' ');
// V31-70: workerd dies mid-gate with a fatal kj Broken pipe even in healthy
// runs, turning one infra crash into a gate-wide cascade. With a restart
// budget the supervisor respawns an unexpectedly dead service instead of
// forwarding its exit; every death still writes its own evidence record
// (marked `restarted: true` when healed) so nothing is hidden. Opt-in: the
// default of 0 keeps the original die-with-the-child semantics.
const maxRestarts = Math.max(
  0,
  Number.parseInt(process.env.E2E_SERVICE_MAX_RESTARTS ?? '0', 10) || 0
);
const INSTRUMENT_WRITE_RETRY_MS = 50;
const INSTRUMENT_WRITE_RECOVERY_MS = 1_000;
const MAX_INSTRUMENT_WRITE_ATTEMPTS = 20;
const INSTRUMENT_RESOLUTION_DEADLINE_MS = 750;
let restartsUsed = 0;

let currentChild;
let currentInstrument;
const instrumentWriters = new Set();
let shutdownTimer;
let shuttingDown = false;

function forward(source, sink, stream, tail, detector) {
  let writable = true;
  // The reader can disappear before the service does. An unhandled EPIPE would
  // kill this supervisor, orphaning the detached child and losing its exit
  // record, so a broken sink only stops the forwarding — the tail, the exit
  // record and the forwarded exit status all survive it.
  sink.on('error', () => {
    writable = false;
    source.resume();
  });
  source.setEncoding('utf8');
  source.on('data', (chunk) => {
    tail.append(stream, chunk);
    detector?.append(stream, chunk);
    if (!writable) return;
    // Keep a slow reader back-pressuring the service exactly as the previously
    // inherited pipe did, instead of buffering its log in this process.
    if (sink.write(chunk)) return;
    source.pause();
    sink.once('drain', () => source.resume());
  });
}

function signalChildGroup(signal) {
  if (!currentChild?.pid) return;
  try {
    process.kill(
      process.platform === 'win32' ? currentChild.pid : -currentChild.pid,
      signal
    );
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  // A frame observed before teardown remains a real gate event. Resolve and
  // synchronously retry it before the child can emit teardown-shaped noise or
  // make this wrapper exit before its retry timer fires.
  currentInstrument?.resolve('fatal', 'shutdown-requested');
  for (const write of instrumentWriters) write();
  shuttingDown = true;
  signalChildGroup(signal);
  shutdownTimer = setTimeout(() => signalChildGroup('SIGKILL'), 8_000);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

function launch() {
  const startedAt = Date.now();
  const tail = createOutputTail();
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  currentChild = child;
  const incarnationId = createServiceIncarnationId({
    pid: child.pid,
    service,
    startedAt,
  });
  let detectedAt;
  let detectedTail;
  let failure;
  let initialInstrumentWriteSucceeded = false;
  let instrumentWriteFailures = 0;
  let persistedResolution;
  let resolution = 'pending';
  let resolutionReason = null;
  let resolvedAt = null;
  let resolutionTimer;
  let retryTimer;
  let detector;
  let instrumentAnnounced = false;
  let recoveryAnnounced = false;

  function scheduleInstrumentWriteRetry() {
    if (retryTimer) return;
    let delay = INSTRUMENT_WRITE_RETRY_MS;
    if (instrumentWriteFailures >= MAX_INSTRUMENT_WRITE_ATTEMPTS) {
      delay = INSTRUMENT_WRITE_RECOVERY_MS;
      if (!recoveryAnnounced) {
        recoveryAnnounced = true;
        process.stderr.write(
          `[run-service] instrument evidence burst exhausted for ${service}; ` +
            `entering recovery retries with the cached first frame\n`
        );
      }
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (initialInstrumentWriteSucceeded) writeInstrumentFailure();
      else detector?.retry();
    }, delay);
    retryTimer.unref?.();
  }

  function writeInstrumentFailure() {
    if (!failure || persistedResolution === resolution) return true;
    try {
      const { file } = writeInstrumentFailureRecord({
        detectedAt,
        incarnationId,
        ...failure,
        pid: child.pid,
        resolution,
        resolutionReason,
        resolvedAt,
        service,
        shutdownRequested: false,
        startedAt,
        tail: detectedTail,
      });
      initialInstrumentWriteSucceeded = true;
      instrumentWriteFailures = 0;
      persistedResolution = resolution;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (!instrumentAnnounced) {
        instrumentAnnounced = true;
        process.stderr.write(
          `[run-service] ${service} emitted ${failure.message}; ` +
            `instrument evidence: ${file}\n`
        );
      }
      if (resolution !== 'pending') instrumentWriters.delete(flushInstrument);
      return true;
    } catch (error) {
      instrumentWriteFailures += 1;
      if (instrumentWriteFailures === 1) {
        process.stderr.write(
          `[run-service] failed to write instrument evidence for ` +
            `${service}: ${error}\n`
        );
      }
      scheduleInstrumentWriteRetry();
      return false;
    }
  }

  function flushInstrument() {
    if (!failure) return true;
    if (initialInstrumentWriteSucceeded) return writeInstrumentFailure();
    return detector?.retry() ?? false;
  }

  function resolveInstrument(nextResolution, reason, at = Date.now()) {
    if (resolution === 'pending') {
      resolution = nextResolution;
      resolutionReason = reason;
      resolvedAt = at;
      if (resolutionTimer) clearTimeout(resolutionTimer);
      resolutionTimer = undefined;
    }
    return flushInstrument();
  }

  const instrument = {
    flush: flushInstrument,
    resolve: resolveInstrument,
  };
  currentInstrument = instrument;

  detector =
    service === 'web' && process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE !== 'true'
      ? createViteWorkerdFailureDetector((detectedFailure) => {
          // Playwright teardown can make Vite print the same terminated frame
          // as a workerd crash. Once shutdown is requested, the frame is a
          // lifecycle side effect rather than a gate verdict.
          if (detectedAt === undefined) {
            if (shuttingDown) return true;
            detectedAt = Date.now();
            detectedTail = tail.lines();
            failure = detectedFailure;
            instrumentWriters.add(flushInstrument);
            if (resolution === 'pending') {
              resolutionTimer = setTimeout(
                () =>
                  resolveInstrument('fatal', 'embedded-workerd', Date.now()),
                INSTRUMENT_RESOLUTION_DEADLINE_MS
              );
              resolutionTimer.unref?.();
            }
          }
          return writeInstrumentFailure();
        })
      : undefined;

  forward(child.stdout, process.stdout, 'stdout', tail, detector);
  forward(child.stderr, process.stderr, 'stderr', tail, detector);

  let exitStatus;
  let exitAnnounced = false;
  let restarted = false;

  // A service that disappears mid-gate leaves no exit code, no signal and no
  // stack in the job log (see docs/ops/browser-gate-tail-triage-2026-08-12.md
  // §2.3). Persist all three plus the tail of its output, and never let
  // writing that evidence change the exit status this wrapper forwards.
  function recordExit() {
    if (!exitStatus) return;
    try {
      const { file } = writeServiceExitRecord({
        args,
        code: exitStatus.code,
        command,
        exitedAt: exitStatus.exitedAt,
        incarnationId,
        pid: child.pid,
        restarted,
        service,
        shutdownRequested: exitStatus.shutdownRequested,
        signal: exitStatus.signal,
        startedAt,
        tail: tail.lines(),
      });
      if (exitAnnounced) return;
      exitAnnounced = true;
      const cause = exitStatus.signal
        ? `signal ${exitStatus.signal}`
        : `exit code ${exitStatus.code}`;
      process.stderr.write(
        `[run-service] ${service} exited with ${cause}; evidence: ${file}\n`
      );
    } catch (error) {
      process.stderr.write(
        `[run-service] failed to write exit evidence for ${service}: ${error}\n`
      );
    }
  }

  child.once('error', (error) => {
    clearTimeout(shutdownTimer);
    console.error(error);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    clearTimeout(shutdownTimer);
    exitStatus = {
      code,
      exitedAt: Date.now(),
      shutdownRequested: shuttingDown,
      signal,
    };
    restarted = !exitStatus.shutdownRequested && restartsUsed < maxRestarts;
    instrument.resolve(
      restarted ? 'restarted' : 'fatal',
      restarted ? 'service-restarted' : 'service-exit',
      exitStatus.exitedAt
    );
    recordExit();
    if (restarted) {
      restartsUsed += 1;
      process.stderr.write(
        `[run-service] restarting ${service} after unexpected ` +
          `${signal ? `signal ${signal}` : `exit code ${code}`} ` +
          `(${restartsUsed}/${maxRestarts})\n`
      );
      launch();
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  // Output flushed between `exit` and `close` still belongs to the tail; the
  // record is rewritten in place once the pipes drain.
  child.once('close', () => {
    instrument.flush();
    recordExit();
  });
}

launch();
