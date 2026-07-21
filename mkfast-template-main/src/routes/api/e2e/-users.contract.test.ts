import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('E2E user cleanup drains and removes grant-ledger dependencies before workspaces', async () => {
  const source = await readFile(new URL('./users.ts', import.meta.url), 'utf8');
  const drain = source.indexOf('await waitForE2ERuntimeDrain');
  const capacityQueueCount = source.match(
    /'p1_supply_capacity_queue'/gu
  )?.length;
  const capacityLeaseCount = source.match(/'p1_capacity_leases'/gu)?.length;
  const capacityQueue = source.lastIndexOf("'p1_supply_capacity_queue'");
  const capacityLeases = source.lastIndexOf("'p1_capacity_leases'");
  const redemption = source.indexOf('DELETE FROM p1_redemption_codes');
  const transactions = source.indexOf('DELETE FROM p1_grant_lot_transactions');
  const lots = source.indexOf('DELETE FROM p1_grant_lots');
  const workspaces = source.indexOf('.delete(workspaces)');

  assert.ok(drain >= 0);
  assert.equal(capacityQueueCount, 2);
  assert.equal(capacityLeaseCount, 2);
  assert.ok(capacityLeases > capacityQueue);
  assert.ok(workspaces > capacityLeases);
  assert.match(source, /JOB_QUEUE_PREFIX \?\? 'meiye-p1'/u);
  assert.match(source, /WHERE jobs\.name = \$\{P1_JOB_QUEUE_NAME\}/u);
  assert.match(source, /WHERE name = \$\{P1_JOB_QUEUE_NAME\}/u);
  assert.match(source, /NOT EXISTS \(\s*SELECT 1 FROM workspaces/u);
  assert.match(source, /WHERE workspace_id = \$\{workspaceId\}/u);
  assert.ok(redemption > drain);
  assert.ok(transactions > redemption);
  assert.ok(lots > transactions);
  assert.ok(workspaces > lots);
});
