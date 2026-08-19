import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MerchantCreditDetail } from '@meiye/contracts';
import { CreditBillingService } from '../credit-billing/credit-billing-service.js';
import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from '../credit-billing/credit-plan-catalog.js';
import {
  MemoryCreditSubscriptionStore,
} from '../credit-billing/credit-subscription-scheduler.js';
import { P1ApplicationService } from './application-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import { MemoryGrantLotLedger } from './grant-lot.js';
import { P1DomainError, type P1Context } from './domain.js';
import { RedemptionFoundationModule } from './redemption-module.js';
import {
  MemoryRedemptionStore,
  RedemptionApplicationService,
  type RedeemResult,
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

  it('projects the granted batch, ledger, and balance after redeem, and replays are idempotent', async () => {
    const clock = () => new Date('2026-08-01T12:00:00.000Z');
    const workspaceId = 'ws-redemption-credit-detail';
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(workspaceId, 'owner-1');
    const ledger = new MemoryCreditLedger();
    const creditBilling = new CreditBillingService(
      ledger,
      new MemoryCreditSubscriptionStore(),
      {
        async get() {
          return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
        },
      },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new RedemptionFoundationModule(
          new RedemptionApplicationService(
            new MemoryRedemptionStore(),
            new MemoryGrantLotLedger(),
            clock,
            ledger,
          ),
        ),
        new ProductEntitlementFoundationModule(
          new ProductEntitlementApplicationService(
            repository,
            new RecordedAutoTopUpPaymentPort(),
            clock,
          ),
          clock,
          { creditBilling },
        ),
      ],
    });
    const admin: P1Context = {
      actor: 'admin',
      workspaceId,
      userId: 'admin-1',
      correlationId: 'corr-admin',
    };
    const owner: P1Context = {
      actor: 'owner',
      workspaceId,
      userId: 'owner-1',
      correlationId: 'corr-owner',
    };

    await service.executeModule(
      admin,
      'redemptions',
      {
        action: 'create',
        payload: { code: 'CREDIT-30', credits: 30, grants: {} },
      },
      'create-credit-30',
    );

    const empty = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as MerchantCreditDetail;
    assert.deepEqual(empty, { billing: null, batches: [], transactions: [] });

    const redeemed = (await service.executeModule(
      owner,
      'redemptions',
      { action: 'redeem', payload: { code: 'CREDIT-30' } },
      'redeem-credit-30',
    )) as RedeemResult;
    assert.equal(redeemed.code.status, 'redeemed');
    assert.equal(redeemed.creditGrant?.originalCredits, 30);
    assert.equal(redeemed.creditGrant?.transactionType, 'REDEMPTION_CODE');

    const detail = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as MerchantCreditDetail;
    const projection = (await service.queryModule(owner, 'entitlements', {
      action: 'projection',
      payload: {},
    })) as { credits: { availableCredits: number } };

    assert.equal(projection.credits.availableCredits, 30);
    assert.equal(detail.batches.length, 1);
    assert.equal(detail.batches[0]?.source, 'redemption');
    assert.equal(detail.batches[0]?.remainingCredits, 30);
    assert.equal(detail.batches[0]?.status, 'active');
    assert.equal(detail.transactions.length, 1);
    assert.equal(detail.transactions[0]?.type, 'grant');
    assert.equal(detail.transactions[0]?.operation, 'account_credit');
    assert.equal(detail.transactions[0]?.credits, 30);

    const replay = (await service.executeModule(
      owner,
      'redemptions',
      { action: 'redeem', payload: { code: 'CREDIT-30' } },
      'redeem-credit-30-replay',
    )) as RedeemResult;
    assert.equal(replay.code.status, 'redeemed');
    assert.equal(replay.creditGrant?.id, redeemed.creditGrant?.id);

    const replayedDetail = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as MerchantCreditDetail;
    const replayedProjection = (await service.queryModule(
      owner,
      'entitlements',
      { action: 'projection', payload: {} },
    )) as { credits: { availableCredits: number } };
    assert.deepEqual(replayedDetail, detail);
    assert.equal(replayedProjection.credits.availableCredits, 30);
    assert.equal(ledger.listLots(workspaceId).length, 1);
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
