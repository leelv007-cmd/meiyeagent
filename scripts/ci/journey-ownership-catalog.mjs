import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultCatalogPath = fileURLToPath(
  new URL('./journey-ownership-catalog.json', import.meta.url)
);
const decisions = new Set([
  'blocking',
  'advisory',
  'instrument',
  'full_rc_local',
  'known_red',
  'retired',
  'superseded',
]);

export function catalogViolations(catalog, inventory) {
  const violations = [];
  if (catalog?.schemaVersion !== 'journey-ownership/v1') {
    violations.push('catalog schemaVersion must be journey-ownership/v1');
  }
  const entries = resolveCatalogEntries(catalog);
  for (const file of inventory?.unregisteredPersistence ?? []) {
    violations.push(`opt-in suite is missing canonical evidence: ${file}`);
  }
  const inventoryPaths = [
    ...(inventory?.playwright ?? []),
    ...(inventory?.persistence ?? []),
  ];
  const expectedKind = new Map([
    ...(inventory?.playwright ?? []).map((file) => [file, 'playwright']),
    ...(inventory?.persistence ?? []).map((file) => [file, 'persistence']),
  ]);
  const seen = new Set();

  for (const entry of entries) {
    const file = entry?.path;
    if (typeof file !== 'string' || file.length === 0) {
      violations.push('every catalog entry requires a path');
      continue;
    }
    if (seen.has(file)) violations.push(`duplicate catalog entry: ${file}`);
    seen.add(file);
    if (!expectedKind.has(file))
      violations.push(`catalog entry is not in inventory: ${file}`);
    if (expectedKind.has(file) && entry.kind !== expectedKind.get(file)) {
      violations.push(`${file} must use kind ${expectedKind.get(file)}`);
    }
    for (const field of [
      'owner',
      'tier',
      'env',
      'currentDecision',
      'allowedSkip',
      'artifact',
      'producer',
    ]) {
      if (!Object.hasOwn(entry, field))
        violations.push(`${file} lacks ${field}`);
    }
    if (!decisions.has(entry.currentDecision)) {
      violations.push(
        `${file} has unsupported currentDecision ${entry.currentDecision}`
      );
    }
    if (typeof entry.allowedSkip !== 'boolean') {
      violations.push(`${file} allowedSkip must be boolean`);
    }
    if (typeof entry.producer !== 'string' || entry.producer.length === 0) {
      violations.push(`${file} requires a real producer`);
    } else if (
      Array.isArray(inventory?.trackedFiles) &&
      !inventory.trackedFiles.includes(entry.producer)
    ) {
      violations.push(`${file} producer is not tracked: ${entry.producer}`);
    }
    if (
      Object.hasOwn(entry, 'provisionStrategy') &&
      entry.provisionStrategy !== 'issue-255-safe-provision/v1'
    ) {
      violations.push(`${file} has an unsupported provisionStrategy`);
    }
    if (
      entry.kind === 'playwright' &&
      entry.tier === 'full-rc-local' &&
      entry.currentDecision !== 'instrument'
    ) {
      if (entry.artifact !== null) {
        violations.push(
          `${file} full-RC-local entry must not fake an artifact`
        );
      }
    } else if (
      typeof entry.artifact !== 'string' ||
      entry.artifact.length === 0
    ) {
      violations.push(`${file} requires a real artifact path`);
    }
    if (entry.currentDecision === 'known_red') {
      violations.push(
        `${file}: blocking entries cannot be known_red; use an owned advisory/instrument decision`
      );
    }
    if (['advisory', 'instrument'].includes(entry.currentDecision)) {
      if (!entry.owner || !entry.ticket) {
        violations.push(
          `${file}: ${entry.currentDecision} entry requires both owner and ticket`
        );
      }
    }
  }

  for (const file of inventoryPaths) {
    if (!seen.has(file)) violations.push(`unowned inventory file: ${file}`);
  }
  return violations;
}

