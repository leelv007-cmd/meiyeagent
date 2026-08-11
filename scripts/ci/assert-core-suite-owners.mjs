import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertCoreSuiteManifest, currentCoreSuiteManifest } from './core-suite-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const corePackagePath = resolve(repositoryRoot, 'apps/core/package.json');
const persistenceRunnerPath = resolve(repositoryRoot, 'scripts/ci/run-core-persistence.sh');

const { contract, manifest } = await currentCoreSuiteManifest();
assertCoreSuiteManifest(manifest, contract);

const [corePackage, persistenceRunner] = await Promise.all([
  readFile(corePackagePath, 'utf8').then(JSON.parse),
  readFile(persistenceRunnerPath, 'utf8'),
]);
const violations = [];

if (corePackage.scripts?.test !== 'node ../../scripts/ci/run-core-suite.mjs --owner core') {
  violations.push(
    'ordinary Core test must run `node ../../scripts/ci/run-core-suite.mjs --owner core`.',
  );
}
if (!persistenceRunner.includes('node scripts/ci/run-core-suite.mjs --owner core-persistence')) {
  violations.push(
    'core-persistence must run `node scripts/ci/run-core-suite.mjs --owner core-persistence`.',
  );
}

if (violations.length > 0) {
  throw new Error(`Core suite owner command contract failed:\n${violations.map((line) => `- ${line}`).join('\n')}`);
}

const counts = Object.fromEntries(
  manifest.suites.map((suite) => [suite.id, suite.files.length]),
);
console.log(
  `Core suite owner contract passed: ${JSON.stringify(counts)}.`,
);
