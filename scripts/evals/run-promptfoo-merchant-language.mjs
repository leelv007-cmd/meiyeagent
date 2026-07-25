import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const binary = resolve('node_modules/.bin/promptfoo');
if (!existsSync(binary)) {
  console.error(
    'promptfoo 0.121.19 is not installed. Install the pinned dev dependency when registry access is available; the provider tests remain runnable with pnpm --filter @meiye/core eval:merchant-language.',
  );
  process.exitCode = 2;
} else {
  const output =
    process.argv[2] ?? 'output/evals/promptfoo-merchant-language.json';
  const result = spawnSync(
    binary,
    [
      'eval',
      '-c',
      'promptfooconfig.merchant-language.yaml',
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
