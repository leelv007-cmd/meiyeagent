import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  findSecretFindings,
  isSecretScanTextPath,
  readSecretScanFiles,
} from './evidence-tools.mjs';

const trackedPaths = execFileSync('git', ['ls-files', '--cached', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const untrackedPaths = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean);
const ignoredEnvironmentPaths = execFileSync(
  'git',
  [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z',
    '--',
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
  ],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean);
const trackedTextPaths = trackedPaths.filter(isSecretScanTextPath).sort();
const worktreeTextPaths = [
  ...new Set([...untrackedPaths, ...ignoredEnvironmentPaths]),
]
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

process.stdout.write(
  `${JSON.stringify({ filesScanned: files.length, findings }, null, 2)}\n`
);
if (findings.length > 0) process.exitCode = 1;
