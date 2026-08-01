import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import {
  ProductBillingFoundationModule,
  type ProductQuoteAuthority,
} from './foundation-module.js';
import { ProductQuoteService } from './quote-service.js';

const context: P1Context = {
  workspaceId: 'ws-module',
  userId: 'owner-1',
  correlationId: 'corr-module',
};

function module(authority: ProductQuoteAuthority = authoritativeQuote()) {
  const quotes = new ProductQuoteService({
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
  });
  return {
    quotes,
    module: new ProductBillingFoundationModule(quotes, authority),
  };
}

function authoritativeQuote(): ProductQuoteAuthority {
  return {
    async resolve(input) {
      return {
        billingMode:
          input.operation === 'video.generate'
            ? 'per_output_second'
            : 'per_request',
        catalogModelId: input.catalogModelId,
        catalogModelRevision: 'catalog-server-1',
        operation: input.operation,
        quoteId: input.quoteId,
        quotePolicyRevision: 'quote-policy-server-1',
        frozenCandidateDeploymentIds: ['server-deployment-1'],
        routeSnapshotRef: 'server-route-1',
        ...(input.operation === 'video.generate'
          ? {
              minChargeSeconds: 2,
              roundingStepSeconds: 1,
              targetSeconds: input.targetSeconds ?? 15,
            }
          : {}),
        unitRate: input.operation === 'copy.generate' ? 2 : 0.5,
        workspaceId: input.workspaceId,
      };
    },
  };
}

