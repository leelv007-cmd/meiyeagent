import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Waffo dry-run is offline and names its frozen Core snapshot revisions', async () => {
  const source = await readFile(
    new URL('./provision-waffo-subscriptions.ts', import.meta.url),
    'utf8'
  );
  const dryRun = source.slice(
    source.indexOf(
      'if (process.env.WAFFO_PROVISION_APPLY !== APPLY_CONFIRMATION)'
    ),
    source.indexOf("if (process.env.WAFFO_ENVIRONMENT?.trim() !== 'test')")
  );
  assert.match(dryRun, /WAFFO_COMMERCE_SNAPSHOT_FILE/u);
  assert.match(dryRun, /source: 'explicit-commerce-snapshot'/u);
  assert.match(dryRun, /planRevision/u);
  assert.match(dryRun, /paymentMappingRevision/u);
  assert.doesNotMatch(dryRun, /fetch\(/u);
  assert.doesNotMatch(dryRun, /WaffoPancake/u);
});
