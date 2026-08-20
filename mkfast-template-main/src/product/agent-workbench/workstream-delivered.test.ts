import assert from 'node:assert/strict';
import test from 'node:test';

import { isAgentWorkstreamDelivered } from './workstream-delivered';

test('copy/FREE session delivery flips delivered without handoff materials', () => {
  assert.equal(
    isAgentWorkstreamDelivered({
      deliveredKeyCount: 0,
      publishHandoffError: null,
      publishHandoffView: null,
      sessionDelivered: true,
    }),
    true
  );
});

test('a live undelivered session stays false even with a mounted workstream', () => {
  assert.equal(
    isAgentWorkstreamDelivered({
      deliveredKeyCount: 0,
      sessionDelivered: false,
    }),
    false
  );
});

test('semantic deliveredKeys and handoff view/error still count as delivered', () => {
  assert.equal(isAgentWorkstreamDelivered({ deliveredKeyCount: 1 }), true);
  assert.equal(
    isAgentWorkstreamDelivered({
      deliveredKeyCount: 0,
      publishHandoffView: { kind: 'handoff' },
    }),
    true
  );
  assert.equal(
    isAgentWorkstreamDelivered({
      deliveredKeyCount: 0,
      publishHandoffError: '手机交接暂未准备好',
    }),
    true
  );
});
