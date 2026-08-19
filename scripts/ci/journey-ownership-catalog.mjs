import { execFileSync } from 'node:child_process';
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
  const files = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter(Boolean);
  return {
    playwright: files.filter((file) =>
      /^mkfast-template-main\/tests\/e2e\/specs\/.*\.spec\.tsx?$/u.test(file)
    ),
    persistence: files.filter((file) =>
      /\.(?:postgres|smoke)\.test\.(?:ts|mts)$/u.test(file)
    ),
  };
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command !== 'validate') {
    throw new Error(
      'Usage: node journey-ownership-catalog.mjs validate [--catalog path] [--inventory path] [--results path] [--output path]'
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
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
