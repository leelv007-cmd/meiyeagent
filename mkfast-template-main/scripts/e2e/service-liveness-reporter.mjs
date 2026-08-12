import {
  formatInstrumentFailure,
  instrumentFailureDirectory,
  readInstrumentFailureRecords,
  readServiceExitRecords,
  serviceExitDirectory,
} from './service-exit-evidence.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_CORRELATION_GRACE_MS = 0;
const CORE_RESTART_CORRELATION_MS = 1_000;
const INTERRUPT_GRACE_MS = 30_000;
const HARD_EXIT_CODE = 2;

function currentProcessStartedAt() {
  return Date.now() - Math.round(process.uptime() * 1_000);
}

function interruptRun() {
  // SIGINT is how Playwright is asked to stop: it interrupts the workers, tears
  // the webServers down and exits non-zero (130). The unref'd fallback only
  // fires if that graceful stop never completes.
  const fallback = setTimeout(
    () => process.exit(HARD_EXIT_CODE),
    INTERRUPT_GRACE_MS
  );
  fallback.unref();
  process.kill(process.pid, 'SIGINT');
}

function followsHealedCoreRestart(signature, exits) {
  if (
    signature.record.service !== 'web' ||
    signature.record.message !== 'Internal server error: fetch failed'
  ) {
    return false;
  }
  const detectedAt = Date.parse(signature.record.detectedAt);
  return exits.some(({ record }) => {
    if (
      record.service !== 'core' ||
      record.restarted !== true ||
      record.shutdownRequested === true
    ) {
      return false;
    }
    const exitedAt = Date.parse(record.exitedAt);
    return (
      exitedAt <= detectedAt &&
      detectedAt - exitedAt <= CORE_RESTART_CORRELATION_MS
    );
  });
}

/**
 * Running-service liveness for the browser gates.
 *
 * Playwright's `webServer` only gates startup: once `/health` answers once, a
 * service that dies mid-run is invisible to the run, and every remaining spec
 * fails in the login fixture as if the product were broken (see
 * docs/ops/browser-gate-tail-triage-2026-08-12.md §2.3). This reporter watches
 * the exit records and fatal output-signature records that run-service writes.
 * It turns either failure into one verdict that stops the run, instead of
 * dozens of cascade reds.
 *
 * While every service is alive it reads a directory every few seconds and says
 * nothing.
 */
export default class ServiceLivenessReporter {
  constructor(options = {}) {
    this.environment = options.environment ?? process.env;
    this.correlationGraceMs =
      options.correlationGraceMs ?? DEFAULT_CORRELATION_GRACE_MS;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    // Records older than this process belong to an earlier run.
    this.since = options.since ?? currentProcessStartedAt();
    this.report =
      options.report ?? ((line) => process.stderr.write(`${line}\n`));
    this.interrupt = options.interrupt ?? interruptRun;
    this.failures = [];
    this.healedIncarnations = new Set();
    this.timer = undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin() {
    this.start();
  }

  onEnd() {
    // The door is closing, so every signature seen in this run needs a final
    // synchronous verdict instead of falling out of a correlation window.
    if (this.failures.length === 0) this.check({ flushPending: true });
    this.stop();
  }

  onExit() {
    this.stop();
    // Repeat the verdict after the reporter summary, so it is the last thing in
    // the gate log rather than something buried mid-run.
    for (const line of this.failures) this.report(line);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  check({ flushPending = false } = {}) {
    // A record whose supervisor was asked to stop is Playwright's own
    // teardown, not a death — and teardown happens BEFORE this reporter's
    // onEnd fires, so the running timer will see those records. Only an exit
    // nobody requested is an instrument failure. Output-signature records use
    // the same shutdown flag as a second line of defence against teardown.
    const exits = readServiceExitRecords({
      environment: this.environment,
      since: this.since,
    });
    const signatures = readInstrumentFailureRecords({
      environment: this.environment,
      since: this.since,
    });
    if (exits.length === 0 && signatures.length === 0) return;
    const exitsByIncarnation = new Map(
      exits.map((entry) => [entry.record.incarnationId, entry])
    );

    // V31-70: a death the supervisor healed by restarting the service is
    // forensic evidence, not a verdict — the run keeps going and at most the
    // in-flight spec fails once. Say so once per record and keep watching.
    for (const entry of exits) {
      if (
        entry.record.shutdownRequested === true ||
        entry.record.restarted !== true
      ) {
        continue;
      }
      if (this.healedIncarnations.has(entry.record.incarnationId)) continue;
      this.healedIncarnations.add(entry.record.incarnationId);
      this.report(
        `[gate-liveness] ${entry.record.service} died unexpectedly and was ` +
          `restarted by run-service; evidence: ${entry.file}`
      );
    }

    const fatal = exits.filter(
      ({ record }) =>
        record.shutdownRequested !== true && record.restarted !== true
    );
    for (const entry of signatures) {
      if (entry.record.shutdownRequested === true) continue;
      // Core restarts briefly break Vite's proxy fetch while the Web/workerd
      // incarnation remains healthy. The exact fetch frame plus a bounded,
      // persisted healed-Core exit is owned by that restart, not by workerd.
      if (followsHealedCoreRestart(entry, exits)) continue;
      // An unexpected parent-process exit governs the same incarnation as a
      // healed restart warning or an already-fatal exit. A later requested
      // teardown cannot erase a signature observed while the door was open.
      const matchingExit = exitsByIncarnation.get(entry.record.incarnationId);
      if (matchingExit && matchingExit.record.shutdownRequested !== true) {
        continue;
      }
      const detectedAt = Date.parse(entry.record.detectedAt);
      if (!flushPending && this.now() - detectedAt < this.correlationGraceMs) {
        continue;
      }
      fatal.push(entry);
    }
    if (fatal.length === 0) return;
    fatal.sort((left, right) => {
      const leftAt = Date.parse(left.record.detectedAt ?? left.record.exitedAt);
      const rightAt = Date.parse(
        right.record.detectedAt ?? right.record.exitedAt
      );
      return leftAt - rightAt || left.file.localeCompare(right.file);
    });

    this.stop();
    this.failures = fatal.map((entry) => formatInstrumentFailure(entry));
    for (const line of this.failures) this.report(line);
    this.report(
      'Gate services are supervised by scripts/e2e/run-service.mjs; ' +
        `exit records: ${serviceExitDirectory(this.environment)}; ` +
        `instrument failures: ${instrumentFailureDirectory(this.environment)}`
    );
    this.interrupt();
  }
}
