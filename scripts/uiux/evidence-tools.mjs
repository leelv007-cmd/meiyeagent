import { basename, extname } from 'node:path';

export const CORE_SCHEMA_SOURCE_FILES = [
  'apps/core/src/diagnostics/postgres-repository.ts',
  'apps/core/src/p1/cutover/execution-service.ts',
  'apps/core/src/p1/foundation/postgres-repository.ts',
  'apps/core/src/p1/integrations/postgres-repository.ts',
  'apps/core/src/p1/job-runtime/operational-telemetry.ts',
  'apps/core/src/p1/job-runtime/tracer-worker.ts',
  'apps/core/src/p1/model-supply/postgres-repository.ts',
  'apps/core/src/p1/operations/postgres-repository.ts',
  'apps/core/src/postgres-schema-migration.ts',
  'apps/core/src/product/notifier.ts',
  'apps/core/src/product/postgres-repository.ts',
  'apps/core/src/product/relational-product-repository.ts',
];

const TEXT_EXTENSIONS = new Set([
  '.conf',
  '.css',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.properties',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export function isSecretScanTextPath(path) {
  return (
    /^\.env(?:\.|$)/.test(basename(path)) || TEXT_EXTENSIONS.has(extname(path))
  );
}

const SECRET_RULES = [
  {
    rule: 'private-key',
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  },
  { rule: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { rule: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  {
    rule: 'api-key',
    pattern: /\bsk-(?:proj-)?(?![xX]{20,}\b)[A-Za-z0-9_-]{20,}\b/,
    // These are audited literal placeholders and non-provider fixture values.
    // Keep this list exact: files and directories are never blanket-exempted
    // from the secret scanner.
    ignoredLiterals: new Set([
      'sk-your-deepseek-api-key',
      'sk-live-secret-version-one',
      'sk-live-secret-version-two',
    ]),
  },
];

export function findSecretFindings(files) {
  return files.flatMap(({ path, text }) =>
    text
      .split(/\r?\n/)
      .flatMap((line, index) =>
        SECRET_RULES.filter((rule) => hasSecretMatch(line, rule)).map(
          ({ rule }) => ({ path, line: index + 1, rule })
        )
      )
  );
}

function hasSecretMatch(line, { pattern, ignoredLiterals }) {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  const matches = line.matchAll(new RegExp(pattern.source, flags));
  for (const match of matches) {
    if (!ignoredLiterals?.has(match[0])) return true;
  }
  return false;
}

export function readExistingTextFiles(paths, readText) {
  return paths.flatMap((path) => {
    try {
      return [{ path, text: readText(path) }];
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  });
}

export function readSecretScanFiles({
  trackedPaths,
  worktreePaths,
  readIndexText,
  readWorktreeText,
}) {
  const trackedFiles = trackedPaths.map((path) => ({
    path,
    text: readIndexText(path),
  }));
  const worktreeFiles = readExistingTextFiles(worktreePaths, readWorktreeText);

  return [...trackedFiles, ...worktreeFiles].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

export function analyzeBundleEntries(entries) {
  const initialJs = entries.find(({ name }) => /^main-.*\.js$/.test(name));
  const initialCss = entries.find(({ name }) => /^styles-.*\.css$/.test(name));
  if (!initialJs || !initialCss) {
    throw new Error(
      'Expected main JS and styles CSS production bundle entries.'
    );
  }
  const report = {
    initialCssGzipBytes: initialCss.gzipBytes,
    initialJsGzipBytes: initialJs.gzipBytes,
    passed: initialJs.gzipBytes <= 350_000 && initialCss.gzipBytes <= 80_000,
  };
  return report;
}
