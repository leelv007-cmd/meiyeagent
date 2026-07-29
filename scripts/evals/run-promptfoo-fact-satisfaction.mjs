import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
process.exitCode = result.status ?? 1;