export function resolveCatalogEntries(catalog) {
  if (Array.isArray(catalog?.entries)) return catalog.entries;
  const overrides = new Map(
    (catalog?.overrides ?? []).map((override) => [override.path, override])
  );
  return (catalog?.collections ?? []).flatMap((collection) =>
    (collection.files ?? []).map((file) => ({
      path: file,
      kind: collection.kind,
      ...collection.defaults,
      ...(overrides.get(file) ?? {}),
    }))
  );
}

export function evaluateReleaseVerdict(entries, results = {}) {
  const blocking = entries.filter(
    (entry) => entry.currentDecision === 'blocking'
  );
  if (blocking.length === 0) return 'not_evaluated';
  const statuses = blocking.map((entry) => results[entry.path]);
  if (statuses.some((status) => status === 'fail')) return 'fail';
  if (statuses.every((status) => status === 'pass')) return 'pass';
  return 'not_evaluated';
}

export function repositoryInventory(cwd = process.cwd()) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd, encoding: 'utf8' }
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  const evidence = JSON.parse(
    readFileSync(path.join(cwd, 'docs/ops/opt-in-test-evidence.json'), 'utf8')
  );
  const coreSuiteContract = JSON.parse(
    readFileSync(
      path.join(cwd, 'scripts/ci/core-suite-owner-contract.json'),
      'utf8'
    )
  );
  const tracked = new Set(files);
  const canonicalPersistence = Object.keys(evidence.suites ?? {})
    .filter((file) => tracked.has(file))
    .sort((left, right) => left.localeCompare(right));
  const canonicalSet = new Set(canonicalPersistence);
  const discoveredPersistence = [
    ...new Set([
      ...files.filter((file) =>
        /\.(?:postgres|smoke)\.test\.(?:ts|mts)$/u.test(file)
      ),
      ...coreSuiteContract.classifications.flatMap(
        (classification) => classification.explicitFiles ?? []
      ),
    ]),
  ];
  return {
    trackedFiles: files,
    playwright: files.filter((file) =>
      /^mkfast-template-main\/tests\/e2e\/specs\/.*\.spec\.tsx?$/u.test(file)
    ),
    persistence: canonicalPersistence,
    unregisteredPersistence: discoveredPersistence.filter(
      (file) => !canonicalSet.has(file)
    ),
  };
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!['validate', 'list-playwright'].includes(command)) {
    throw new Error(
      'Usage: node journey-ownership-catalog.mjs <validate|list-playwright> [options]'
    );
  }
  const catalogPath =
    argumentValue(arguments_, '--catalog') ?? defaultCatalogPath;
  const inventoryPath = argumentValue(arguments_, '--inventory');
  const resultsPath = argumentValue(arguments_, '--results');
  const outputPath = argumentValue(arguments_, '--output');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const inventory = inventoryPath
    ? JSON.parse(await readFile(inventoryPath, 'utf8'))
    : repositoryInventory();
  const results = resultsPath
    ? JSON.parse(await readFile(resultsPath, 'utf8'))
    : {};
  const violations = catalogViolations(catalog, inventory);
  if (violations.length > 0) {
    throw new Error(
      `Journey ownership catalog is invalid:\n- ${violations.join('\n- ')}`
    );
  }
  const entries = resolveCatalogEntries(catalog);
  if (command === 'list-playwright') {
    const purpose = rawArgumentValue(arguments_, '--purpose');
    if (purpose !== 'release-verdict') {
      throw new Error('--purpose release-verdict is required');
    }
    const prefix = 'mkfast-template-main/';
    const files = entries
      .filter(
        (entry) =>
          entry.kind === 'playwright' &&
          ['blocking', 'advisory', 'full_rc_local'].includes(
            entry.currentDecision
          )
      )
      .map((entry) =>
        arguments_.includes('--relative-web') && entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path
      );
    process.stdout.write(`${files.join('\n')}\n`);
    return;
  }
  const output = {
    schemaVersion: 'journey-ownership-validation/v1',
    inventory: {
      playwright: inventory.playwright.length,
      persistence: inventory.persistence.length,
    },
    releaseVerdict: evaluateReleaseVerdict(entries, results),
    entries,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function argumentValue(arguments_, name) {
  const value = rawArgumentValue(arguments_, name);
  return value ? path.resolve(value) : undefined;
}

function rawArgumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
