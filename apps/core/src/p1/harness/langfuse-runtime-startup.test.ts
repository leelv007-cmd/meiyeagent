import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const entry of ['src/main.ts', 'src/job-worker.ts']) {
  test(`${entry} applies strict Langfuse prompt policy before runtime startup`, () => {
    const result = start(entry, 'strict');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Strict Langfuse prompt policy requires/u);
    assert.doesNotMatch(result.stderr, /DATABASE_URL is required/u);
  });

  test(`${entry} permits missing Langfuse configuration only in explicit pilot mode`, () => {
    const result = start(entry, 'pilot');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_URL is required/u);
    assert.doesNotMatch(result.stderr, /Strict Langfuse prompt policy requires/u);
  });
}

function start(entry: string, policy: 'pilot' | 'strict') {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LANGFUSE_PROMPT_POLICY: policy,
  };
  delete env.DATABASE_URL;
  delete env.LANGFUSE_BASE_URL;
  delete env.LANGFUSE_PUBLIC_KEY;
  delete env.LANGFUSE_SECRET_KEY;
  delete env.LANGFUSE_PROMPT_VERSIONS;
  return spawnSync(process.execPath, ['--import', 'tsx', entry], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
    env,
  });
}
