import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDeliveryUiAdapter,
  DELIVERY_ENTRIES,
} from './delivery-entry-adapter';

test('three UI adapters share consume/project identity except the entry tag', async () => {
  const calls: Array<{
    action: string;
    module: string;
    payload: Record<string, unknown>;
  }> = [];
  const transport = {
    async command(
      module: 'operations' | 'result-delivery',
      action: string,
      payload: Record<string, unknown>
    ) {
      calls.push({ action, module, payload });
      return { ok: true };
    },
    async query(
      module: 'operations' | 'result-delivery',
      action: string,
      payload: Record<string, unknown>
    ) {
      calls.push({ action, module, payload });
      return { identity: payload };
    },
  };

  const [workbench, inbox, resultCenter] = DELIVERY_ENTRIES.map((entry) =>
    createDeliveryUiAdapter(entry, transport)
  );
  assert.ok(workbench && inbox && resultCenter);

  await workbench.consume({
    approvalReceiptId: 'approval-1',
    idempotencyKey: 'consume-workbench',
    packageId: 'package-1',
  });
  await resultCenter.consume({
    approvalReceiptId: 'approval-1',
    idempotencyKey: 'consume-result',
    packageId: 'package-1',
  });
  await inbox.projectState({
    approvalReceiptId: 'approval-1',
    packageId: 'package-1',
  });
  await resultCenter.projectState({
    approvalReceiptId: 'approval-1',
    packageId: 'package-1',
  });

  const consumes = calls.filter((call) => call.action === 'delivery_consume');
  assert.equal(consumes.length, 2);
  assert.deepEqual(
    consumes.map((call) => {
      const { entry: _entry, ...rest } = call.payload;
      return rest;
    }),
    [
      { approvalReceiptId: 'approval-1', packageId: 'package-1' },
      { approvalReceiptId: 'approval-1', packageId: 'package-1' },
    ]
  );
  assert.deepEqual(
    consumes.map((call) => call.payload.entry),
    ['workbench', 'result_center']
  );

  const projections = calls.filter(
    (call) => call.action === 'delivery_project_state'
  );
  assert.deepEqual(
    projections.map((call) => {
      const { entry: _entry, ...rest } = call.payload;
      return rest;
    }),
    [
      { approvalReceiptId: 'approval-1', packageId: 'package-1' },
      { approvalReceiptId: 'approval-1', packageId: 'package-1' },
    ]
  );
});
