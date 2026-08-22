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
