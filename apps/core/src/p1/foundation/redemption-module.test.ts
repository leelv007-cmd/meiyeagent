import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
  it('replays a generated create command after the store committed it', async () => {
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
});
