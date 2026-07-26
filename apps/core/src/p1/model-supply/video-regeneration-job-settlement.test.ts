import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProductQuoteSnapshot } from '@meiye/contracts';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';
import {
  composeVideoTerminalObservers,
  createInitialVideoTerminalObserver,
  type DurableInitialVideoBilling,
} from './video-workflow-billing.js';

describe('video regeneration worker settlement', () => {
  it('notifies real billing after retained ContentPackage reconciliation, including replay', async () => {
    const order: string[] = [];
    const reconciled = new Set<string>();
    let lifecycleStatus: ProductQuoteSnapshot['lifecycleStatus'] = 'confirmed';
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [],
      billingQuoteRevision: 'quote-r1',
      billingTaskId: 'regen-task-1',
      catalogModelId: 'seedance-2',
      clipAssets: [],
      confirmed: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      dataClass: [],
      failureCode: 'VIDEO_PROVIDER_FAILED',
      id: 'regen-task-1',
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
