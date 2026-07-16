import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVideoWorkflowDraft,
  buildVideoWorkflowMutation,
  createAidaStoryboard,
  videoAssetUrl,
  videoWorkflowEffectiveStatus,
  videoWorkflowReviewShots,
  videoWorkflowShouldPoll,
  videoWorkflowSteps,
  videoWorkflowStatusView,
} from './video-workflow-model';

test('builds four editable AIDA shots from the current Work intent', () => {
  const shots = createAidaStoryboard('介绍门店的真实护理体验');

  assert.deepEqual(
    shots.map(({ id, stage }) => ({ id, stage })),
    [
      { id: 'aida-attention', stage: 'attention' },
      { id: 'aida-interest', stage: 'interest' },
      { id: 'aida-desire', stage: 'desire' },
      { id: 'aida-action', stage: 'action' },
    ]
  );
  assert.ok(
    shots.every((shot) => shot.prompt.includes('介绍门店的真实护理体验'))
  );
});

test('locks a stable Work-bound draft with one fixed candidate per shot', () => {
  const input = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    dataClass: ['contains_face'] as const,
    referenceAssetIds: ['asset-store-b', 'asset-store-a', 'asset-store-a'],
    shots: createAidaStoryboard('记录一次美甲到店体验'),
    workId: 'work-a',
  };
  const first = buildVideoWorkflowDraft(input);
  const replay = buildVideoWorkflowDraft(input);

  assert.deepEqual(replay, first);
  assert.equal(first.action, 'video_workflow_create_draft');
  assert.equal(first.payload.workId, 'work-a');
  assert.equal(first.payload.catalogModelId, 'seedance-2');
  assert.equal(first.payload.aigcLabelEnabled, true);
  assert.deepEqual(first.payload.dataClass, ['contains_face']);
  assert.deepEqual(first.payload.referenceAssetIds, [
    'asset-store-a',
    'asset-store-b',
  ]);
  assert.ok(first.payload.workflowId.startsWith('video-workflow-'));
  assert.ok(first.payload.storyboardRevision.startsWith('storyboard-'));
  assert.ok(first.payload.shots.every((shot) => shot.candidatesPerShot === 1));
  assert.equal(first.idempotencyKey, `create:${first.payload.workflowId}`);

  const changed = buildVideoWorkflowDraft({
    ...input,
    shots: input.shots.map((shot, index) =>
      index === 0 ? { ...shot, prompt: `${shot.prompt}补充特写` } : shot
    ),
  });
  assert.notEqual(changed.payload.workflowId, first.payload.workflowId);
  assert.notEqual(
    changed.payload.storyboardRevision,
    first.payload.storyboardRevision
  );

  const changedReference = buildVideoWorkflowDraft({
    ...input,
    referenceAssetIds: ['asset-store-c'],
  });
  assert.notEqual(
    changedReference.payload.workflowId,
    first.payload.workflowId
  );
});

test('creates a new workflow identity when the merchant explicitly derives the same storyboard', () => {
  const input = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    dataClass: [] as const,
    shots: createAidaStoryboard('记录一次美甲到店体验'),
    workId: 'work-a',
  };
  const parent = buildVideoWorkflowDraft(input);
  const derived = buildVideoWorkflowDraft({
    ...input,
    derivedFrom: {
      id: parent.payload.workflowId,
      storyboardVersion: 1,
    },
  });

  assert.equal(
    derived.payload.derivedFromWorkflowId,
    parent.payload.workflowId
  );
  assert.notEqual(derived.payload.workflowId, parent.payload.workflowId);
  assert.equal(
    derived.payload.storyboardRevision,
    parent.payload.storyboardRevision
  );
  assert.equal(derived.idempotencyKey, `create:${derived.payload.workflowId}`);
  assert.deepEqual(
    buildVideoWorkflowDraft({
      ...input,
      derivedFrom: {
        id: parent.payload.workflowId,
        storyboardVersion: 1,
      },
    }),
    derived
  );
});

test('uses honest Chinese states and polls only non-terminal workflows', () => {
  assert.deepEqual(videoWorkflowStatusView('running'), {
    label: '后台生成中',
    description: '已提交后台，可以离开此页，返回后会恢复同一任务。',
    poll: true,
    terminal: false,
  });
  assert.equal(videoWorkflowStatusView('cancel_requested').poll, true);
  assert.equal(videoWorkflowStatusView('completed').poll, false);
  assert.equal(videoWorkflowStatusView('cancelled').terminal, true);
  assert.equal(
    JSON.stringify(videoWorkflowStatusView('running')).includes('%'),
    false
  );
});

