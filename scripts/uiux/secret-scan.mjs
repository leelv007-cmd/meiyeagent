import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  findSecretFindings,
  isSecretScanTextPath,
  readSecretScanFiles,
} from './evidence-tools.mjs';

function gitPaths(args, options = {}) {
  const { allowNoMatches = false, ...execOptions } = options;
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      ...execOptions,
    })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    if (allowNoMatches && error.status === 1) return [];
    throw error;
  }
}

function isEnvironmentPath(path) {
  return basename(path).startsWith('.env');
}

const trackedPaths = execFileSync('git', ['ls-files', '--cached', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const untrackedPaths = gitPaths([
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
]);
const ignoredEnvironmentPaths = gitPaths([
  'ls-files',
  '--others',
  '--ignored',
  '--exclude-standard',
  '-z',
  '--',
  ':(glob)**/.env*',
])
  /*
   * `ls-files --others --ignored` collapses a wholly ignored directory to the
   * directory itself instead of descending into it, so `**\/.env*` also reports
   * every vendored mirror under references/ that happens to contain an env file
   * — 22 of them in this repo. Those entries arrive with a trailing slash and
   * are not environment files at all; reading one throws EISDIR and takes the
   * whole gate down. Keep only real env files, which is also the right scope:
   * a wholly ignored directory cannot be in the index, so the contract this
   * list enforces does not apply to anything inside it.
   */
  .filter((path) => !path.endsWith('/') && isEnvironmentPath(path))
  .sort();
const indexedEnvironmentPaths = trackedPaths.filter(isEnvironmentPath);
const indexedIgnoredEnvironmentPaths =
  indexedEnvironmentPaths.length === 0
    ? []
    : gitPaths(
        ['check-ignore', '--no-index', '-z', '--stdin'],
        {
          allowNoMatches: true,
          input: `${indexedEnvironmentPaths.join('\0')}\0`,
        }
      ).sort();

if (indexedIgnoredEnvironmentPaths.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          'Ignored environment files must remain untracked and unstaged; remove these paths from the Git index.',
        indexedIgnoredEnvironmentPaths,
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
}

const trackedTextPaths = trackedPaths.filter(isSecretScanTextPath).sort();
const worktreeTextPaths = untrackedPaths
  .filter(isSecretScanTextPath)
  .sort();
const files = readSecretScanFiles({
  trackedPaths: trackedTextPaths,
  worktreePaths: worktreeTextPaths,
  readIndexText: (path) =>
    execFileSync('git', ['show', `:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  readWorktreeText: (path) => readFileSync(path, 'utf8'),
});
const findings = findSecretFindings(files);
const ignoredEnvironmentFiles = readSecretScanFiles({
  trackedPaths: [],
  worktreePaths: ignoredEnvironmentPaths,
  readIndexText: () => {
    throw new Error(
      'ignored environment files must never be read from the index'
    );
  },
  readWorktreeText: (path) => readFileSync(path, 'utf8'),
});
const ignoredEnvironmentFindings = findSecretFindings(ignoredEnvironmentFiles);

process.stdout.write(
  `${JSON.stringify(
    {
      filesScanned: files.length,
      findings,
      ignoredEnvironment: {
        status: 'informational',
        paths: ignoredEnvironmentPaths,
        findings: ignoredEnvironmentFindings,
      },
    },
    null,
    2
  )}\n`
);
if (findings.length > 0) process.exitCode = 1;
