import assert from 'node:assert/strict';
import test from 'node:test';

import type { PendingAction } from '@meiye/contracts';
import type { OperationsWorkspaceState } from '../operations/types.js';
import { ResultDeliveryProjectionService } from './result-delivery-projection-service.js';

const workspace = {
  workspaceId: 'ws-1',
  creativeWorks: [
    {
      id: 'work-1',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      intent: '夏季美甲图文',
      mode: 'direct',
      operation: 'image.generate',
      sourceReferences: [],
      status: 'completed',
      currentJobId: 'job-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T02:00:00.000Z',
    },
    {
      id: 'work-2',
      workspaceId: 'ws-1',
      sessionId: 'session-2',
      intent: '15 秒视频',
      mode: 'direct',
      operation: 'video.generate',
      sourceReferences: [],
      status: 'running',
      currentJobId: 'job-2',
      createdAt: '2026-07-20T01:00:00.000Z',
      updatedAt: '2026-07-20T03:00:00.000Z',
    },
  ],
  creativeJobs: [
    {
      id: 'job-1',
      workspaceId: 'ws-1',
      workId: 'work-1',
      status: 'completed',
      contract: {},
      submissionKey: 'submit-1',
      outputAssetIds: [],
      outputContentIds: ['content-1'],
      createdAt: '2026-07-20T00:30:00.000Z',
      updatedAt: '2026-07-20T02:00:00.000Z',
    },
    {
      id: 'job-2',
      workspaceId: 'ws-1',
      workId: 'work-2',
      status: 'unknown',
      contract: {},
      submissionKey: 'submit-2',
      outputAssetIds: [],
      outputContentIds: [],
      createdAt: '2026-07-20T01:30:00.000Z',
      updatedAt: '2026-07-20T03:00:00.000Z',
    },
  ],
  creativeAssets: [
    {
      id: 'asset-1',
      workId: 'work-1',
      workspaceId: 'ws-1',
    },
  ],
  contentPackages: [
    {
      id: 'package-1',
      workspaceId: 'ws-1',
      source: { workId: 'work-1' },
      versions: [{ id: 'version-1' }],
      variants: [],
      deliveryEvents: [
        {
          id: 'delivery-1',
          type: 'manual_publish_result',
          status: 'published',
          occurredAt: '2026-07-20T04:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-20T04:00:00.000Z',
    },
    {
      id: 'legacy-package',
      workspaceId: 'ws-1',
      source: {},
      versions: [{ id: 'legacy-version' }],
      variants: [],
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
  ],
  tasks: [],
} as unknown as OperationsWorkspaceState;

const pending: PendingAction = {
  kind: 'question',
  createdAt: '2026-07-20T01:00:00.000Z',
  nodeId: 'question-1',
  questionOrApprovalRef: 'question-1',
  taskId: 'job-2',
  workflowId: 'workflow-2',
  workflowRevision: 1,
};

function service(hasMembership = true) {
  return new ResultDeliveryProjectionService(
    {
      async hasMembership() {
        return hasMembership;
      },
      async loadWorkspace(workspaceId) {
        return workspaceId === 'ws-1' ? workspace : null;
      },
    },
    {
      async list() {
        return [pending];
      },
    },
  );
}

test('resolves active and legacy targets from canonical Operations state', async () => {
  const active = await service().resolveTarget({
    userId: 'owner-1',
    workspaceId: 'ws-1',
    target: {
      workId: 'work-1',
      contentId: 'package-1',
      versionId: 'version-1',
    },
  });
  assert.equal(active.kind, 'ok');

  const focused = await service().resolveTarget({
    userId: 'owner-1',
    workspaceId: 'ws-1',
    target: { workId: 'work-1', focusKey: 'asset-1' },
  });
  assert.equal(focused.kind, 'ok');

  const foreignFocus = await service().resolveTarget({
    userId: 'owner-1',
    workspaceId: 'ws-1',
    target: { workId: 'work-1', focusKey: 'asset-from-another-work' },
  });
  assert.equal(foreignFocus.kind, 'lineage_mismatch');

  const legacy = await service().resolveTarget({
    userId: 'owner-1',
    workspaceId: 'ws-1',
    target: {
      workId: '',
      contentId: 'legacy-package',
      versionId: 'legacy-version',
    },
  });
  assert.equal(legacy.kind, 'legacy_readonly');

  const forbidden = await service(false).resolveTarget({
    userId: 'outsider',
    workspaceId: 'ws-1',
    target: { workId: 'work-1' },
  });
  assert.equal(forbidden.kind, 'forbidden');
});

test('projects Recent and actionable inbox from Operations and PendingActions truth', async () => {
  const recent = await service().listRecent({
    userId: 'owner-1',
    workspaceId: 'ws-1',
    viewport: 'desktop',
  });
  assert.deepEqual(
    recent.map((item) => [item.workId, item.phase, item.medium]),
    [
      ['work-1', 'delivered', 'image_text'],
      ['work-2', 'needs_input', 'video'],
    ],
  );
  assert.equal(recent[0]?.target.contentId, 'package-1');

  const inbox = await service().listActionableInbox({
    userId: 'owner-1',
    workspaceId: 'ws-1',
  });
  assert.ok(inbox.some((item) => item.statusKind === 'result_available'));
  assert.ok(
    inbox.some((item) => item.statusKind === 'acceptance_unknown_recovery'),
  );
  assert.ok(inbox.some((item) => item.statusKind === 'delivery_completed'));
  assert.ok(inbox.some((item) => item.statusKind === 'needs_choice_or_confirm'));
  assert.ok(
    inbox.every(
      (item) => item.eventSource.kind !== 'pending_action' || item.target?.workId === 'work-2',
    ),
  );
});
