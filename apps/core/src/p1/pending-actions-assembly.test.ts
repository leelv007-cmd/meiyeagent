import assert from 'node:assert/strict';
import test from 'node:test';
import { createPendingApprovalRequest } from './operations/content-package-approval.js';
import {
  PendingActionsService,
  type PendingQuestionReader,
} from './pending-actions.js';

/**
 * Assembly-level proof that PendingActionsService does not require harness /
 * DBOS runtime config — Z2-WIRING unconditional platform service.
 * Approvals come from the workspace reader; questions may be empty.
 */
test('pending-actions assembles and lists without harness runtime', async () => {
  const emptyQuestions: PendingQuestionReader = {
    async listPendingQuestions() {
      return [];
    },
  };
  const approval = createPendingApprovalRequest({
    actionKind: 'publish',
    contentPackageRevision: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
    packageId: 'pkg-1',
    platform: 'douyin',
    purpose: 'publish_current_variant',
    taskId: 'task-1',
    variantVersionId: 'douyin-v1',
    workflowId: 'wf-1',
    workflowRevision: 1,
    workspaceId: 'workspace-a',
  });
  const workspaces = {
    async hasMembership(userId: string, workspaceId: string) {
      return userId === 'owner-a' && workspaceId === 'workspace-a';
    },
    async listContentPackages(workspaceId: string) {
      if (workspaceId !== 'workspace-a') return [];
      return [{ approvalRequests: [approval] } as never];
    },
  };

  // No harnessRuntimeConfig / DBOS — pure service assembly.
  const pendingActions = new PendingActionsService(emptyQuestions, workspaces);
  const actions = await pendingActions.list({
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  });

  assert.equal(actions.length, 1);
  assert.ok(actions[0] && 'kind' in actions[0]);
  assert.equal(actions[0].kind, 'approval');
  assert.equal(actions[0].taskId, 'task-1');
});

test('pending-actions empty question reader yields approval-only inbox without harness', async () => {
  const pendingActions = new PendingActionsService(
    {
      async listPendingQuestions() {
        return [];
      },
    },
    {
      async hasMembership() {
        return true;
      },
      async listContentPackages() {
        return [];
      },
    },
  );
  const actions = await pendingActions.list({
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  });
  assert.deepEqual(actions, []);
});
