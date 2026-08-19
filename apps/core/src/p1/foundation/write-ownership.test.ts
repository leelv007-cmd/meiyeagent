import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENT_PACKAGE_WRITE_OWNERSHIP_TABLE,
  MemoryWriteOwnershipLedger,
  NEW_ACCOUNT_CONTENT_PACKAGE_WRITE_OWNER,
  NEW_ACCOUNT_P1_WRITE_OWNER,
  P1_WRITE_OWNERSHIP_TABLE,
  WRITE_OWNERSHIP_BACKFILL_SQL,
  WRITE_OWNERSHIP_MISSING,
  classifyContentPackageBackfillOwner,
  decideAcceptedProductWrite,
  decideContentPackageCanonicalWrite,
  decideLegacyContentWrite,
  decideP1SideEffectWrite,
  explicitWriteOwner,
  insertNewAccountWriteOwnership,
  inventoryWriteOwnership,
  newAccountWriteOwnershipFacts,
  routeProductWriteOwner,
  writeOwnershipMissingError,
} from './write-ownership.js';

test('new-account bootstrap writes both ownerships in one transaction', async () => {
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  await insertNewAccountWriteOwnership(
    {
      async query(sql, params = []) {
        statements.push({ sql, params });
        return { rowCount: 1 };
      },
    },
    'workspace-new'
  );

  assert.equal(statements.length, 2);
  assert.match(statements[0]!.sql, /INSERT INTO p1_write_ownership/u);
  assert.deepEqual(statements[0]!.params, [
    'workspace-new',
    NEW_ACCOUNT_P1_WRITE_OWNER,
  ]);
  assert.match(
    statements[1]!.sql,
    /INSERT INTO content_package_write_ownership/u
  );
  assert.deepEqual(statements[1]!.params, [
    'workspace-new',
    NEW_ACCOUNT_CONTENT_PACKAGE_WRITE_OWNER,
  ]);
  assert.notEqual(statements[1]!.params[1], 'p1');
});

test('bootstrap rolls back both ownerships when either insert fails', () => {
  const ledger = new MemoryWriteOwnershipLedger();
  ledger.failNext('contentpackage');
  assert.throws(
    () => ledger.bootstrapNewAccount('workspace-partial'),
    /content-package write ownership insert failed/
  );
  assert.equal(ledger.readP1('workspace-partial'), null);
  assert.equal(ledger.readContentPackage('workspace-partial'), null);

  ledger.bootstrapNewAccount('workspace-new');
  assert.equal(ledger.readP1('workspace-new'), 'p1');
  assert.equal(ledger.readContentPackage('workspace-new'), 'contentpackage');
});

test('new accounts do not dual-read missing ownership as two different writers', () => {
  const ledger = new MemoryWriteOwnershipLedger();
  ledger.bootstrapNewAccount('workspace-new');
  const facts = newAccountWriteOwnershipFacts('workspace-new');

  assert.equal(facts.p1.table, P1_WRITE_OWNERSHIP_TABLE);
  assert.equal(facts.contentPackage.table, CONTENT_PACKAGE_WRITE_OWNERSHIP_TABLE);
  assert.equal(facts.p1.owner, 'p1');
  assert.equal(facts.contentPackage.owner, 'contentpackage');
  assert.notEqual(facts.contentPackage.owner, 'p1');
  assert.equal(
    decideP1SideEffectWrite(ledger.readP1('workspace-new')).decision,
    'allow'
  );
  assert.equal(
    decideAcceptedProductWrite(ledger.readP1('workspace-new'), 'p1').decision,
    'allow'
  );
  assert.equal(
    decideContentPackageCanonicalWrite(
      ledger.readContentPackage('workspace-new')
    ).decision,
    'allow'
  );
  assert.equal(
    decideLegacyContentWrite(ledger.readContentPackage('workspace-new')).code,
    'LEGACY_CONTENT_READ_ONLY'
  );
});

test('legacy ownership is an explicit row, never a missing default', () => {
  const ledger = new MemoryWriteOwnershipLedger();
  assert.equal(ledger.readP1('workspace-legacy'), null);
  assert.equal(ledger.readContentPackage('workspace-legacy'), null);
  ledger.p1.set('workspace-legacy', 'legacy');
  ledger.contentPackage.set('workspace-legacy', 'legacy');
  assert.equal(ledger.readP1('workspace-legacy'), 'legacy');
  assert.equal(ledger.readContentPackage('workspace-legacy'), 'legacy');
  assert.equal(
    decideP1SideEffectWrite(ledger.readP1('workspace-legacy')).code,
    'P1_WRITE_DISABLED'
  );
  assert.equal(
    decideAcceptedProductWrite(ledger.readP1('workspace-legacy'), 'legacy')
      .decision,
    'allow'
  );
  assert.equal(
    decideContentPackageCanonicalWrite(
      ledger.readContentPackage('workspace-legacy')
    ).decision,
    'allow'
  );
  assert.equal(
    decideLegacyContentWrite(ledger.readContentPackage('workspace-legacy'))
      .decision,
    'allow'
  );
});

