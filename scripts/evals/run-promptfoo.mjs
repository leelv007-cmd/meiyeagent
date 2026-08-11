import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROMPTFOO_VERSION = '0.121.19';

const SUITES = {
  copywriting: {
    assertControlReport: true,
    label: 'Copywriting',
  },
  'fact-satisfaction': {
    assertControlReport: true,
    label: 'Fact-satisfaction',
  },
  'merchant-language': {
    assertControlReport: false,
    label: 'Merchant-language',
  },
  redlines: {
    assertControlReport: false,
    label: 'Redlines',
  },
};

export function createPromptfooRun(suite, argv, repositoryRoot = process.cwd()) {
  const config = SUITES[suite];
  if (!config) {
    throw new Error(
      `Unknown Promptfoo suite '${suite}'. Expected one of: ${Object.keys(SUITES).join(', ')}.`,
    );
  }

  const control = argv.includes('--control');
  const output =
    argv.find((argument) => argument !== '--control') ??
    `output/evals/promptfoo-${suite}${control ? '-control' : ''}.json`;
  const binary = resolve(repositoryRoot, 'node_modules/.bin/promptfoo');
  const command = existsSync(binary) ? binary : 'pnpm';
  const args = [
    ...(command === binary ? [] : ['dlx', `promptfoo@${PROMPTFOO_VERSION}`]),
    'eval',
    '-c',
    `promptfooconfig.${suite}${control ? '.assertion-control' : ''}.yaml`,
    '--no-cache',
    '-o',
    output,
  ];

  return { args, command, config, control, output };
}

export function runPromptfooSuite(suite, argv) {
  const run = createPromptfooRun(suite, argv);
  const result = spawnSync(run.command, run.args, {
    env: {
      ...process.env,
      PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;

  if (!run.control || !run.config.assertControlReport) {
    process.exitCode = result.status ?? 1;
    return;
  }
  if (result.status !== 100) {
    console.error(
      `${run.config.label} control expected Promptfoo exit 100, received ${result.status ?? 'null'}.`,
    );
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(run.output, 'utf8'));
  const stats = report?.results?.stats;
  if (stats?.successes !== 0 || stats?.failures !== 1 || stats?.errors !== 0) {
    console.error(
      `${run.config.label} control expected 0 pass / 1 fail / 0 errors.`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = 100;
}

const directEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === directEntry) {
  const [suite, ...argv] = process.argv.slice(2);
  if (!suite) {
    throw new Error('Promptfoo suite is required.');
  }
  runPromptfooSuite(suite, argv);
}
