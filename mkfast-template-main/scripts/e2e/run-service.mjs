import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

import {
  createOutputTail,
  createProductionCandidateNetworkLossDetector,
  createServiceIncarnationId,
  createViteWorkerdFailureDetector,
  writeInstrumentFailureFallbackRecord,
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
const PRODUCTION_CANDIDATE_RESTART_GRACE_MS = 1_500;
const PRODUCTION_CANDIDATE_KILL_GRACE_MS = 250;
const PRODUCTION_CANDIDATE_HEALTH_INTERVAL_MS = 1_000;
const PRODUCTION_CANDIDATE_HEALTH_TIMEOUT_MS = 750;
const PRODUCTION_CANDIDATE_HEALTH_FAILURE_LIMIT = 2;
const INSTRUMENT_SHUTDOWN_RETRY_MS = 10;
const INSTRUMENT_SHUTDOWN_SETTLE_MS = 250;
let restartsUsed = 0;

let currentChild;
let currentInstrument;
const instrumentWriters = new Set();
const instrumentFallbackWriters = new Set();
let pendingChildExit;
let requestedShutdownSignal;
let shutdownEvidenceFailed = false;
let shutdownSettlementDeadline;
let shutdownSettlementTimer;
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

function propagateChildExit(code, signal) {
  if (shutdownEvidenceFailed) {
    process.exitCode = 2;
    return;
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
}

function forwardShutdownSignal(signal) {
  if (pendingChildExit) {
    const { code, signal: childSignal } = pendingChildExit;
    pendingChildExit = undefined;
    propagateChildExit(code, childSignal);
    return;
  }
  signalChildGroup(signal);
  shutdownTimer = setTimeout(() => signalChildGroup('SIGKILL'), 8_000);
}

function finishShutdownSettlement(failed) {
  if (!requestedShutdownSignal) return;
  clearInterval(shutdownSettlementTimer);
  clearTimeout(shutdownSettlementDeadline);
  shutdownSettlementTimer = undefined;
  shutdownSettlementDeadline = undefined;
  if (failed) {
    for (const writeFallback of [...instrumentFallbackWriters]) {
      writeFallback();
    }
  }
  shutdownEvidenceFailed = failed;
  const signal = requestedShutdownSignal;
  requestedShutdownSignal = undefined;
  if (failed) {
    process.stderr.write(
      `[run-service] instrument evidence did not settle before shutdown for ` +
        `${service}; failing closed\n`
    );
  }
  forwardShutdownSignal(signal);
}

function flushInstrumentWriters() {
  for (const write of [...instrumentWriters]) write();
  return instrumentWriters.size === 0;
}

function shutdown(signal) {
  if (shuttingDown) return;
  // Mark teardown before yielding so frames emitted because of the forwarded
  // signal remain lifecycle noise. A frame already observed stays real.
  shuttingDown = true;
  currentInstrument?.resolve('fatal', 'shutdown-requested');
  if (flushInstrumentWriters()) {
    forwardShutdownSignal(signal);
    return;
  }

  // Keep the wrapper alive briefly so a transient filesystem failure cannot
  // erase a pre-shutdown frame before its original signal is propagated.
  requestedShutdownSignal = signal;
  shutdownSettlementTimer = setInterval(() => {
    if (flushInstrumentWriters()) finishShutdownSettlement(false);
  }, INSTRUMENT_SHUTDOWN_RETRY_MS);
  shutdownSettlementDeadline = setTimeout(
    () => finishShutdownSettlement(true),
    INSTRUMENT_SHUTDOWN_SETTLE_MS
  );
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
  let fallbackPersistedResolution;
  let fallbackRecordFile;
  let persistedResolution;
  let resolution = 'pending';
  let resolutionReason = null;
  let resolvedAt = null;
  let resolutionTimer;
  let retryTimer;
  let detector;
  let instrumentAnnounced = false;
  let recoveryAnnounced = false;
  let healthCheckInFlight = false;
  let healthFailureCount = 0;
  let healthMonitorTimer;
  const healthUrl = process.env.E2E_SERVICE_HEALTH_URL?.trim();

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
      if (fallbackRecordFile) {
        try {
          rmSync(fallbackRecordFile, { force: true });
        } catch (error) {
          process.stderr.write(
            `[run-service] failed to remove superseded fallback evidence ` +
              `for ${service}: ${error}\n`
          );
        }
      }
      fallbackPersistedResolution = undefined;
      fallbackRecordFile = undefined;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (!instrumentAnnounced) {
        instrumentAnnounced = true;
        process.stderr.write(
          `[run-service] ${service} emitted ${failure.message}; ` +
            `instrument evidence: ${file}\n`
        );
      }
      if (resolution !== 'pending') {
        instrumentWriters.delete(flushInstrument);
        instrumentFallbackWriters.delete(writeInstrumentFallback);
      }
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

  function writeInstrumentFallback() {
    if (!failure || fallbackPersistedResolution === resolution) return true;
    if (resolution === 'pending') return false;
    try {
      const { file } = writeInstrumentFailureFallbackRecord({
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
      fallbackPersistedResolution = resolution;
      fallbackRecordFile = file;
      instrumentFallbackWriters.delete(writeInstrumentFallback);
      process.stderr.write(
        `[run-service] ${service} fallback instrument evidence: ${file}\n`
      );
      return true;
    } catch (error) {
      process.stderr.write(
        `[run-service] failed to write fallback instrument evidence for ` +
          `${service}: ${error}\n`
      );
      return false;
    }
  }

  function flushInstrument() {
    if (!failure) return true;
    if (initialInstrumentWriteSucceeded) return writeInstrumentFailure();
    return detector?.retry() ?? false;
  }

  function resolveInstrument(nextResolution, reason, at = Date.now()) {
    if (
      resolution === 'pending' ||
      (resolution === 'healthy' &&
        nextResolution !== 'healthy' &&
        !shuttingDown)
    ) {
      resolution = nextResolution;
      resolutionReason = reason;
      resolvedAt = at;
      if (resolutionTimer) clearTimeout(resolutionTimer);
      resolutionTimer = undefined;
    }
    const written = flushInstrument();
    if (!written && reason === 'embedded-workerd') {
      const fallbackWritten = writeInstrumentFallback();
      if (!fallbackWritten) {
        shutdownEvidenceFailed = true;
        shuttingDown = true;
        process.stderr.write(
          `[run-service] instrument evidence is unavailable for ${service}; ` +
            `failing closed while the gate is running\n`
        );
        signalChildGroup('SIGTERM');
        shutdownTimer = setTimeout(() => signalChildGroup('SIGKILL'), 250);
      }
      return fallbackWritten;
    }
    return written;
  }

  function stopHealthMonitor() {
    if (!healthMonitorTimer) return;
    clearInterval(healthMonitorTimer);
    healthMonitorTimer = undefined;
  }

  async function checkProductionCandidateHealth() {
    if (
      !healthUrl ||
      healthCheckInFlight ||
      shuttingDown ||
      currentChild !== child
    ) {
      return;
    }
    healthCheckInFlight = true;
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(PRODUCTION_CANDIDATE_HEALTH_TIMEOUT_MS),
      });
      if (shuttingDown || currentChild !== child) return;
      if (!response.ok) throw new Error(`health status ${response.status}`);
      const payload = await response.json();
      if (payload?.message !== 'pong')
        throw new Error('unexpected health body');
      healthFailureCount = 0;
      resolveInstrument('healthy', 'service-responsive', Date.now());
    } catch {
      if (shuttingDown || currentChild !== child) return;
      healthFailureCount += 1;
      if (healthFailureCount < PRODUCTION_CANDIDATE_HEALTH_FAILURE_LIMIT) {
        return;
      }
      stopHealthMonitor();
      if (restartsUsed < maxRestarts) {
        signalChildGroup('SIGTERM');
        resolutionTimer = setTimeout(
          () => signalChildGroup('SIGKILL'),
          PRODUCTION_CANDIDATE_KILL_GRACE_MS
        );
        resolutionTimer.unref?.();
        return;
      }
      resolveInstrument('fatal', 'service-unresponsive', Date.now());
    } finally {
      healthCheckInFlight = false;
    }
  }

  function startProductionCandidateHealthMonitor() {
    if (!healthUrl) return false;
    void checkProductionCandidateHealth();
    healthMonitorTimer = setInterval(
      () => void checkProductionCandidateHealth(),
      PRODUCTION_CANDIDATE_HEALTH_INTERVAL_MS
    );
    healthMonitorTimer.unref?.();
    return true;
  }

  const instrument = {
    flush: flushInstrument,
    resolve: resolveInstrument,
  };
  currentInstrument = instrument;

  const recordDetectedFailure = (detectedFailure) => {
    // Teardown can emit the same runtime frame as a crash. Once shutdown is
    // requested, the frame is a lifecycle side effect rather than a verdict.
    if (detectedAt === undefined) {
      if (shuttingDown) return true;
      detectedAt = Date.now();
      detectedTail = tail.lines();
      failure = detectedFailure;
      instrumentWriters.add(flushInstrument);
      instrumentFallbackWriters.add(writeInstrumentFallback);
      if (resolution === 'pending') {
        resolutionTimer = setTimeout(
          () => {
            resolutionTimer = undefined;
            if (
              failure.kind === 'workerd-network-connection-lost' &&
              startProductionCandidateHealthMonitor()
            ) {
              // Wrangler can lose an internal control channel while its public
              // Worker remains responsive. Keep probing that real service
              // surface; only sustained unavailability consumes restart budget.
              return;
            }
            if (
              failure.kind === 'workerd-network-connection-lost' &&
              restartsUsed < maxRestarts
            ) {
              signalChildGroup('SIGTERM');
              resolutionTimer = setTimeout(
                () => signalChildGroup('SIGKILL'),
                PRODUCTION_CANDIDATE_KILL_GRACE_MS
              );
              resolutionTimer.unref?.();
              return;
            }
            resolveInstrument('fatal', 'embedded-workerd', Date.now());
          },
          failure.kind === 'workerd-network-connection-lost'
            ? PRODUCTION_CANDIDATE_RESTART_GRACE_MS
            : INSTRUMENT_RESOLUTION_DEADLINE_MS
        );
        resolutionTimer.unref?.();
      }
    }
    return writeInstrumentFailure();
  };
  detector =
    service === 'web' && process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE !== 'true'
      ? createViteWorkerdFailureDetector(recordDetectedFailure)
      : service === 'production-candidate'
        ? createProductionCandidateNetworkLossDetector(recordDetectedFailure)
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
    stopHealthMonitor();
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
    if (requestedShutdownSignal) {
      pendingChildExit = { code, signal };
      return;
    }
    propagateChildExit(code, signal);
  });

  // Output flushed between `exit` and `close` still belongs to the tail; the
  // record is rewritten in place once the pipes drain.
  child.once('close', () => {
    instrument.flush();
    recordExit();
  });
}

launch();
