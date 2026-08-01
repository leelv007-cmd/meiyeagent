import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import { MemoryGrantLotLedger } from './grant-lot.js';
import { P1DomainError, type P1Context } from './domain.js';
import { RedemptionFoundationModule } from './redemption-module.js';
import {
  MemoryRedemptionStore,
  RedemptionApplicationService,
  type RedemptionCode,
} from './redemption.js';

const context = (actor: P1Context['actor']): P1Context => ({
  actor,
  workspaceId: 'ws-redemption-module',
  userId: `${actor}-1`,
  correlationId: `corr-${actor}`,
});

describe('RedemptionFoundationModule authorization and contracts', () => {
  it('redeems a credit code into the authoritative ledger without writing legacy lots', async () => {
    const creditLedger = new MemoryCreditLedger();
    const legacyGrantLots = new MemoryGrantLotLedger();
    const module = new RedemptionFoundationModule(
      new RedemptionApplicationService(
        new MemoryRedemptionStore(),
        legacyGrantLots,
        () => new Date('2026-08-01T12:00:00.000Z'),
        creditLedger
      )
    );

    await module.execute({
      context: context('admin'),
      idempotencyKey: 'create-credit-code',
      input: {
        action: 'create',
        payload: { code: 'CREDIT-30', credits: 30, grants: {} },
      },
    });
    await module.execute({
      context: context('owner'),
      idempotencyKey: 'redeem-credit-code',
      input: { action: 'redeem', payload: { code: 'CREDIT-30' } },
    });
    await module.execute({
      context: context('owner'),
      idempotencyKey: 'replay-credit-code',
      input: { action: 'redeem', payload: { code: 'CREDIT-30' } },
    });

    assert.equal(
      creditLedger.project('ws-redemption-module').availableCredits,
      30
    );
    assert.equal(creditLedger.listLots('ws-redemption-module').length, 1);
    assert.equal(legacyGrantLots.listLots('ws-redemption-module').length, 0);
  });

  it('does not grant either ledger for an invalid credit code', async () => {
    const creditLedger = new MemoryCreditLedger();
    const legacyGrantLots = new MemoryGrantLotLedger();
    const module = new RedemptionFoundationModule(
      new RedemptionApplicationService(
        new MemoryRedemptionStore(),
        legacyGrantLots,
        () => new Date('2026-08-01T12:00:00.000Z'),
        creditLedger
      )
    );

    await assert.rejects(() =>
      module.execute({
        context: context('owner'),
        idempotencyKey: 'invalid-credit-code',
        input: { action: 'redeem', payload: { code: 'INVALID-CREDIT' } },
      })
    );

    assert.equal(creditLedger.listLots('ws-redemption-module').length, 0);
    assert.equal(legacyGrantLots.listLots('ws-redemption-module').length, 0);
  });

  it('replays a manual record command after the store committed it', async () => {
    const store = new MemoryRedemptionStore();
    const service = new RedemptionApplicationService(
      store,
      new MemoryGrantLotLedger(),
      () => new Date('2026-07-19T12:00:00.000Z')
    );
    const module = new RedemptionFoundationModule(service);
    const command = {
      context: context('admin'),
      idempotencyKey: 'create-after-command-completion-loss',
      input: {
        action: 'create',
        payload: {
          batchId: 'completion-loss-create',
          code: 'COMPLETION-LOSS-CREATE',
          grants: { copy: 20 },
        },
      },
    };

    const first = (await module.execute(command)) as RedemptionCode[];
    const replay = (await module.execute(command)) as RedemptionCode[];

    assert.deepEqual(replay, first);
    assert.equal(
      (await service.list({ batchId: 'completion-loss-create' })).length,
      1
    );

    const created = first[0];
    assert.ok(created);
    const voidCommand = {
      context: context('admin'),
      idempotencyKey: 'void-after-command-completion-loss',
      input: {
        action: 'void',
        payload: { code: created.code, expectedRevision: created.revision },
      },
    };
    const firstVoid = (await module.execute(voidCommand)) as RedemptionCode;
    const replayedVoid = (await module.execute(voidCommand)) as RedemptionCode;

    assert.deepEqual(replayedVoid, firstVoid);
    assert.equal(replayedVoid.status, 'voided');
    assert.equal(replayedVoid.revision, 2);
  });

  it('separates platform management from workspace billing redemption', async () => {
    const module = new RedemptionFoundationModule(
      new RedemptionApplicationService(
        new MemoryRedemptionStore(),
        new MemoryGrantLotLedger(),
        () => new Date('2026-07-19T12:00:00.000Z')
      )
    );
    const created = (await module.execute({
      context: context('admin'),
      idempotencyKey: 'create-1',
      input: {
        action: 'create',
        payload: { code: 'OWNER20', grants: { copy: 20 } },
      },
    })) as RedemptionCode[];
    assert.equal(created.length, 1);

    await assert.rejects(
      () =>
        module.execute({
          context: context('operator'),
          idempotencyKey: 'redeem-operator',
          input: { action: 'redeem', payload: { code: 'OWNER20' } },
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN'
    );
    const redeemed = (await module.execute({
      context: context('owner'),
      idempotencyKey: 'redeem-owner',
      input: { action: 'redeem', payload: { code: 'OWNER20' } },
    })) as { code: RedemptionCode };
    assert.equal(redeemed.code.status, 'redeemed');

    await assert.rejects(
      () =>
        module.query({
          context: context('owner'),
          input: { action: 'list', payload: {} },
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN'
    );
  });

  it('exposes manual record instead of generated batch creation', async () => {
    const module = new RedemptionFoundationModule(
      new RedemptionApplicationService(
        new MemoryRedemptionStore(),
        new MemoryGrantLotLedger(),
        () => new Date('2026-07-19T12:00:00.000Z')
      )
    );

    await assert.rejects(
      () =>
        module.execute({
          context: context('admin'),
          idempotencyKey: 'generated-batch-is-not-supported',
          input: {
            action: 'batch_create',
            payload: { count: 2, grants: { copy: 5 } },
          },
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
    await assert.rejects(
      () =>
        module.execute({
          context: context('admin'),
          idempotencyKey: 'missing-manual-code',
          input: {
            action: 'create',
            payload: { grants: { copy: 5 } },
          },
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
  });
});