test('each semantic owner reader and gate agree on the same missing value', () => {
  const missingP1 = explicitWriteOwner<never>(undefined);
  const missingContentPackage = explicitWriteOwner<never>(null);
  const p1SideEffects = decideP1SideEffectWrite(missingP1);
  const p1Product = decideAcceptedProductWrite(missingP1, 'p1');
  const legacyProduct = decideAcceptedProductWrite(missingP1, 'legacy');
  const p1Route = routeProductWriteOwner(missingP1);
  const canonical = decideContentPackageCanonicalWrite(missingContentPackage);
  const legacyContent = decideLegacyContentWrite(missingContentPackage);

  assert.equal(p1SideEffects.decision, 'reject');
  assert.equal(p1SideEffects.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(p1Product.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(legacyProduct.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(p1Route.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(canonical.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(legacyContent.code, WRITE_OWNERSHIP_MISSING);
  assert.equal(
    writeOwnershipMissingError('p1').code,
    writeOwnershipMissingError('contentpackage').code
  );
  assert.notEqual(
    writeOwnershipMissingError('p1').message,
    writeOwnershipMissingError('contentpackage').message
  );
});

test('inventory is read-only and classifies historical missing rows', () => {
  const p1Owners = new Map([
    ['ws-p1', 'p1' as const],
    ['ws-legacy', 'legacy' as const],
  ]);
  const contentPackageOwners = new Map([
    ['ws-p1', 'contentpackage' as const],
  ]);
  const inventory = inventoryWriteOwnership({
    workspaces: [
      { id: 'ws-p1', createdAt: '2026-08-20T00:00:00.000Z' },
      { id: 'ws-legacy', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'ws-after', createdAt: '2026-08-02T00:00:00.000Z' },
      { id: 'ws-unknown' },
    ],
    p1Owners,
    contentPackageOwners,
    contentPackageBaselineCompletedAt: '2026-08-01T00:00:00.000Z',
  });

  assert.deepEqual(inventory, {
    workspaces: 4,
    p1Present: 2,
    contentPackagePresent: 1,
    missingP1: ['ws-after', 'ws-unknown'],
    missingContentPackage: ['ws-legacy', 'ws-after', 'ws-unknown'],
    contentPackageBackfill: [
      { workspaceId: 'ws-legacy', plannedOwner: 'legacy' },
      { workspaceId: 'ws-after', plannedOwner: 'contentpackage' },
      { workspaceId: 'ws-unknown', plannedOwner: null },
    ],
    unclassifiedContentPackage: ['ws-unknown'],
  });
  assert.equal(
    classifyContentPackageBackfillOwner(
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    ),
    'legacy'
  );
  assert.equal(p1Owners.get('ws-after'), undefined);
  assert.equal(contentPackageOwners.get('ws-legacy'), undefined);
});

test('backfill SQL inventories, applies explicit rows, verifies counts, and can roll back', () => {
  assert.match(WRITE_OWNERSHIP_BACKFILL_SQL.inventory, /write_ownership_backfill_audit/u);
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.inventory,
    /INSERT INTO write_ownership_backfill_audit[\s\S]*'p1_write_ownership'[\s\S]*'legacy'[\s\S]*'inventory'/u
  );
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.inventory,
    /content_package_write_ownership[\s\S]*unclassified[\s\S]*legacy[\s\S]*contentpackage/u
  );
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.apply,
    /INSERT INTO p1_write_ownership[\s\S]*planned_owner = 'legacy'/u
  );
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.apply,
    /INSERT INTO content_package_write_ownership[\s\S]*planned_owner IN \('legacy', 'contentpackage'\)/u
  );
  assert.doesNotMatch(WRITE_OWNERSHIP_BACKFILL_SQL.apply, /content_package_write_ownership[\s\S]*'p1'/u);
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.apply,
    /inventoried_p1[\s\S]*applied_p1[\s\S]*unclassified_left_fail_closed/u
  );
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.rollback,
    /DELETE FROM p1_write_ownership[\s\S]*action = 'applied'[\s\S]*owner = audit.planned_owner/u
  );
  assert.match(
    WRITE_OWNERSHIP_BACKFILL_SQL.countCheck,
    /missing_p1[\s\S]*missing_content_package/u
  );
});
