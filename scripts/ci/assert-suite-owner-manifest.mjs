import {
  assertSuiteOwnerManifest,
  assertSuiteOwnerManifestSources,
  currentSuiteOwnerManifest,
} from './suite-owner-manifest.mjs';

const { contract, manifest } = await currentSuiteOwnerManifest();
assertSuiteOwnerManifest(manifest, contract);
await assertSuiteOwnerManifestSources(manifest);

const commandCount = manifest.suites.reduce(
  (total, suite) => total + suite.commands.length,
  0
);
process.stdout.write(
  `Suite owner manifest passed: ${JSON.stringify({
    suites: manifest.suites.length,
    commands: commandCount,
    categories: contract.requiredCategories,
  })}.\n`
);
