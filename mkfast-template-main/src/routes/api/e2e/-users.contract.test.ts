import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('E2E user cleanup drains and removes grant-ledger dependencies before workspaces', async () => {
  const source = await readFile(new URL('./users.ts', import.meta.url), 'utf8');
  const drain = source.indexOf('await waitForE2ERuntimeDrain');
  const redemption = source.indexOf('DELETE FROM p1_redemption_codes');
  const transactions = source.indexOf('DELETE FROM p1_grant_lot_transactions');
  const lots = source.indexOf('DELETE FROM p1_grant_lots');
  const workspaces = source.indexOf('.delete(workspaces)');

  assert.ok(drain >= 0);
  assert.ok(redemption > drain);
  assert.ok(transactions > redemption);
  assert.ok(lots > transactions);
  assert.ok(workspaces > lots);
});
