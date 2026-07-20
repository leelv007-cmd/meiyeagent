import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const binary = resolve('node_modules/.bin/promptfoo');
if (!existsSync(binary)) {
  console.error(
    'promptfoo 0.121.19 is not installed. Install the pinned dev dependency when registry access is available; recorded provider/parity tests remain runnable with pnpm --filter @meiye/core eval:redlines.',
  );
  process.exitCode = 2;
} else {
  const output = process.argv[2] ?? 'output/evals/promptfoo-redlines.json';
  const result = spawnSync(
    binary,
    [
      'eval',
      '-c',
      'promptfooconfig.redlines.yaml',
      '--no-cache',
      '-o',
      output,
    ],
    {
      env: {
        ...process.env,
        PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
      },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
