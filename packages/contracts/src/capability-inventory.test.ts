import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPABILITY_INVENTORY,
  CAPABILITY_INVENTORY_REVISION,
} from './capability-inventory.js';
import type { CapabilityInventoryItem } from './capability-registry.js';

/** D-051 decision ③ required inventory ids. */
const REQUIRED_IDS = [
  'account_auth',
  'entitlements_billing_redemption',
  'model_supply_routing_quality',
  'generation_copy',
  'generation_image',
  'generation_video',
  'generation_audio',
  'job_queue_harness',
  'content_package_canvas',
  'channel_tool_integrations',
  'data_storage',
  'config_secrets',
  'observability_audit',
] as const;

function assertSixQuestionMinimum(item: CapabilityInventoryItem) {
  assert.ok(item.id.length > 0, 'id required');
  assert.ok(item.name.length > 0, 'name/purpose carrier required');
  assert.ok(item.purpose.length > 0, 'purpose required (D-051 Q1)');
  assert.ok(item.owner.length > 0, 'owner required (D-056)');
  assert.ok(item.drilldownKey.length > 0, 'drilldown required (D-056)');
  assert.ok(Array.isArray(item.criticalDependencies), 'dependencies required');
  assert.ok(
    [
      'instrumented',
      'stub',
      'not_instrumented',
      'not_in_scope_for_supply_v1',
    ].includes(item.status),
    `status must be honest, got ${item.status}`,
  );
}

describe('capability inventory (S2a / D-051)', () => {
  it('is versioned and lists every required capability id', () => {
    assert.equal(CAPABILITY_INVENTORY.revision, CAPABILITY_INVENTORY_REVISION);
    const ids = new Set(CAPABILITY_INVENTORY.items.map((item) => item.id));
    for (const id of REQUIRED_IDS) {
      assert.ok(ids.has(id), `missing inventory id: ${id}`);
    }
  });

  it('carries D-051/D-056 minimum fields on every row', () => {
    for (const item of CAPABILITY_INVENTORY.items) {
      assertSixQuestionMinimum(item);
    }
  });

  it('keeps audio as not_in_scope_for_supply_v1 stub (must not disappear)', () => {
    const audio = CAPABILITY_INVENTORY.items.find(
      (item) => item.id === 'generation_audio',
    );
    assert.ok(audio);
    assert.equal(audio.status, 'not_in_scope_for_supply_v1');
    assert.ok(audio.drilldownKey.includes('audio'));
  });

  it('marks instrumented domains for supply, queue, and entitlements', () => {
    const instrumented = new Set(
      CAPABILITY_INVENTORY.items
        .filter((item) => item.status === 'instrumented')
        .map((item) => item.id),
    );
    assert.ok(instrumented.has('model_supply_routing_quality'));
    assert.ok(instrumented.has('job_queue_harness'));
    assert.ok(instrumented.has('entitlements_billing_redemption'));
  });
});
