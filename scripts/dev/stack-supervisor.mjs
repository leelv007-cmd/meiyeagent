import { fetchHealthy } from './health-fetch.mjs';

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function observeChildExit(child) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolveExit) => {
    child.once('error', () => resolveExit({ code: 1, signal: null }));
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null && !child.signalCode) child.kill(signal);
  }
}

function processGroupIsAlive(child) {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(child) && Date.now() < deadline) {
    await delay(20);
  }
  return !processGroupIsAlive(child);
}

async function stopProcessGroup(child, childExit, graceMs) {
  signalProcessGroup(child, 'SIGTERM');
  const graceful = await waitForProcessGroupExit(child, graceMs);
  if (graceful) return;
  signalProcessGroup(child, 'SIGKILL');
  await Promise.all([
    Promise.race([childExit, delay(graceMs)]),
    waitForProcessGroupExit(child, graceMs),
  ]);
}

async function closeAfterChildExit(child, childExit, exit, shutdownGraceMs) {
  await stopProcessGroup(child, childExit, shutdownGraceMs);
  return {
    code: 1,
    reason: 'child-exit',
    signal: exit.signal,
  };
}

async function healthResult(label, url, timeoutMs) {
  try {
    await fetchHealthy(label, url, {}, { timeoutMs });
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      ok: false,
    };
  }
}

export async function superviseStack({
  child,
  consecutiveFailureLimit = 3,
  coreHealthUrl,
  healthRequestTimeoutMs = 2_000,
  monitorIntervalMs = 2_000,
  onReady = async () => undefined,
  readinessIntervalMs = 500,
  readinessTimeoutMs = 120_000,
  shutdownGraceMs = 2_000,
  webHealthUrl,
}) {
  const childExit = observeChildExit(child);
  const readinessDeadline = Date.now() + readinessTimeoutMs;
  let lastReadinessError = new Error('Web and Core are not ready.');
  let ready = false;

  while (Date.now() < readinessDeadline) {
    const readiness = await Promise.race([
      Promise.all([
        healthResult('Web', webHealthUrl, healthRequestTimeoutMs),
        healthResult('Core', coreHealthUrl, healthRequestTimeoutMs),
      ]).then((checks) => ({ checks, type: 'health' })),
      childExit.then((exit) => ({ exit, type: 'exit' })),
    ]);
    if (readiness.type === 'exit') {
      return closeAfterChildExit(
        child,
        childExit,
        readiness.exit,
        shutdownGraceMs,
      );
    }
    const failed = readiness.checks.find((check) => !check.ok);
    if (!failed) {
      await onReady();
      ready = true;
      break;
    }
    lastReadinessError = failed.error;
    const pause = await Promise.race([
      delay(readinessIntervalMs).then(() => ({ type: 'delay' })),
      childExit.then((exit) => ({ exit, type: 'exit' })),
    ]);
    if (pause.type === 'exit') {
      return closeAfterChildExit(
        child,
        childExit,
        pause.exit,
        shutdownGraceMs,
      );
    }
  }

  if (!ready) {
    await stopProcessGroup(child, childExit, shutdownGraceMs);
    return {
      code: 1,
      error: new Error(
        `Stack readiness timed out: ${lastReadinessError.message}`,
      ),
      reason: 'readiness-timeout',
      signal: null,
    };
  }

  let consecutiveFailures = 0;
  let lastHealthError;
  while (true) {
    const next = await Promise.race([
      delay(monitorIntervalMs).then(() => ({ type: 'interval' })),
      childExit.then((exit) => ({ exit, type: 'exit' })),
    ]);
    if (next.type === 'exit') {
      return closeAfterChildExit(
        child,
        childExit,
        next.exit,
        shutdownGraceMs,
      );
    }

    const checks = await Promise.all([
      healthResult('Web', webHealthUrl, healthRequestTimeoutMs),
      healthResult('Core', coreHealthUrl, healthRequestTimeoutMs),
    ]);
    const failed = checks.find((check) => !check.ok);
    if (!failed) {
      consecutiveFailures = 0;
      continue;
    }
    consecutiveFailures += 1;
    lastHealthError = failed.error;
    if (consecutiveFailures < consecutiveFailureLimit) continue;

    await stopProcessGroup(child, childExit, shutdownGraceMs);
    return {
      code: 1,
      error: new Error(
        `Stack became unhealthy after ${consecutiveFailures} consecutive checks: ${lastHealthError.message}`,
      ),
      reason: 'unhealthy',
      signal: null,
    };
  }
}
