import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const binary = resolve('node_modules/.bin/promptfoo');
const control = process.argv.includes('--control');
const output =
  process.argv.find((argument, index) => index > 1 && argument !== '--control') ??
  (control
    ? 'output/evals/promptfoo-fact-satisfaction-control.json'
    : 'output/evals/promptfoo-fact-satisfaction.json');
const command = existsSync(binary) ? binary : 'pnpm';
const args = [
  ...(command === binary ? [] : ['dlx', 'promptfoo@0.121.19']),
  'eval',
  '-c',
  control
    ? 'promptfooconfig.fact-satisfaction.assertion-control.yaml'
    : 'promptfooconfig.fact-satisfaction.yaml',
  '--no-cache',
  '-o',
  output,
];
const result = spawnSync(command, args, {
  env: {
    ...process.env,
    PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (control) {
  if (result.status !== 100) {
    console.error(
      `Fact-satisfaction control expected Promptfoo exit 100, received ${result.status ?? 'null'}.`,
    );
    process.exitCode = 1;
  } else {
    const report = JSON.parse(readFileSync(output, 'utf8'));
    const stats = report?.results?.stats;
    if (
      stats?.successes !== 0 ||
      stats?.failures !== 1 ||
      stats?.errors !== 0
    ) {
      console.error(
        'Fact-satisfaction control expected 0 pass / 1 fail / 0 errors.',
      );
      process.exitCode = 1;
    } else {
      process.exitCode = 100;
    }
  }
} else {
  process.exitCode = result.status ?? 1;
}
