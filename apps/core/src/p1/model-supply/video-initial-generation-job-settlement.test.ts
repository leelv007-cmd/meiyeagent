import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProductQuoteSnapshot } from '@meiye/contracts';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';
import {
  composeVideoTerminalObservers,
  createInitialVideoTerminalObserver,
  type DurableInitialVideoBilling,
} from './video-workflow-billing.js';

describe('initial video generation worker settlement', () => {
  it('settles one successful initial video exactly once across replay', async () => {
    let lifecycleStatus: ProductQuoteSnapshot['lifecycleStatus'] = 'confirmed';
    const settleCalls: unknown[] = [];
    const attempt = {
      acceptance: 'accepted' as const,
      catalogModelId: 'seedance-2',
      createdAt: '2026-07-20T00:00:00.000Z',
      deploymentId: 'seedance-production',
      id: 'attempt-video-1',
      jobId: 'video-task-1',
      status: 'completed' as const,
    };
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [attempt],
      billingQuoteRevision: 'quote-r1',
      billingTaskId: 'video-task-1',
      catalogModelId: 'seedance-2',
      clipAssets: [],
      confirmed: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      dataClass: [],
      id: 'video-workflow-1',
      revision: 2,
      shots: [
        {
          candidates: [
            {
              attempt,
              attempts: [attempt],
              generationKey: 'video-task-1:opening:0',
              index: 0,
              latencyMs: 1_000,
              prompt: '门店开场',
              providerCost: {
                amount: 0.2,
                currency: 'CNY',
                id: 'provider-cost-1',
                status: 'observed',
                usage: { mediaUnits: 1 },
              },
              providerCosts: [],
              routeSnapshot: {} as never,
              status: 'completed',
            },
          ],
          candidatesPerShot: 1,
          id: 'opening',
          prompt: '门店开场',
        },
      ],
      status: 'completed',
      storyboardRevision: 'story-1',
      storyboardVersion: 1,
      updatedAt: '2026-07-20T00:01:00.000Z',
      workspaceId: 'workspace-1',
    } as DurableVideoWorkflow;
    const quote = () =>
      ({
        lifecycleStatus,
        quoteId: 'quote-1',
        revision: workflow.billingQuoteRevision,
        taskId: workflow.billingTaskId,
        workspaceId: workflow.workspaceId,
      }) as ProductQuoteSnapshot;
    const billing = {
      getQuoteByTask() {
        return quote();
      },
      getUsage() {
        return {
          id: 'usage-video-1',
          quantity: 1,
          status: 'committed',
        };
      },
      settleTask(input: unknown) {
        settleCalls.push(input);
        lifecycleStatus = 'settled';
      },
    } as unknown as DurableInitialVideoBilling;
    const observer = createInitialVideoTerminalObserver({ billing });

    const first = await observer.settle(workflow);
    const replay = await observer.settle(workflow);

    assert.equal(settleCalls.length, 1);
    assert.deepEqual(settleCalls[0], {
      attemptId: attempt.id,
      deploymentId: attempt.deploymentId,
      providerCost: {
        currency: 'CNY',
        evidence: 'composedVideoProviderCost=provider-cost-1',
        evidenceKind: 'provider_bill',
        observedCostMicros: 200_000,
        payer: 'platform',
        supplierPriceRevision: 'unknown',
        unit: 'request',
        unitPriceMicros: 0,
        usageQuantity: 1,
        usageUnit: 'media_unit',
      },
      status: 'completed',
      taskId: 'video-task-1',
      workspaceId: 'workspace-1',
    });
    assert.equal((first as { usage: { quantity: number } }).usage.quantity, 1);
    assert.equal((replay as { usage: { quantity: number } }).usage.quantity, 1);
  });

  it('notifies real billing after retained ContentPackage reconciliation, including replay', async () => {
    const order: string[] = [];
    const reconciled = new Set<string>();
    let lifecycleStatus: ProductQuoteSnapshot['lifecycleStatus'] = 'confirmed';
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [],
      billingQuoteRevision: 'quote-r1',
      billingTaskId: 'video-task-1',
      catalogModelId: 'seedance-2',
      clipAssets: [],
      confirmed: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      dataClass: [],
      failureCode: 'VIDEO_PROVIDER_FAILED',
      id: 'video-task-1',
      revision: 2,
      shots: [],
      status: 'failed',
      storyboardRevision: 'story-1',
      storyboardVersion: 1,
      updatedAt: '2026-07-20T00:01:00.000Z',
      workspaceId: 'workspace-1',
    } as DurableVideoWorkflow;
    const quote = () =>
      ({
        lifecycleStatus,
        quoteId: 'quote-1',
        revision: workflow.billingQuoteRevision,
        taskId: workflow.billingTaskId,
        workspaceId: workflow.workspaceId,
      }) as ProductQuoteSnapshot;
    const billing = {
      async failAndRefund(input: { reason?: string }) {
        order.push(`billing:refund:${input.reason}`);
        lifecycleStatus = 'refunded';
        return { quote: quote(), usage: {} };
      },
      getQuoteByTask() {
        order.push(`billing:quote:${lifecycleStatus}`);
        return quote();
      },
      getUsage() {
        order.push('billing:usage');
        return null;
      },
    } as unknown as DurableInitialVideoBilling;
    const terminalObservers = composeVideoTerminalObservers(
      {
        async settle(terminal) {
          order.push(`content-package-observer:${terminal.status}`);
          if (!reconciled.has(terminal.id)) {
            reconciled.add(terminal.id);
            order.push(`content-package:${terminal.status}`);
          }
        },
      },
      createInitialVideoTerminalObserver({ billing }),
    );

    await terminalObservers.settle(workflow);
    await terminalObservers.settle(workflow);

    assert.deepEqual(order, [
      'content-package-observer:failed',
      'content-package:failed',
      'billing:quote:confirmed',
      'billing:refund:initial_video_failed_before_attempt',
      'content-package-observer:failed',
      'billing:quote:refunded',
      'billing:usage',
    ]);
  });
});
