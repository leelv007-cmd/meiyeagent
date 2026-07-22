import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageJsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../package.json',
);

test('Core API and Worker share one package with distinct start commands', () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const start = pkg.scripts?.start ?? '';
  const startWorker = pkg.scripts?.['start:worker'] ?? '';
  const buildRuntime = pkg.scripts?.['build:runtime'] ?? '';

  assert.match(start, /runtime-entry/);
  assert.match(startWorker, /runtime-entry/);
  assert.match(start, /\bapi\b/);
  assert.match(startWorker, /\bworker\b/);
  // Production start must not use the watch-mode TypeScript runner.
  assert.doesNotMatch(start, /tsx watch/);
  assert.doesNotMatch(startWorker, /tsx watch/);
  // Dev scripts may keep tsx watch; production start path is separate.
  assert.ok(buildRuntime.length > 0, 'build:runtime script must exist');
});

test('runtime-entry dispatches only api and worker roles', async () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../runtime-entry.ts'),
    'utf8',
  );
  assert.match(source, /job-worker/);
  assert.match(source, /main\.js/);
  assert.match(source, /Unknown runtime role/);
});