test('stops a failed Tracer Job and marks all five steps as failed', () => {
  const workflow = {
    confirmed: true,
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        id: 'aida-attention',
        prompt: '开场',
      },
    ],
    status: 'running' as const,
  };
  const failedEnvelope = {
    job: {
      error: 'provider timeout',
      status: 'failed',
    },
    workflow,
  };

  assert.equal(videoWorkflowEffectiveStatus(failedEnvelope), 'failed');
  assert.equal(videoWorkflowShouldPoll(failedEnvelope), false);
  assert.deepEqual(
    videoWorkflowSteps(workflow, failedEnvelope.job.status).map(
      (step) => step.state
    ),
    ['failed', 'failed', 'failed', 'failed', 'failed']
  );
  assert.deepEqual(videoWorkflowStatusView('failed'), {
    label: '视频任务未完成',
    description:
      '后台执行已停止。请保留当前分镜，返回编辑后新建版本；系统不会自动重投。',
    poll: false,
    terminal: true,
  });

  assert.equal(
    videoWorkflowShouldPoll({
      job: { status: 'running' },
      workflow,
    }),
    true
  );
});

test('maps the durable workflow into five honest visible steps without percentages', () => {
  const shot = {
    candidates: [],
    candidatesPerShot: 1,
    id: 'aida-attention',
    prompt: '开场',
  };
  assert.deepEqual(
    videoWorkflowSteps({
      confirmed: false,
      shots: [shot],
      status: 'draft',
    }).map((step) => step.state),
    ['success', 'running', 'waiting', 'waiting', 'waiting']
  );
  assert.deepEqual(
    videoWorkflowSteps({
      confirmed: true,
      shots: [shot],
      status: 'running',
    }).map((step) => step.state),
    ['success', 'success', 'running', 'waiting', 'waiting']
  );
  assert.deepEqual(
    videoWorkflowSteps({
      confirmed: true,
      shots: [shot],
      status: 'awaiting_quality_review',
    }).map((step) => step.state),
    ['success', 'success', 'success', 'suspended', 'waiting']
  );
  assert.deepEqual(
    videoWorkflowSteps({
      confirmed: true,
      shots: [{ ...shot, selectedCandidateIndex: 0 }],
      status: 'running',
    }).map((step) => step.state),
    ['success', 'success', 'success', 'success', 'running']
  );
  assert.ok(
    videoWorkflowSteps({
      confirmed: true,
      shots: [shot],
      status: 'completed',
    }).every((step) => step.state === 'success')
  );
  assert.doesNotMatch(
    JSON.stringify(
      videoWorkflowSteps({ confirmed: true, shots: [shot], status: 'running' })
    ),
    /%/
  );
});

test('shows candidate selection only for unresolved review shots', () => {
  const workflow = {
    id: 'workflow-a',
    status: 'awaiting_quality_review' as const,
    shots: [
      {
        id: 'aida-attention',
        prompt: '开场',
        candidatesPerShot: 2,
        candidates: [
          {
            index: 0,
            status: 'completed' as const,
            asset: {
              objectKey: 'workspace-a/generated/a.mp4',
              contentType: 'video/mp4' as const,
            },
          },
          { index: 1, status: 'failed' as const },
        ],
      },
      {
        id: 'aida-interest',
        prompt: '细节',
        candidatesPerShot: 2,
        selectedCandidateIndex: 0,
        candidates: [],
      },
    ],
  };

  assert.deepEqual(videoWorkflowReviewShots(workflow), [workflow.shots[0]]);
  assert.deepEqual(
    videoWorkflowReviewShots({ ...workflow, status: 'running' }),
    []
  );
});

test('builds the existing workspace BFF asset URL without exposing a core URL', () => {
  assert.equal(
    videoAssetUrl('workspace-a/composed/video a&b.mp4'),
    '/api/core/p1/assets?objectKey=workspace-a%2Fcomposed%2Fvideo%20a%26b.mp4'
  );
});

test('uses stable command names and keys for confirm, cancel, and one candidate selection', () => {
  assert.deepEqual(buildVideoWorkflowMutation('confirm', 'workflow-a'), {
    action: 'video_workflow_confirm',
    idempotencyKey: 'confirm:workflow-a',
    payload: { workflowId: 'workflow-a' },
  });
  assert.deepEqual(buildVideoWorkflowMutation('cancel', 'workflow-a'), {
    action: 'video_workflow_cancel',
    idempotencyKey: 'cancel:workflow-a',
    payload: { workflowId: 'workflow-a' },
  });
  assert.deepEqual(
    buildVideoWorkflowMutation('select', 'workflow-a', {
      candidateIndex: 2,
      shotId: 'aida-interest',
    }),
    {
      action: 'video_workflow_select_candidate',
      idempotencyKey: 'select:workflow-a:aida-interest:2',
      payload: {
        workflowId: 'workflow-a',
        candidateIndex: 2,
        shotId: 'aida-interest',
      },
    }
  );
});
