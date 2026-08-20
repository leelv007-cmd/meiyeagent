import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerDestinationCapability,
  composerDestinationContract,
} from './destination-contract';

test('composer destination capability covers export / copy / assisted only', () => {
  assert.equal(
    composerDestinationCapability('assisted_handoff'),
    '生成后协办交接'
  );
  assert.equal(composerDestinationCapability('manual_copy'), '生成后手动复制');
  assert.equal(composerDestinationCapability('export'), '生成后导出');
});

test('composer destination contract never maps a publish: target', () => {
  const mapped = composerDestinationContract(
    'xiaohongshu',
    'publish:xiaohongshu'
  );
  assert.ok(mapped);
  assert.equal(mapped.distributionTarget, 'export');
});
