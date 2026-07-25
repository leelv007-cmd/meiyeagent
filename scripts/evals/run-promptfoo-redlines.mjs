import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const binary = resolve('node_modules/.bin/promptfoo');
const output = process.argv[2] ?? 'output/evals/promptfoo-redlines.json';
const command = existsSync(binary) ? binary : 'pnpm';
const args = [
  ...(command === binary ? [] : ['dlx', 'promptfoo@0.121.19']),
  'eval',
  '-c',
  'promptfooconfig.redlines.yaml',
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