describe('ProductBillingFoundationModule', () => {
  it('accepts all eight merchant credit quote operations', async () => {
    const { module: billing } = module();
    for (const operation of [
      'copy.generate',
      'copy.adapt',
      'image.generate',
      'image.edit',
      'image.reference_transform',
      'video.generate',
      'audio.speech',
      'audio.sfx',
    ] as const) {
      const quote = await billing.execute({
        context,
        idempotencyKey: `quote-${operation}`,
        input: {
          action: 'quote',
          payload: {
            catalogModelId: `model-${operation}`,
            operation,
            quoteId: `quote-${operation}`,
            ...(operation === 'video.generate' ? { targetSeconds: 15 } : {}),
          },
        },
      });
      assert.equal((quote as { operation?: string }).operation, operation);
    }
  });

  it('quotes and confirms from server-authoritative pricing only', async () => {
    const { module: billing } = module();

    const quoted = (await billing.execute({
      context,
      idempotencyKey: 'key-quote',
      input: {
        action: 'quote',
        payload: {
          quoteId: 'mod-quote-1',
          catalogModelId: 'model-v',
          operation: 'video.generate',
          targetSeconds: 6,
        },
      },
    })) as {
      quoteId: string;
      confirmedAmount?: number;
      lifecycleStatus: string;
      frozenCandidateDeploymentIds?: string[];
      routeSnapshotRef?: string;
    };

    assert.equal(quoted.lifecycleStatus, 'quoted');
    assert.equal(quoted.confirmedAmount, 3);
    assert.equal(quoted.frozenCandidateDeploymentIds, undefined);
    assert.equal(quoted.routeSnapshotRef, undefined);

    await billing.execute({
      context,
      idempotencyKey: 'key-confirm',
      input: {
        action: 'confirm',
        payload: { quoteId: 'mod-quote-1', taskId: 'task-mod-1' },
      },
    });

    const loaded = await billing.query?.({
      context,
      input: {
        action: 'get_quote',
        payload: { quoteId: 'mod-quote-1' },
      },
    });
    assert.equal((loaded as { quoteId: string }).quoteId, 'mod-quote-1');
  });

  it('rejects browser-forged price, policy, route, deployment, and ceiling facts', async () => {
    const { module: billing } = module();
    for (const forged of [
      { unitRate: 0 },
      { quotePolicyRevision: 'attacker-policy' },
      { billingMode: 'per_request' },
      { catalogModelRevision: 'attacker-catalog' },
      { authorizedCeiling: 0 },
      { debitUnits: [{ resource: 'video', quantity: 999 }] },
      { routeSnapshotRef: 'attacker-route' },
      { frozenCandidateDeploymentIds: ['attacker-deployment'] },
    ]) {
      await assert.rejects(
        billing.execute({
          context,
          idempotencyKey: `forged-${Object.keys(forged)[0]}`,
          input: {
            action: 'quote',
            payload: {
              quoteId: `forged-${Object.keys(forged)[0]}`,
              catalogModelId: 'model-v',
              operation: 'video.generate',
              targetSeconds: 6,
              ...forged,
            },
          },
        }),
        /server-authoritative/i,
      );
    }
  });

  it('does not expose provider lifecycle or settlement commands to browsers', async () => {
    const { module: billing } = module();
    for (const action of [
      'reserve',
      'dispatch',
      'fallback_dispatch',
      'settle',
      'fail_and_refund',
    ]) {
      await assert.rejects(
        billing.execute({
          context,
          idempotencyKey: `forbidden-${action}`,
          input: { action, payload: { quoteId: 'quote-1' } },
        }),
        /Unknown product-billing command/,
      );
    }
  });

  it('does not accept a browser ceiling override at confirmation', async () => {
    const { module: billing } = module();
    await billing.execute({
      context,
      idempotencyKey: 'quote-before-forged-confirm',
      input: {
        action: 'quote',
        payload: {
          catalogModelId: 'model-v',
          operation: 'video.generate',
          quoteId: 'quote-before-forged-confirm',
          targetSeconds: 6,
        },
      },
    });
    await assert.rejects(
      billing.execute({
        context,
        idempotencyKey: 'forged-confirm-ceiling',
        input: {
          action: 'confirm',
          payload: {
            authorizedCeiling: 0,
            quoteId: 'quote-before-forged-confirm',
            taskId: 'task-forged-confirm',
          },
        },
      }),
      /server-authoritative/,
    );
  });

  it('keeps every quote lifecycle command and task query workspace-scoped', async () => {
    const { module: billing } = module();
    await billing.execute({
      context,
      idempotencyKey: 'key-scoped-quote',
      input: {
        action: 'quote',
        payload: {
          quoteId: 'mod-quote-scoped',
          catalogModelId: 'model-scoped',
          operation: 'image.generate',
        },
      },
    });

    const foreignContext = { ...context, workspaceId: 'ws-foreign' };
    await assert.rejects(
      billing.execute({
        context: foreignContext,
        idempotencyKey: 'key-foreign-confirm',
        input: {
          action: 'confirm',
          payload: { quoteId: 'mod-quote-scoped', taskId: 'task-scoped' },
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
    );

    await billing.execute({
      context,
      idempotencyKey: 'key-scoped-confirm',
      input: {
        action: 'confirm',
        payload: { quoteId: 'mod-quote-scoped', taskId: 'task-scoped' },
      },
    });
    for (const [action, payload] of [
      ['get_quote_by_task', { taskId: 'task-scoped' }],
    ] as const) {
      await assert.rejects(
        billing.query?.({
          context: foreignContext,
          input: { action, payload },
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'FORBIDDEN',
      );
    }
  });

  it('binds authoritative quotes to the authenticated workspace', async () => {
    const requested: unknown[] = [];
    const { module: billing } = module({
      async resolve(input) {
        requested.push(input);
        return authoritativeQuote().resolve(input);
      },
    });
    const quoted = (await billing.execute({
      context,
      idempotencyKey: 'key-authoritative-workspace',
      input: {
        action: 'quote',
        payload: {
          quoteId: 'authoritative-workspace-quote',
          catalogModelId: 'model-c',
          operation: 'image.generate',
        },
      },
    })) as { workspaceId?: string };

    assert.equal(quoted.workspaceId, context.workspaceId);
    assert.deepEqual(requested, [
      {
        catalogModelId: 'model-c',
        operation: 'image.generate',
        quoteId: 'authoritative-workspace-quote',
        workspaceId: context.workspaceId,
      },
    ]);
  });
});
