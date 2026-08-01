import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveOrdinaryToolRoute,
  validateOrdinaryToolSearch,
} from './tool-route-model';

test('ordinary tools without a verified execution chain are not routable', () => {
  for (const toolEntryId of [
    'tool.multi_size',
    'tool.batch_bg_remove',
    'tool.subtitle_erase',
  ]) {
    const resolved = resolveOrdinaryToolRoute(
      toolEntryId,
      validateOrdinaryToolSearch({
        returnToDraftKey: 'catalog-return-1',
        focusKey: toolEntryId,
        surfaceRevisionId: 'surface.home.launch@7',
      })
    );
    assert.equal(resolved.kind, 'not_found');
  }
});

test('ordinary tool route rejects unknown tool and sensitive search', () => {
  assert.equal(
    resolveOrdinaryToolRoute('tool.unknown_retired', {}).kind,
    'not_found'
  );
  const validated = validateOrdinaryToolSearch({
    prompt: 'secret prompt',
    returnToDraftKey: 'safe-key',
  });
  assert.equal(validated.invalid, true);
  assert.equal('prompt' in validated, false);
  assert.equal(
    resolveOrdinaryToolRoute('tool.multi_size', validated).kind,
    'invalid'
  );
});
