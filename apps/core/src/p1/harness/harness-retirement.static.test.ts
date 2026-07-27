import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const harnessDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessDirectory, '../../../../..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function repositoryFiles(directory: string) {
  return filesUnder(resolve(repositoryRoot, directory))
    .map((file) => relative(repositoryRoot, file))
    .sort();
}

test('core production source cannot resurrect the retired copy bypass or scorer', () => {
  const files = repositoryFiles('apps/core/src')
    .filter((file) => file && !file.endsWith('.test.ts'));
  const forbidden = [
    /p1\/copy\/stream/u,
    /startCreativeCopyStream/u,
    /startCopyStream/u,
    /StructuredCandidateScorer/u,
    /CandidateScorer/u,
    /COPY_SCORING_RUBRIC/u,
    /harness_copy_score_v1/u,
    /OUTPUT_COMPILER_CONTRACTS/u,
    /outputCompilerContract/u,
    /structuredStreamCandidates/u,
    /['"]structured_stream['"]/u,
  ];
  const violations = files.flatMap((file) => {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    return forbidden
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${file}: ${pattern}`);
  });
  assert.deepEqual(violations, []);
});

test('copy production no longer calls scene-policy projection or emits retired capability claims', () => {
  const productionStage = readFileSync(
    resolve(repositoryRoot, 'apps/core/src/p1/harness/production-stage-ports.ts'),
    'utf8',
  );
  assert.doesNotMatch(productionStage, /marketing-scene-policy/u);
  assert.doesNotMatch(productionStage, /projectMarketingPackageEvidence/u);

  const policySources = [
    'apps/core/src/p1/harness/marketing-scene-policy.ts',
    'apps/core/src/p1/harness/copy-marketing-evidence.ts',
  ].map((file) => readFileSync(resolve(repositoryRoot, file), 'utf8'));
  for (const policySource of policySources) {
    assert.doesNotMatch(policySource, /deriveMarketingPackageCapabilities/u);
    assert.doesNotMatch(policySource, /capabilities\s*:/u);
    assert.doesNotMatch(policySource, /quickEdit\s*:\s*true/u);
    assert.doesNotMatch(policySource, /publishExport\s*:\s*true/u);
    assert.doesNotMatch(policySource, /asyncRecovery\s*:\s*true/u);
    assert.doesNotMatch(policySource, /remix\s*:\s*true/u);
  }
  const legacyCallers = repositoryFiles('apps/core/src/p1/harness')
    .filter((file) => file && !file.endsWith('.test.ts'))
    .filter((file) =>
      readFileSync(resolve(repositoryRoot, file), 'utf8').includes(
        'projectMarketingPackageEvidence',
      ),
    )
    .sort();
  assert.deepEqual(legacyCallers, [
    'apps/core/src/p1/harness/marketing-scene-policy.ts',
    'apps/core/src/p1/harness/unified-media-stage-ports.ts',
  ]);
});
