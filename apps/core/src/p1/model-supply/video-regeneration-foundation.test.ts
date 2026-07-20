import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import {
  VideoRegenerationFoundationModule,
  type VideoRegenerationApplicationPort,
} from './video-regeneration-foundation.js';

const context: P1Context = {
  correlationId: 'corr-1',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
};

function fixture() {
  const calls: Array<{ action: string; input: unknown }> = [];
  const application: VideoRegenerationApplicationPort = {
    async quote(input) {
      calls.push({ action: 'quote', input });
      return { quoteId: 'quote-1' };
    },
    async confirmAndDispatch(input) {
      calls.push({ action: 'confirm', input });
      return { taskId: 'task-1' };
    },
    async recover(input) {
      calls.push({ action: 'recover', input });
      return { taskId: 'task-1' };
    },
    async retry(input) {
      calls.push({ action: 'retry', input });
      return { taskId: 'task-retry' };
    },
    async executeFreeAction(input) {
      calls.push({ action: 'free_action', input });
      return { productUsageTouched: false };
    },
    async getTask(workspaceId, taskId) {
      calls.push({ action: 'get_task', input: { taskId, workspaceId } });
      return { taskId };
    },
  };
  return {
    calls,
    module: new VideoRegenerationFoundationModule(application),
  };
}

describe('video regeneration FoundationModule', () => {
  it('uses trusted context identity for quote and confirm commands', async () => {
    const { calls, module } = fixture();
    assert.equal(module.name, 'video-regeneration');

    await module.execute({
      context,
      idempotencyKey: 'idem-quote',
      input: {
        action: 'quote',
        payload: {
          actorId: 'attacker',
          scope: 'shot',
          shotId: 'opening',
          sourceRunId: 'source-1',
          workspaceId: 'other-workspace',
        },
      },
      store: {} as never,
    });
    await module.execute({
      context,
      idempotencyKey: 'idem-confirm',
      input: {
        action: 'confirm',
        payload: {
          approvalReceiptId: 'approval-1',
          quoteId: 'quote-1',
          taskId: 'task-1',
          workspaceId: 'other-workspace',
        },
      },
      store: {} as never,
    });

    assert.deepEqual(calls, [
      {
        action: 'quote',
        input: {
          actorId: 'owner-1',
          requestId: 'idem-quote',
          scope: 'shot',
          shotId: 'opening',
          sourceRunId: 'source-1',
          workspaceId: 'workspace-1',
        },
      },
      {
        action: 'confirm',
        input: {
          approvalReceiptId: 'approval-1',
          quoteId: 'quote-1',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
        },
      },
    ]);
  });

  it('routes free recovery actions and task queries without accepting payload identity', async () => {
    const { calls, module } = fixture();
    await module.execute({
      context,
      idempotencyKey: 'idem-recover',
      input: {
        action: 'recover',
        payload: { supplierTaskRef: 'supplier-1', taskId: 'task-1' },
      },
      store: {} as never,
    });
    await module.execute({
      context,
      idempotencyKey: 'idem-free',
      input: {
        action: 'free_action',
        payload: { action: 'poll', taskId: 'task-1' },
      },
      store: {} as never,
    });
    await module.execute({
      context,
      idempotencyKey: 'idem-retry',
      input: {
        action: 'retry',
        payload: {
          actorId: 'attacker',
          quoteId: 'quote-retry',
          scope: 'shot',
          shotId: 'opening',
          sourceRunId: 'source-1',
          taskId: 'task-retry',
          workspaceId: 'other-workspace',
        },
      },
      store: {} as never,
    });
    await module.query!({
      context,
      input: { action: 'get_task', payload: { taskId: 'task-1' } },
      store: {} as never,
    });

    assert.deepEqual(calls, [
      {
        action: 'recover',
        input: {
          actorId: 'owner-1',
          supplierTaskRef: 'supplier-1',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
        },
      },
      {
        action: 'free_action',
        input: {
          action: 'poll',
          actorId: 'owner-1',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
        },
      },
      {
        action: 'retry',
        input: {
          actorId: 'owner-1',
          quoteId: 'quote-retry',
          requestId: 'idem-retry',
          scope: 'shot',
          shotId: 'opening',
          sourceRunId: 'source-1',
          taskId: 'task-retry',
          workspaceId: 'workspace-1',
        },
      },
      {
        action: 'get_task',
        input: { taskId: 'task-1', workspaceId: 'workspace-1' },
      },
    ]);
  });

  it('rejects a paid retry that omits its fresh quote id', async () => {
    const { module } = fixture();
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: 'idem-retry-missing-quote',
        input: {
          action: 'retry',
          payload: {
            scope: 'shot',
            shotId: 'opening',
            sourceRunId: 'source-1',
            taskId: 'task-retry',
          },
        },
        store: {} as never,
      }),
      /quoteId/,
    );
  });

  it('rejects browser pricing, policy, route, deployment, and ceiling fields', async () => {
    const { module } = fixture();
    for (const forged of [
      { unitRate: 0 },
      { billingMode: 'per_request' },
      { quotePolicyRevision: 'attacker-policy' },
      { routeSnapshotRef: 'attacker-route' },
      { frozenCandidateDeploymentIds: ['attacker-deployment'] },
      { authorizedCeiling: 0 },
      { targetSeconds: 1 },
      { catalogModelId: 'attacker-model' },
    ]) {
      await assert.rejects(
        module.execute({
          context,
          idempotencyKey: `forged-${Object.keys(forged)[0]}`,
          input: {
            action: 'quote',
            payload: {
              scope: 'shot',
              shotId: 'opening',
              sourceRunId: 'source-1',
              ...forged,
            },
          },
          store: {} as never,
        }),
      );
    }
  });
});
