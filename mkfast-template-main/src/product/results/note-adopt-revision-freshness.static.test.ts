import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

/**
 * T20's note adoption is an optimistic-concurrency write. The workbench
 * auto-prepares the mobile publish handoff as soon as the package reads
 * delivered, and Core records a self-publish approval receipt in that call,
 * which bumps the ContentPackage revision. A revision captured earlier in the
 * journey is therefore a dead CAS token by the time the merchant adopts —
 * the spec must read the revision in the same browser turn as the command and
 * honour the refresh-and-retry the conflict envelope asks for.
 */
test('T20 note adoption reads the CAS revision in the command turn', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'tests/e2e/specs/image-text-note-compiler.spec.ts'),
    'utf8'
  );
  const start = source.indexOf('async function adoptRecommendedCandidate(');
  const end = source.indexOf('async function exportFullPackage(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const helper = source.slice(start, end);

  // The revision must come from a read issued inside page.evaluate, never
  // from the projection captured before the delivery settled.
  assert.match(helper, /action: 'content_package'/u);
  assert.doesNotMatch(helper, /expectedRevision: contentPackage\.revision/u);
  // A single refresh-and-retry on the documented conflict code; a second
  // conflict must still fail the journey.
  assert.match(helper, /CONTENT_PACKAGE_REVISION_CONFLICT/u);
  assert.match(helper, /Note adoption failed/u);
});

/**
 * The same dead CAS token lives in the product, not only in T20's spec: the
 * Result Center held `contentPackage.revision` from its render-time projection
 * while the same auto-prepared publish handoff raised it, which is the p2
 * image-text deep run's `CONTENT_PACKAGE_REVISION_CONFLICT: revision changed
 * from 1 to 2`. Adoption must go through the helper that reads in the command
 * turn, so nobody re-inlines the projection's revision here.
 */
test('Result Center harness adoption never spends the render-time revision', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/product/results/use-result-center-view.tsx'),
    'utf8'
  );
  const start = source.indexOf('const adoptHarnessCandidate = async () => {');
  const end = source.indexOf('const adoptCopyCandidate = async () => {', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const helper = source.slice(start, end);

  assert.match(helper, /adoptHarnessCandidateOnLatestRevision\(/u);
  assert.doesNotMatch(helper, /expectedRevision: contentPackage\.revision/u);
  assert.doesNotMatch(helper, /'adopt_harness_candidate'/u);
});
