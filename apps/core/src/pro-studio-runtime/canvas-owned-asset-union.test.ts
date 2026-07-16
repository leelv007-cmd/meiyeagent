import assert from 'node:assert/strict';
import test from 'node:test';

import { canvasOwnedAssetVersionUnionSql } from './canvas-owned-asset-union.js';

test('shares the pro_studio-first p1 fallback and sha256 digest union', () => {
  const sql = canvasOwnedAssetVersionUnionSql('$7');
  assert.match(sql, /pro_studio_owned_assets/u);
  assert.match(sql, /p1_owned_assets/u);
  assert.match(sql, /sha256/u);
  assert.match(sql, /0 AS priority/u);
  assert.match(sql, /1 AS priority/u);
  assert.match(sql, /WHERE workspace_id = \$7/u);
  assert.match(sql, /ORDER BY id, priority/u);
});
