import assert from 'node:assert/strict';
import test from 'node:test';

import { websiteConfig } from './website';

test('uses the approved light-first product theme by default', () => {
  assert.equal(websiteConfig.ui?.mode?.defaultMode, 'light');
});
