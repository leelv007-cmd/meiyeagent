import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryGrantLotLedger,
  type GrantLotGrantInput,
} from './grant-lot.js';
import {
  MemoryRedemptionStore,
  RedemptionApplicationService,
} from './redemption.js';
import { P1DomainError } from './domain.js';

function setup() {
  let now = '2026-07-19T12:00:00.000Z';
  const clock = () => new Date(now);
  const setNow = (value: string) => {
    now = value;
  };
  const store = new MemoryRedemptionStore();
  const grantLots = new MemoryGrantLotLedger();
  const service = new RedemptionApplicationService(store, grantLots, clock);
  return { service, store, grantLots, clock, setNow };
}

describe('redemption domain', () => {
  it('creates, redeems once, and links a real grant transaction id', async () => {
    const { service, grantLots, setNow } = setup();
    const [created] = await service.createCodes({
      code: 'WELCOME20',
      grants: { copy: 20, image: 5 },
      createdBy: 'admin-1',
    });
    assert.ok(created);
    assert.equal(created.status, 'active');
    assert.equal(created.grantTransactionId, undefined);

    const redeemed = await service.redeem({
      code: 'welcome20',
      workspaceId: 'ws-1',
      userId: 'owner-1',
      correlationId: 'corr-1',
    });
    assert.equal(redeemed.code.status, 'redeemed');
    assert.ok(redeemed.code.grantTransactionId);
    assert.equal(redeemed.code.redeemedWorkspaceId, 'ws-1');
    assert.ok(redeemed.grantTransactions.length >= 1);
    assert.equal(
      redeemed.grantTransactions.some(
        (tx) => tx.id === redeemed.code.grantTransactionId
      ),
      true
    );

    const lots = grantLots.listLots('ws-1');
    assert.equal(lots.find((lot) => lot.resource === 'copy')?.remainingAmount, 20);
    assert.equal(lots.find((lot) => lot.resource === 'image')?.remainingAmount, 5);
    assert.equal(
      lots.every((lot) => lot.transactionType === 'REDEMPTION_CODE'),
      true
    );

    // Same workspace re-redeem is idempotent (no second grant).
    setNow('2026-07-19T13:00:00.000Z');
    const replay = await service.redeem({
      code: 'WELCOME20',
      workspaceId: 'ws-1',
      userId: 'owner-1',
      correlationId: 'corr-2',
    });
    assert.equal(replay.code.status, 'redeemed');
    assert.equal(replay.grantTransactions.length, 2);
    assert.equal(
      replay.grantTransactions.some(
        (transaction) => transaction.id === replay.code.grantTransactionId
      ),
      true
    );
    assert.equal(grantLots.listLots('ws-1').length, lots.length);

    // Other workspace cannot redeem the same code.
    await assert.rejects(
      () =>
        service.redeem({
          code: 'WELCOME20',
          workspaceId: 'ws-2',
          userId: 'owner-2',
          correlationId: 'corr-3',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
  });

  it('returns persisted grant transactions from the memory store on replay', async () => {
    const { service, store, grantLots, clock } = setup();
    const [created] = await service.createCodes({
      code: 'STORE20',
      grants: { copy: 20 },
      createdBy: 'admin-1',
    });
    assert.ok(created);
    const grant = async (code: { redeemedAt?: string }) => {
      const lotId = `lot-store-${created.id}`;
      assert.ok(code.redeemedAt);
      grantLots.grant({
        id: lotId,
        workspaceId: 'ws-store',
        resource: 'copy',
        amount: 20,
        expirationDate: null,
        transactionType: 'REDEMPTION_CODE',
        sourceRef: created.id,
        actorId: 'owner-store',
        correlationId: 'corr-store',
        createdAt: code.redeemedAt,
      });
      const grantTransactions = grantLots
        .listTransactions('ws-store')
        .filter((transaction) => transaction.lotId === lotId);
      const primary = grantTransactions[0];
      assert.ok(primary);
      return {
        grantTransactionId: primary.id,
        grantTransactions,
      };
    };
    const first = await store.redeemAtomic({
      code: created.code,
      workspaceId: 'ws-store',
      userId: 'owner-store',
      correlationId: 'corr-store',
      now: clock().toISOString(),
      grant,
    });

    const replay = await store.redeemAtomic({
      code: created.code,
      workspaceId: 'ws-store',
      userId: 'owner-store',
      correlationId: 'corr-store-replay',
      now: clock().toISOString(),
      grant,
    });

    assert.deepEqual(replay.grantTransactions, first.grantTransactions);
    assert.equal(replay.grantTransactions.length, 1);
    assert.equal(grantLots.listLots('ws-store').length, 1);
  });

  it('voids with CAS revision and rejects redeem of voided/expired codes', async () => {
    const { service } = setup();
    const [created] = await service.createCodes({
      code: 'EXPIRED-VIDEO-2',
      grants: { video: 2 },
      createdBy: 'admin-1',
      createdAt: '2026-07-17T00:00:00.000Z',
      expiresAt: '2026-07-18T00:00:00.000Z',
    });
    assert.ok(created);
    await assert.rejects(
      () =>
        service.redeem({
          code: created.code,
          workspaceId: 'ws-1',
          userId: 'owner-1',
          correlationId: 'corr-exp',
        }),
      /expired/
    );

    const [active] = await service.createCodes({
      code: 'ACTIVE-VIDEO-1',
      grants: { video: 1 },
      createdBy: 'admin-1',
    });
    assert.ok(active);
    const voided = await service.voidCode({
      code: active.code,
      expectedRevision: active.revision,
    });
    assert.equal(voided.status, 'voided');
    await assert.rejects(
      () =>
        service.voidCode({
          code: active.code,
          expectedRevision: active.revision,
        }),
      /revision conflict/
    );
    await assert.rejects(
      () =>
        service.redeem({
          code: active.code,
          workspaceId: 'ws-1',
          userId: 'owner-1',
          correlationId: 'corr-void',
        }),
      /voided/
    );
  });

  it('records only an operator-supplied code', async () => {
    const { service } = setup();
    const recorded = await service.createCodes({
      code: 'PILOT-5-5-1',
      grants: { copy: 10 },
      createdBy: 'admin-1',
    });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.code, 'PILOT-5-5-1');

    await assert.rejects(
      () =>
        service.createCodes({
          grants: { copy: 10 },
          createdBy: 'admin-1',
        } as never),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
  });

  it('rolls back every grant lot when a multi-resource redemption cannot complete', async () => {
    class FailingGrantLedger extends MemoryGrantLotLedger {
      override grant(input: GrantLotGrantInput) {
        const lot = super.grant(input);
        if (input.resource === 'image') {
          throw new Error('simulated second grant failure');
        }
        return lot;
      }
    }
    const store = new MemoryRedemptionStore();
    const grantLots = new FailingGrantLedger();
    const service = new RedemptionApplicationService(
      store,
      grantLots,
      () => new Date('2026-07-19T12:00:00.000Z')
    );
    const [created] = await service.createCodes({
      code: 'ATOMIC20',
      grants: { copy: 20, image: 5 },
      createdBy: 'admin-1',
    });
    assert.ok(created);

    await assert.rejects(
      () =>
        service.redeem({
          code: created.code,
          workspaceId: 'ws-atomic',
          userId: 'owner-atomic',
          correlationId: 'corr-atomic',
        }),
      /simulated second grant failure/
    );
    assert.equal(grantLots.listLots('ws-atomic').length, 0);
    assert.equal(grantLots.listTransactions('ws-atomic').length, 0);
    assert.equal((await store.getByCode(created.code))?.status, 'active');
    assert.equal((await store.getByCode(created.code))?.revision, 1);
  });

  it('rejects unknown grant resources without list side effects', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createCodes({
          code: 'UNKNOWN-RESOURCE',
          grants: { unknown: 1 } as never,
          createdBy: 'admin-1',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
  });

  /**
   * #391 red-first: list used to call expireDue and bump revision, so a
   * concurrent void holding the pre-list revision failed with conflict.
   * Desired: list is read-only; revision and status stay put until the job.
   */
  it('does not bump revision when listing past-due codes', async () => {
    const { service, setNow } = setup();
    const [created] = await service.createCodes({
      code: 'LIST-NO-REV-BUMP',
      grants: { copy: 20 },
      expiresAt: '2026-07-19T11:59:59.000Z',
      createdBy: 'admin-1',
      createdAt: '2026-07-18T12:00:00.000Z',
    });
    assert.ok(created);
    assert.equal(created.revision, 1);
    assert.equal(created.status, 'active');

    setNow('2026-07-19T12:00:00.000Z');
    const listed = await service.list();
    const row = listed.at(0);
    assert.ok(row);
    assert.equal(row.status, 'active');
    assert.equal(row.revision, 1);

    // Concurrent void still succeeds with the revision the operator held.
    const voided = await service.voidCode({
      code: created.code,
      expectedRevision: created.revision,
    });
    assert.equal(voided.status, 'voided');
    assert.equal(voided.revision, 2);
  });

  it('list refresh no longer races a concurrent void (revision conflict pathology)', async () => {
    const { service, setNow } = setup();
    const [created] = await service.createCodes({
      code: 'VOID-RACE-SAFE',
      grants: { copy: 1 },
      expiresAt: '2026-07-19T11:59:59.000Z',
      createdBy: 'admin-1',
      createdAt: '2026-07-18T12:00:00.000Z',
    });
    assert.ok(created);
    const operatorRevision = created.revision;

    setNow('2026-07-19T12:00:00.000Z');
    // Operator B refreshes the admin list while Operator A voids.
    await service.list();
    const voided = await service.voidCode({
      code: created.code,
      expectedRevision: operatorRevision,
    });
    assert.equal(voided.status, 'voided');
  });
});
