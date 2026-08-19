import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL('../..', import.meta.url);
const contractUrl = new URL('./core-suite-owner-contract.json', import.meta.url);

export async function loadCoreSuiteOwnerContract() {
  const contract = JSON.parse(await readFile(contractUrl, 'utf8'));
  assertValidContract(contract);
  return contract;
}

export async function readWorkspaceCoreTestFiles() {
  const repositoryPath = fileURLToPath(repositoryRoot);
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      repositoryPath,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'apps/core/src/**/*.test.ts',
    ],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  );

  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function buildCoreSuiteManifest({ trackedFiles, contract }) {
  assertValidContract(contract);

  const normalizedFiles = [...trackedFiles].sort((left, right) =>
    left.localeCompare(right),
  );
  const suites = contract.classifications.map(({ category, owner }) => ({
    id: `${owner}-${category}`,
    owner,
    category,
    files: [],
  }));

  for (const file of normalizedFiles) {
    const classification = classifyCoreTestFile(file, contract);
    const suite = suites.find(
      (candidate) =>
        candidate.owner === classification.owner &&
        candidate.category === classification.category,
    );
    if (!suite) {
      throw new Error(
        `No suite is registered for ${classification.owner}/${classification.category}.`,
      );
    }
    suite.files.push(file);
  }

  const manifest = {
    schemaVersion: 1,
    source:
      'git ls-files --cached --others --exclude-standard apps/core/src/**/*.test.ts',
    workspaceFiles: normalizedFiles,
    // Keep this alias for the existing persistence artifact consumers while
    // making the discovery source explicit about non-ignored worktree files.
    trackedFiles: normalizedFiles,
    suites,
  };
  assertCoreSuiteManifest(manifest, contract);
  return manifest;
}

export function classifyCoreTestFile(file, contract) {
  if (!file.startsWith(contract.trackedPathPrefix) || !file.endsWith('.test.ts')) {
    throw new Error(`Tracked Core test path is outside the suite contract: ${file}`);
  }

  const explicitClassification = contract.classifications.find(
    ({ explicitFiles = [] }) => explicitFiles.includes(file),
  );
  if (explicitClassification) return explicitClassification;

  const classification = contract.classifications.find(
    ({ suffixes }) =>
      suffixes.length === 0 || suffixes.some((suffix) => file.endsWith(suffix)),
  );
  if (!classification) {
    throw new Error(`No Core suite classification matches ${file}.`);
  }
  return classification;
}

export function assertCoreSuiteManifest(manifest, contract) {
  const violations = coreSuiteManifestViolations(manifest, contract);
  if (violations.length > 0) {
    throw new Error(
      `Core suite owner contract failed:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}`,
    );
  }
}

export function coreSuiteManifestViolations(manifest, contract) {
  const violations = [];
  const workspaceFiles = manifest?.workspaceFiles ?? manifest?.trackedFiles ?? [];
  const suites = manifest?.suites ?? [];
  const workspaceSet = new Set(workspaceFiles);
  const expectedFiles = new Set(workspaceFiles);
  const ownersByFile = new Map();

  const duplicateWorkspaceFiles = duplicateValues(workspaceFiles);
  if (duplicateWorkspaceFiles.length > 0) {
    violations.push(
      `duplicate workspace files:\n${formatPaths(duplicateWorkspaceFiles)}`,
    );
  }

  for (const suite of suites) {
    for (const file of suite.files ?? []) {
      const entries = ownersByFile.get(file) ?? [];
      entries.push(`${suite.owner}/${suite.category}`);
      ownersByFile.set(file, entries);
    }
  }

  const missing = [...expectedFiles].filter((file) => !ownersByFile.has(file));
  if (missing.length > 0) {
    violations.push(`missing owners:\n${formatPaths(missing)}`);
  }

  const duplicate = [...ownersByFile]
    .filter(([, entries]) => entries.length > 1)
    .map(([file, entries]) => `${file} (${entries.join(', ')})`);
  if (duplicate.length > 0) {
    violations.push(`duplicate owners:\n${formatPaths(duplicate)}`);
  }

  const orphan = [...ownersByFile]
    .filter(([file]) => !workspaceSet.has(file))
    .map(([file, entries]) => `${file} (${entries.join(', ')})`);
  if (orphan.length > 0) {
    violations.push(`orphan suite entries:\n${formatPaths(orphan)}`);
  }

  const wrongOwner = [];
  for (const [file, entries] of ownersByFile) {
    if (!workspaceSet.has(file) || entries.length !== 1) continue;
    const expected = classifyCoreTestFile(file, contract);
    if (entries[0] !== `${expected.owner}/${expected.category}`) {
      wrongOwner.push(
        `${file} (expected ${expected.owner}/${expected.category}, got ${entries[0]})`,
      );
    }
  }
  if (wrongOwner.length > 0) {
    violations.push(`wrong owners:\n${formatPaths(wrongOwner)}`);
  }

  for (const classification of contract.classifications) {
    const suite = suites.find(
      (candidate) =>
        candidate.owner === classification.owner &&
        candidate.category === classification.category,
    );
    if (!suite) {
      violations.push(
        `missing suite registration: ${classification.owner}/${classification.category}`,
      );
    } else if (suite.files.length === 0) {
      violations.push(
        `missing workspace ${classification.category} suite files for ${classification.owner}.`,
      );
    }
  }

  return violations;
}

export function filesForOwner(manifest, owner) {
  const files = manifest.suites
    .filter((suite) => suite.owner === owner)
    .flatMap((suite) => suite.files)
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`Core suite owner ${owner} has no workspace test files.`);
  }
  return files;
}

export async function currentCoreSuiteManifest() {
  const [contract, workspaceFiles] = await Promise.all([
    loadCoreSuiteOwnerContract(),
    readWorkspaceCoreTestFiles(),
  ]);
  return {
    contract,
    manifest: buildCoreSuiteManifest({ trackedFiles: workspaceFiles, contract }),
  };
}

function assertValidContract(contract) {
  if (contract?.schemaVersion !== 1) {
    throw new Error('Core suite owner contract must use schemaVersion 1.');
  }
  if (!contract.trackedPathPrefix || !Array.isArray(contract.classifications)) {
    throw new Error('Core suite owner contract is missing its tracked path or classifications.');
  }
  for (const classification of contract.classifications) {
    if (
      !classification.owner ||
      !classification.category ||
      !Array.isArray(classification.suffixes) ||
      (classification.explicitFiles !== undefined &&
        !Array.isArray(classification.explicitFiles))
    ) {
      throw new Error('Every Core suite classification needs owner, category, and suffixes.');
    }
  }
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

function formatPaths(paths) {
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => `  ${path}`)
    .join('\n');
}

async function main() {
  const { contract, manifest } = await currentCoreSuiteManifest();
  const arguments_ = process.argv.slice(2);
  const owner = argumentValue(arguments_, '--owner');
  const outputPath = argumentValue(arguments_, '--write');
  const format = argumentValue(arguments_, '--format') ?? 'json';

  const output = owner
    ? {
        ...manifest,
        suites: manifest.suites.filter((suite) => suite.owner === owner),
      }
    : manifest;
  assertCoreSuiteManifest(manifest, contract);
  if (owner) filesForOwner(manifest, owner);

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized);
  if (format === 'json') {
    process.stdout.write(serialized);
    return;
  }
  if (format === 'paths') {
    process.stdout.write(`${filesForOwner(manifest, owner)}\n`);
    return;
  }
  throw new Error(`Unsupported Core suite manifest format: ${format}`);
}

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

if (import.meta.main) await main();
