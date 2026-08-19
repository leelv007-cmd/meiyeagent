import assert from 'node:assert/strict';
import test from 'node:test';

import {
  identifiers,
  literals,
  parseProductionSource,
} from '../../test-support/ast-boundary';

test('Composer exposes model preference query failures with an explicit retry', () => {
  const source = parseProductionSource(
    new URL('./composer-home.tsx', import.meta.url)
  );

  assert.ok(identifiers(source).has('preferencesQuery'));
  assert.ok(literals(source).includes('composer-model-preferences-error'));
  assert.ok(identifiers(source).has('refetch'));
  assert.ok(
    literals(source).some((value) => value.includes('当前不会提交创作任务'))
  );
});
