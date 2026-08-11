import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifestUrl = new URL('./suite-owner-manifest.json', import.meta.url);

export async function loadSuiteOwnerManifest() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assertValidSuiteOwnerManifest(manifest);
  return manifest;
}

export async function currentSuiteOwnerManifest() {
  const manifest = await loadSuiteOwnerManifest();
  return { contract: manifest, manifest };
}

export function assertSuiteOwnerManifest(manifest, contract = manifest) {
  const violations = suiteOwnerManifestViolations(manifest, contract);
  if (violations.length > 0) {
    throw new Error(
      `Suite owner manifest contract failed:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}`
    );
  }
}

export async function assertSuiteOwnerManifestSources(
  manifest,
  repository = repositoryRoot
) {
  const violations = await suiteOwnerManifestSourceViolations(
    manifest,
    repository
  );
  if (violations.length > 0) {
    throw new Error(
      `Suite owner manifest source contract failed:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}`
    );
  }
}

export async function suiteOwnerManifestSourceViolations(
  manifest,
  repository = repositoryRoot
) {
  const violations = [];
  for (const suite of manifest?.suites ?? []) {
    for (const command of suite.commands ?? []) {
      for (const reference of command.references ?? []) {
        if (
          typeof reference?.path !== 'string' ||
          typeof reference?.contains !== 'string' ||
          reference.contains.length === 0
        ) {
          violations.push(
            `${suite.id}/${command.id} has an invalid source reference`
          );
          continue;
        }

        const target = resolve(repository, reference.path);
        const escaped =
          isAbsolute(reference.path) ||
          (relative(repository, target) !== '' &&
            (relative(repository, target).startsWith(
              `..${requirePathSeparator()}`
            ) ||
              relative(repository, target) === '..'));
        if (escaped) {
          violations.push(
            `${suite.id}/${command.id} source reference escapes the repository: ${reference.path}`
          );
          continue;
        }

        let source;
        try {
          source = await readFile(target, 'utf8');
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          violations.push(
            `${suite.id}/${command.id} source is unreadable ${reference.path}: ${detail}`
          );
          continue;
        }
        if (!source.includes(reference.contains)) {
          violations.push(
            `${suite.id}/${command.id} source ${reference.path} does not contain ${JSON.stringify(reference.contains)}`
          );
        }
      }
    }
  }
  return violations;
}

