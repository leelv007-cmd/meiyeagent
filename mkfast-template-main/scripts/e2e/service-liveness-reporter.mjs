import {
  formatInstrumentFailure,
  instrumentFailureDirectory,
  readInstrumentFailureRecords,
  readServiceExitRecords,
  serviceExitDirectory,
} from './service-exit-evidence.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
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
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    // Records older than this process belong to an earlier run.
    this.since = options.since ?? currentProcessStartedAt();
    this.report =
      options.report ?? ((line) => process.stderr.write(`${line}\n`));
    this.interrupt = options.interrupt ?? interruptRun;
    this.failures = [];
    this.healedFiles = new Set();
    this.timer = undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin() {
    this.start();
  }

  onEnd() {
    // Best-effort only: Playwright tears its webServers down before calling
    // onEnd, so teardown exits are screened by the shutdownRequested filter
    // in check(), not by this stop.
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

  check() {
    // A record whose supervisor was asked to stop is Playwright's own
    // teardown, not a death — and teardown happens BEFORE this reporter's
    // onEnd fires, so the running timer will see those records. Only an exit
    // nobody requested is an instrument failure. Output-signature records are
    // already first-frame failures and do not use the shutdown flag.
    const records = [
      ...readServiceExitRecords({
        environment: this.environment,
        since: this.since,
      }).filter(({ record }) => record.shutdownRequested !== true),
      ...readInstrumentFailureRecords({
        environment: this.environment,
        since: this.since,
      }),
    ];
    if (records.length === 0) return;

    // V31-70: a death the supervisor healed by restarting the service is
    // forensic evidence, not a verdict — the run keeps going and at most the
    // in-flight spec fails once. Say so once per record and keep watching.
    for (const entry of records) {
      if (entry.record.restarted !== true) continue;
      if (this.healedFiles.has(entry.file)) continue;
      this.healedFiles.add(entry.file);
      this.report(
        `[gate-liveness] ${entry.record.service} died unexpectedly and was ` +
          `restarted by run-service; evidence: ${entry.file}`
      );
    }

    const fatal = records.filter(({ record }) => record.restarted !== true);
    if (fatal.length === 0) return;

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
