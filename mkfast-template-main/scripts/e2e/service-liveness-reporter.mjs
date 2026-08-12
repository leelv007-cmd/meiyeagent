import {
  formatInstrumentFailure,
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
 * the exit records that scripts/e2e/run-service.mjs writes and turns a service
 * death into one instrument failure that stops the run, instead of dozens of
 * cascade reds.
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
    // nobody requested is an instrument failure.
    const records = readServiceExitRecords({
      environment: this.environment,
      since: this.since,
    }).filter(({ record }) => record.shutdownRequested !== true);
    if (records.length === 0) return;

    this.stop();
    this.failures = records.map((entry) => formatInstrumentFailure(entry));
    for (const line of this.failures) this.report(line);
    this.report(
      'Gate services are supervised by scripts/e2e/run-service.mjs; ' +
        `exit records: ${serviceExitDirectory(this.environment)}`
    );
    this.interrupt();
  }
}
