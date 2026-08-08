/**
 * V31-19 constructive check: OutcomeEvidence has one canonical writer.
 *
 * Physical store = ContentPackage.resultSignals via
 * ContentPackageDeliveryService.recordResultSignal (manual outcome contract).
 * result ledger / observability may only project — never dual-write.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AGENT_CANONICAL_OWNERSHIP_MATRIX,
  findDuplicateSemanticFactWriters,
} from '@meiye/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');

function childSourceRoots(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'src'))
    .filter((path) => existsSync(path));
}

const productionSourceRoots = [
  ...childSourceRoots(join(repositoryRoot, 'apps')),
  ...childSourceRoots(join(repositoryRoot, 'packages')),
  join(repositoryRoot, 'mkfast-template-main/src'),
];

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) =>
      existsSync(root) ? productionTypescriptFiles(root) : [],
    )
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

test('ownership matrix assigns OutcomeEvidence to a single writer', () => {
  assert.deepEqual(findDuplicateSemanticFactWriters(), []);
  const entry = AGENT_CANONICAL_OWNERSHIP_MATRIX.find(
    (row) => row.semanticFact === 'outcome_evidence',
  );
  assert.ok(entry);
  assert.equal(entry.writer, 'OutcomeEvidenceManualContract');
});

test('resultSignals semantic appends stay on the manual outcome delivery writer', () => {
  // Canonical write = recordResultSignal on ContentPackageDeliveryService.
  // Match the append shape used by the sole writer (spread prior ledger + row).
  const writers = filesMatching(
    /resultSignals:\s*\[\s*\.\.\.(?:current\.resultSignals|existing)/u,
  );
  assert.deepEqual(writers, [
    'apps/core/src/p1/operations/content-package-delivery.ts',
  ]);
});

test('result ledger and observability do not call recordResultSignal', () => {
  // Production callers of the write method: implementation + command router.
  const callers = filesMatching(/recordResultSignal\s*\(/u).filter(
    (path) => !path.includes('.test.'),
  );
  assert.deepEqual(callers, [
    'apps/core/src/p1/operations/content-package-delivery.ts',
    'apps/core/src/p1/operations/foundation-module.ts',
    // V31-17 merchant self-report goes through the canonical writer (exact
    // revision OCC) — a caller of the API, not a second writer.
    'apps/core/src/p1/operations/publish-handoff.ts',
  ]);

  // Observability events for delivery_rating are a separate merchant surface;
  // they must not assign resultSignals / OutcomeEvidence.
  const observability = readFileSync(
    join(repositoryRoot, 'packages/contracts/src/observability-event.ts'),
    'utf8',
  );
  assert.doesNotMatch(observability, /resultSignals/);
  assert.doesNotMatch(observability, /OutcomeEvidence/);

  const resultCenter = readFileSync(
    join(repositoryRoot, 'packages/contracts/src/result-center.ts'),
    'utf8',
  );
  assert.match(resultCenter, /pure projection/u);
  assert.match(resultCenter, /MUST NOT introduce a/u);
});
