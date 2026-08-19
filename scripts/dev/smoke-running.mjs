import { pathToFileURL } from 'node:url';
import { fetchHealthy } from './health-fetch.mjs';
import { readStackState, stackStatePathFromEnv } from './stack-state.mjs';

const HEALTH_TIMEOUT_MS = 5_000;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function originFor(port) {
  return `http://127.0.0.1:${port}`;
}

async function probe(label, url, { fetchImpl, timeoutMs }) {
  try {
    const response = await fetchHealthy(label, url, {}, { fetchImpl, timeoutMs });
    return { ok: true, response };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

function workerCheckFromReadyPayload(payload) {
  const data = payload?.data ?? payload;
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  return checks.find((check) => /worker/i.test(String(check?.name ?? '')));
}

export function formatRunningStackReport(inspection) {
  const lines = [
    `stack: ${inspection.state.status} web=${inspection.webOrigin} core=${inspection.coreOrigin}`,
  ];
  for (const check of inspection.checks) {
    lines.push(
      check.ok ? `${check.name}: ok` : `${check.name}: FAIL ${check.error}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function inspectRunningStack({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = HEALTH_TIMEOUT_MS,
} = {}) {
  const path = stackStatePathFromEnv(env);
  const state = await readStackState(path);
  if (!processIsAlive(state.pid)) {
    throw new Error('no running stack found (stack owner pid is not alive)');
  }

  const webOrigin = originFor(state.PORT);
  const coreOrigin = originFor(state.CORE_PORT);
  const checks = [];

  const web = await probe('Web', `${webOrigin}/api/ping`, {
    fetchImpl,
    timeoutMs,
  });
  checks.push(
    web.ok
      ? { name: 'web', ok: true }
      : { error: web.error, name: 'web', ok: false },
  );

  const core = await probe('Core', `${coreOrigin}/health/ready`, {
    fetchImpl,
    timeoutMs,
  });
  if (!core.ok) {
    checks.push({ error: core.error, name: 'core', ok: false });
    checks.push({
      error: 'Core is not ready; worker was not verified.',
      name: 'worker',
      ok: false,
    });
  } else {
    let payload;
    try {
      payload = await core.response.json();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      checks.push({
        error: `Core readiness payload is not JSON: ${message}`,
        name: 'core',
        ok: false,
      });
      checks.push({
        error: 'Core is not ready; worker was not verified.',
        name: 'worker',
        ok: false,
      });
      payload = undefined;
    }
    if (payload) {
      checks.push({ name: 'core', ok: true });
      const worker = workerCheckFromReadyPayload(payload);
      if (!worker) {
        checks.push({
          error: 'Core readiness did not report a worker check.',
          name: 'worker',
          ok: false,
        });
      } else if (worker.status !== 'pass') {
        checks.push({
          error: `Worker returned ${worker.status}${
            worker.detail ? `: ${worker.detail}` : ''
          }.`,
          name: 'worker',
          ok: false,
        });
      } else {
        checks.push({ name: 'worker', ok: true });
      }
    }
  }

  const failures = checks.filter((check) => !check.ok);
  return {
    checks,
    coreOrigin,
    failures,
    ok: failures.length === 0,
    state,
    webOrigin,
  };
}

export async function runRunningStackCli(
  args = process.argv.slice(2),
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    stdout = process.stdout,
  } = {},
) {
  const statusOnly = args.includes('--status');
  const inspection = await inspectRunningStack({ env, fetchImpl });
  stdout.write(formatRunningStackReport(inspection));
  if (!inspection.ok) {
    throw new Error(inspection.failures.map((item) => item.error).join('\n'));
  }
  if (!statusOnly) {
    stdout.write(
      `dev:smoke:running passed: web=${inspection.webOrigin.replace('http://', '')} core=${inspection.coreOrigin.replace('http://', '')} worker=ok\n`,
    );
  }
  return inspection;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runRunningStackCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
