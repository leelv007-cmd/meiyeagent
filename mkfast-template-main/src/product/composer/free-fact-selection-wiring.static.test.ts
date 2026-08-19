import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./composer-home.tsx', import.meta.url),
  'utf8'
);

test('ComposerHome owns the merchant selection and submits only its active exact refs', () => {
  assert.match(
    source,
    /useOwnedFreeFactSelection\(freeFactSelectionOwner\)/u,
    'production Composer must use tuple-owned selection state'
  );
  assert.match(
    source,
    /accountId,[\s\S]*workspaceId:[\s\S]*threadId:[\s\S]*creationMode/u
  );
  assert.match(source, /<FreeFactSelector/u);
  assert.match(source, /onSelectionChange=\{setSelectedFreeFactRefs\}/u);
  assert.match(
    source,
    /currentSelectedFreeFactRefs\([\s\S]*selectedFreeFactRefs,[\s\S]*storeFacts\.data \?\? \[\]/u
  );
  assert.match(source, /requestedFactRefs: requestedFreeFactRefs/u);
  assert.match(
    source,
    /onAgentBinding:[\s\S]*setAgentBinding\(binding\);[\s\S]*clearSelectedFreeFactRefs\(\)/u,
    'a successful run must clear this-run-only selections'
  );
  assert.doesNotMatch(
    source,
    /setSelectedFreeFactRefs\([^)]*storeFacts\.data/u,
    'loading facts must never auto-select them'
  );
});
