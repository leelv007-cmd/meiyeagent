import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifySupplierTaskOps,
  merchantShotLabel,
} from './video-worksurface-model';

describe('supplier task receiving actions', () => {
  it('keeps poll, recover and download free', () => {
    for (const action of [
      'poll',
      'recover',
      'download_supplier_task',
    ] as const) {
      const decision = classifySupplierTaskOps(action);
      assert.equal(decision.fee, 'none', action);
      assert.equal(decision.createsProductUsage, false, action);
      assert.equal(decision.requiresFullRecomposeQuote, false, action);
    }
  });

  it('never exposes provider identifiers in merchant shot labels', () => {
    const label = merchantShotLabel({
      order: 0,
      promptPreview: '开场 7f3c2a10-1111-2222-3333-444455556666 到店',
      shotId: '7f3c2a10-1111-2222-3333-444455556666',
    });
    assert.match(label, /镜头 1/u);
    assert.doesNotMatch(label, /7f3c2a10/u);
    assert.doesNotMatch(label, /444455556666/u);
  });
});
