import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function spawnDatabaseProvision(
  profile,
  {
    cwd = repoRoot,
    scriptPath = './scripts/ci/provision-test-db.sh',
    stdio = 'inherit',
  } = {},
) {
  return spawn(scriptPath, [], {
    cwd,
    env: {
      ...process.env,
      ...profile,
      TEST_DATABASE_URL: profile.DATABASE_URL,
      TEST_DBOS_SYSTEM_DATABASE_URL: profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    },
    stdio,
  });
}
