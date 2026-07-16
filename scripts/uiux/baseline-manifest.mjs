import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CORE_SCHEMA_SOURCE_FILES } from './evidence-tools.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const marker = process.argv.indexOf('--pre-cutover');
const requestedRef = marker >= 0 ? process.argv[marker + 1] : undefined;
if (!requestedRef) throw new Error('--pre-cutover <git-ref> is required.');
const preCutoverCommit = git('rev-parse', '--verify', `${requestedRef}^{commit}`);
const drizzleSchemaFiles = git('ls-files', 'mkfast-template-main/drizzle/*.sql')
  .split('\n')
  .filter(Boolean);
const schemaFiles = [...CORE_SCHEMA_SOURCE_FILES, ...drizzleSchemaFiles].sort();
const schemaRevision = createHash('sha256')
  .update(
    schemaFiles
      .map((path) => `${path}\0${readFileSync(path)}`)
      .join('\0')
  )
  .digest('hex');
const routesRoot = join('mkfast-template-main', 'src', 'routes');
const routes = filesUnder(routesRoot)
  .filter((path) => /\.(?:ts|tsx)$/.test(path))
  .map((path) => relative(routesRoot, path))
  .sort();
const runtimeVariables = [
  'AI_DIAGNOSTIC_RUNTIME',
  'MODEL_SUPPLY_RUNTIME_MODE',
  'NODE_ENV',
  'P1_JOB_RUNTIME',
  'P1_REPOSITORY_MODE',
  'VIDEO_PROVIDER_MODE',
];

process.stdout.write(
  `${JSON.stringify(
    {
      currentCommit: git('rev-parse', 'HEAD'),
      nodeVersion: process.version,
      packageManager: JSON.parse(readFileSync('package.json', 'utf8'))
        .packageManager,
      preCutoverCommit,
      routes,
      runtimeModes: Object.fromEntries(
        runtimeVariables.map((name) => [name, process.env[name] ?? 'not-set'])
      ),
      schemaFiles,
      schemaRevision,
    },
    null,
    2
  )}\n`
);
