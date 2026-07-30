import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const instrumentationUrl = new URL('./instrumentation.ts', import.meta.url).href;

test('Langfuse tracing stays disabled without complete credentials', async () => {
  const { stdout } = await runInstrumentation({
    LANGFUSE_BASE_URL: '',
    LANGFUSE_PUBLIC_KEY: '',
    LANGFUSE_SECRET_KEY: '',
  });

  assert.equal(stdout.trim(), 'disabled');
});

test('Langfuse tracing starts only when all credentials are configured', async () => {
  const { stdout } = await runInstrumentation({
    LANGFUSE_BASE_URL: 'http://127.0.0.1:1',
    LANGFUSE_PUBLIC_KEY: 'pk-test',
    LANGFUSE_SECRET_KEY: 'sk-test',
  });

  assert.equal(stdout.trim(), 'enabled');
});

function runInstrumentation(env: NodeJS.ProcessEnv) {
  const script = `
    const tracing = await import(${JSON.stringify(instrumentationUrl)});
    await tracing.flushLangfuseTracing();
    await tracing.shutdownLangfuseTracing();
    console.log(tracing.langfuseTracingEnabled ? 'enabled' : 'disabled');
  `;
  return execFileAsync(process.execPath, ['--import', 'tsx', '--eval', script], {
    env: { ...process.env, ...env },
  });
}
