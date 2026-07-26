import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DurableVideoWorkflow } from './video-workflow-contract.js';
import { composeVideoTerminalObservers } from './video-workflow-billing.js';

describe('video regeneration worker settlement', () => {
  it('notifies billing after retained ContentPackage reconciliation, including replay', async () => {
    const order: string[] = [];
    const reconciled = new Set<string>();
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [],
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
    const terminalObservers = composeVideoTerminalObservers(
      {
        async settle(terminal) {
          if (!reconciled.has(terminal.id)) {
            reconciled.add(terminal.id);
            order.push(`content-package:${terminal.status}`);
          }
        },
      },
      {
        async settle(terminal) {
          order.push(`billing:${terminal.status}`);
        },
      },
    );

    await terminalObservers.settle(workflow);
    await terminalObservers.settle(workflow);

    assert.deepEqual(order, [
      'content-package:failed',
      'billing:failed',
      'billing:failed',
    ]);
  });
});