export function suiteOwnerManifestViolations(manifest, contract = manifest) {
  const violations = [];
  if (manifest?.schemaVersion !== 1) {
    violations.push('manifest schemaVersion must be 1');
  }
  if (contract?.schemaVersion !== 1) {
    violations.push('contract schemaVersion must be 1');
  }

  const requiredCategories = Array.isArray(contract?.requiredCategories)
    ? contract.requiredCategories
    : [];
  const aggregateCategories = Array.isArray(contract?.aggregateCategories)
    ? contract.aggregateCategories
    : [];
  const allowedCategories = new Set([
    ...requiredCategories,
    ...aggregateCategories,
  ]);
  if (requiredCategories.length === 0) {
    violations.push('requiredCategories must not be empty');
  }
  const duplicateCategories = duplicateValues(requiredCategories);
  if (duplicateCategories.length > 0) {
    violations.push(
      `duplicate required categories: ${duplicateCategories.join(', ')}`
    );
  }
  const duplicateAggregateCategories = duplicateValues(aggregateCategories);
  if (duplicateAggregateCategories.length > 0) {
    violations.push(
      `duplicate aggregate categories: ${duplicateAggregateCategories.join(', ')}`
    );
  }
  const overlappingCategories = aggregateCategories.filter((category) =>
    requiredCategories.includes(category)
  );
  if (overlappingCategories.length > 0) {
    violations.push(
      `aggregate categories overlap required categories: ${overlappingCategories.join(', ')}`
    );
  }

  const suites = Array.isArray(manifest?.suites) ? manifest.suites : [];
  const suiteIds = suites.map((suite) => suite?.id).filter(Boolean);
  const duplicateSuiteIds = duplicateValues(suiteIds);
  if (duplicateSuiteIds.length > 0) {
    violations.push(`duplicate suite ids: ${duplicateSuiteIds.join(', ')}`);
  }

  const coveredCategories = new Set();
  const commandIds = new Map();
  const commandRuns = new Map();
  const ownersBySuite = new Map();

  for (const suite of suites) {
    if (!suite || typeof suite !== 'object') {
      violations.push('every suite must be an object');
      continue;
    }
    if (typeof suite.id !== 'string' || suite.id.length === 0) {
      violations.push('every suite needs a non-empty id');
    }
    if (
      typeof suite.requiredOwner !== 'string' ||
      suite.requiredOwner.length === 0
    ) {
      violations.push(
        `${suite.id ?? '<unknown suite>'} must declare exactly one requiredOwner`
      );
    } else {
      const prior = ownersBySuite.get(suite.requiredOwner);
      if (prior) {
        violations.push(
          `duplicate required owners: ${suite.requiredOwner} (${prior}, ${suite.id})`
        );
      } else {
        ownersBySuite.set(suite.requiredOwner, suite.id);
      }
    }
    if (Object.hasOwn(suite, 'requiredOwners')) {
      violations.push(
        `${suite.id ?? '<unknown suite>'} must not declare requiredOwners; use one requiredOwner`
      );
    }

    const categories = Array.isArray(suite.categories) ? suite.categories : [];
    if (categories.length === 0) {
      violations.push(
        `${suite.id ?? '<unknown suite>'} must declare categories`
      );
    }
    for (const category of categories) {
      if (typeof category !== 'string' || category.length === 0) {
        violations.push(
          `${suite.id ?? '<unknown suite>'} has an invalid category`
        );
        continue;
      }
      coveredCategories.add(category);
      if (!allowedCategories.has(category)) {
        violations.push(
          `${suite.id ?? '<unknown suite>'} declares unknown category ${category}`
        );
      }
    }

    const commands = Array.isArray(suite.commands) ? suite.commands : [];
    if (commands.length === 0) {
      violations.push(`${suite.id ?? '<unknown suite>'} must declare commands`);
    }
    for (const command of commands) {
      if (!command || typeof command !== 'object') {
        violations.push(
          `${suite.id ?? '<unknown suite>'} has an invalid command`
        );
        continue;
      }
      const commandId = command.id;
      const run = command.run;
      if (typeof commandId !== 'string' || commandId.length === 0) {
        violations.push(
          `${suite.id ?? '<unknown suite>'} command needs a non-empty id`
        );
      } else {
        const prior = commandIds.get(commandId);
        if (prior) {
          violations.push(
            `duplicate command registrations: ${commandId} (${prior}, ${suite.id})`
          );
        } else {
          commandIds.set(commandId, suite.id);
        }
      }
      if (typeof run !== 'string' || run.length === 0) {
        violations.push(
          `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} needs a non-empty run command`
        );
      } else {
        const prior = commandRuns.get(run);
        if (prior) {
          violations.push(
            `duplicate command registrations: ${JSON.stringify(run)} (${prior}, ${suite.id})`
          );
        } else {
          commandRuns.set(run, suite.id);
        }
      }
      if (
        !Array.isArray(command.references) ||
        command.references.length === 0
      ) {
        violations.push(
          `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} needs source references`
        );
      }

      if (command.kind === 'aggregate') {
        const commandCategories = Array.isArray(command.categories)
          ? command.categories
          : [];
        if (commandCategories.length === 0) {
          violations.push(
            `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} aggregate command needs aggregate categories`
          );
        }
        for (const category of commandCategories) {
          if (!aggregateCategories.includes(category)) {
            violations.push(
              `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} aggregate command cannot claim required/unknown category ${category}`
            );
          }
        }
        if (
          !Array.isArray(command.aggregateOf) ||
          command.aggregateOf.length === 0
        ) {
          violations.push(
            `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} aggregate command needs explicit aggregateOf coverage`
          );
        } else {
          const nestedIds = new Set();
          for (const nested of command.aggregateOf) {
            if (
              !nested ||
              typeof nested.id !== 'string' ||
              nested.id.length === 0 ||
              typeof nested.owner !== 'string' ||
              nested.owner.length === 0 ||
              typeof nested.category !== 'string' ||
              nested.category.length === 0 ||
              typeof nested.run !== 'string' ||
              nested.run.length === 0
            ) {
              violations.push(
                `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} aggregateOf entries need id, owner, category, and run`
              );
              continue;
            }
            if (nestedIds.has(nested.id)) {
              violations.push(
                `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} aggregateOf duplicates ${nested.id}`
              );
            }
            nestedIds.add(nested.id);
          }
        }
      } else if (Object.hasOwn(command, 'aggregateOf')) {
        violations.push(
          `${suite.id ?? '<unknown suite>'}/${commandId ?? '<unknown command>'} declares aggregateOf without kind=aggregate`
        );
      }
    }
  }

  const missingCategories = requiredCategories.filter(
    (category) => !coveredCategories.has(category)
  );
  if (missingCategories.length > 0) {
    violations.push(
      `missing required categories: ${missingCategories.join(', ')}`
    );
  }

  return violations;
}

export function assertValidSuiteOwnerManifest(manifest) {
  const violations = suiteOwnerManifestViolations(manifest, manifest);
  if (violations.length > 0) {
    throw new Error(
      `Invalid suite owner manifest:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}`
    );
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

function requirePathSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

if (import.meta.main) {
  const { contract, manifest } = await currentSuiteOwnerManifest();
  assertSuiteOwnerManifest(manifest, contract);
  await assertSuiteOwnerManifestSources(manifest);
  const suites = manifest.suites.length;
  const commands = manifest.suites.reduce(
    (total, suite) => total + suite.commands.length,
    0
  );
  process.stdout.write(
    `Suite owner manifest passed: ${JSON.stringify({ suites, commands, categories: contract.requiredCategories })}.\n`
  );
}
