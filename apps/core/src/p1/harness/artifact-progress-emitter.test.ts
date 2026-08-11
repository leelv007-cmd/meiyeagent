/**
 * V31-14 producer: artifact.revised wire passes contracts artifactUpdateWireSchema.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyArtifactUpdate,
  artifactUpdateWireSchema,
  type ArtifactUpdateWire,
} from '@meiye/contracts';

import {
  buildNotePageArtifactUpdate,
  buildVideoSceneArtifactUpdate,
  emitNotePageArtifactProgress,
  emitVideoSceneArtifactProgress,
  emitVideoScenesArtifactProgress,
  nonBlockingArtifactEmitter,
  toArtifactRevisedCandidate,
} from './artifact-progress-emitter.js';
import {
  AgentSemanticEventStoreError,
  type SemanticEventCandidate,
} from '../agent-semantic-events/semantic-event-store.js';

test('note page first revision is a production snapshot', () => {
  const update = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'page-1',
    stage: 'image',
    state: 'success',
    revision: 1,
    title: '封面',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  const parsed = artifactUpdateWireSchema.parse(update);
  assert.equal(parsed.mode, 'snapshot');
  assert.equal(parsed.artifactType, 'note');
  assert.equal(parsed.revision, 1);
});

test('video scene delta parses artifactUpdateWireSchema', () => {
  const update = buildVideoSceneArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'video:pkg-1',
    sceneIndex: 0,
    state: 'running',
    revision: 2,
    storyboard: '开场',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  const parsed = artifactUpdateWireSchema.parse(update);
  assert.equal(parsed.mode, 'delta');
  assert.equal(parsed.artifactType, 'video');
});

test('toArtifactRevisedCandidate eventType=artifact.revised and payload re-parses', () => {
  const update = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 1,
    pageId: 'page-2',
    stage: 'copy',
    state: 'success',
    revision: 3,
    body: '周末护理限时',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  const candidate = toArtifactRevisedCandidate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    update,
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(candidate.eventType, 'artifact.revised');
  assert.equal(candidate.sourceDomain, 'make_harness.artifact');
  const again = artifactUpdateWireSchema.parse(candidate.payload);
  assert.equal(again.artifactId, 'note:pkg-1');
});

test('note page three stages emit skeleton → copy → image with consistent artifactId and monotonic revisions', () => {
  const skeleton = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'p1',
    stage: 'skeleton',
    state: 'running',
    revision: 1,
    title: '封面',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  if (skeleton.mode !== 'snapshot') throw new Error('expected snapshot');
  if (!('pages' in skeleton.full)) throw new Error('expected note full body');
  assert.equal(skeleton.full.pages?.[0]?.stage, 'skeleton');
  assert.equal(skeleton.full.pages?.[0]?.imageStatus, undefined);

  const copy = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'p1',
    stage: 'copy',
    state: 'success',
    revision: 2,
    title: '封面',
    body: '周末护理限时',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  if (copy.mode !== 'delta') throw new Error('expected delta');
  if (!('pages' in copy.patch)) throw new Error('expected note patch');
  assert.equal(copy.patch.pages?.[0]?.stage, 'copy');
  assert.equal(copy.patch.pages?.[0]?.body, '周末护理限时');

  const image = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'p1',
    stage: 'image',
    state: 'running',
    revision: 3,
    title: '封面',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  if (image.mode !== 'delta') throw new Error('expected delta');
  if (!('pages' in image.patch)) throw new Error('expected note patch');
  assert.equal(image.patch.pages?.[0]?.stage, 'image');
  assert.equal(image.patch.pages?.[0]?.imageStatus, 'generating');

  // applyArtifactUpdate in-place reconciliation: same artifactId, stages advance.
  let state = applyArtifactUpdate(null, artifactUpdateWireSchema.parse(skeleton));
  assert.equal(state.ok, true);
  if (!state.ok) return;
  state = applyArtifactUpdate(state.state, artifactUpdateWireSchema.parse(copy));
  assert.equal(state.ok, true);
  if (!state.ok) return;
  state = applyArtifactUpdate(state.state, artifactUpdateWireSchema.parse(image));
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.state.revision, 3);
  assert.ok('pages' in state.state.body);
  if ('pages' in state.state.body) {
    assert.equal(state.state.body.pages[0]?.stage, 'image');
    assert.equal(state.state.body.pages[0]?.title, '封面');
    assert.equal(state.state.body.pages[0]?.body, '周末护理限时');
    assert.equal(state.state.body.pages[0]?.imageStatus, 'generating');
  }
});

test('emitNotePageArtifactProgress projects once when emitter present', async () => {
  const projected: SemanticEventCandidate[] = [];
  const update = await emitNotePageArtifactProgress(
    {
      async project(candidate) {
        projected.push(candidate);
        return { replayed: false };
      },
    },
    {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      threadId: 'thread-1',
      artifactId: 'note:pkg-1',
      pageIndex: 0,
      pageId: 'p1',
      stage: 'image',
      state: 'success',
      revision: 1,
      occurredAt: '2026-08-08T12:00:00.000Z',
    },
  );
  assert.ok(update);
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.eventType, 'artifact.revised');
  artifactUpdateWireSchema.parse(projected[0]?.payload);
});

test('video scene batch emits every scene with monotonic revisions (running then success)', async () => {
  const projected: SemanticEventCandidate[] = [];
  const emitter = {
    async project(candidate: SemanticEventCandidate) {
      projected.push(candidate);
    },
  };
  let revision = 0;
  await emitVideoScenesArtifactProgress(emitter, {
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'video:pkg-1',
    scenes: [
      { sceneIndex: 0, storyboard: '开场' },
      { sceneIndex: 1, storyboard: '护理过程' },
    ],
    state: 'running',
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  await emitVideoScenesArtifactProgress(emitter, {
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'video:pkg-1',
    scenes: [{ sceneIndex: 0 }, { sceneIndex: 1 }],
    state: 'success',
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    occurredAt: '2026-08-08T12:00:00.000Z',
  });

  assert.equal(projected.length, 4);
  const updates = projected.map((candidate) => {
    assert.equal(candidate.eventType, 'artifact.revised');
    return artifactUpdateWireSchema.parse(candidate.payload);
  });
  const revisions = updates.map((update) => update.revision);
  assert.deepEqual(revisions, [1, 2, 3, 4]);
  assert.equal(new Set(updates.map((update) => update.artifactId)).size, 1);
  let state = applyArtifactUpdate(null, updates[0]!);
  for (const update of updates.slice(1)) {
    const applied = applyArtifactUpdate(state.ok ? state.state : null, update);
    if (applied.ok) state = applied;
  }
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.state.revision, 4);
  assert.ok('scenes' in state.state.body);
  if ('scenes' in state.state.body) {
    assert.equal(state.state.body.scenes.length, 2);
    assert.equal(state.state.body.scenes[0]?.storyboard, '开场');
    assert.equal(state.state.body.scenes[0]?.keyframeStatus, 'ready');
    assert.equal(state.state.body.scenes[1]?.keyframeStatus, 'ready');
  }
});

test('V31-36 video batch can mark one scene failed and land status=partial', async () => {
  const projected: SemanticEventCandidate[] = [];
  const emitter = {
    async project(candidate: SemanticEventCandidate) {
      projected.push(candidate);
    },
  };
  let revision = 0;
  await emitVideoScenesArtifactProgress(emitter, {
    workspaceId: 'ws-1',
    workflowId: 'wf-partial',
    threadId: 'thread-1',
    artifactId: 'video:pkg-partial',
    scenes: [
      { sceneIndex: 0, state: 'success' },
      { sceneIndex: 1, state: 'success' },
      { sceneIndex: 2, state: 'failed' },
    ],
    state: 'success',
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    occurredAt: '2026-08-11T12:00:00.000Z',
  });
  const updates = projected.map((candidate) =>
    artifactUpdateWireSchema.parse(candidate.payload),
  );
  assert.equal(updates.at(-1)?.status, 'partial');
  let state = applyArtifactUpdate(null, updates[0]!);
  for (const update of updates.slice(1)) {
    const applied = applyArtifactUpdate(state.ok ? state.state : null, update);
    if (applied.ok) state = applied;
  }
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.ok('scenes' in state.state.body);
  if ('scenes' in state.state.body) {
    assert.equal(state.state.body.scenes[2]?.keyframeStatus, 'failed');
  }
});

test('first-frame note/video updates are reconstructable snapshots', () => {
  const note = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'page-1',
    stage: 'skeleton',
    state: 'running',
    revision: 1,
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(note.mode, 'snapshot');

  const video = buildVideoSceneArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'video:pkg-1',
    sceneIndex: 0,
    state: 'running',
    revision: 1,
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(video.mode, 'snapshot');
});

test('emit without emitter is no-op', async () => {
  const note = await emitNotePageArtifactProgress(undefined, {
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'p1',
    stage: 'image',
    state: 'success',
    revision: 1,
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(note, null);
  const video = await emitVideoSceneArtifactProgress(undefined, {
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'video:pkg-1',
    sceneIndex: 0,
    state: 'success',
    revision: 1,
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(video, null);
  void (null as unknown as ArtifactUpdateWire);
});

const boundaryCandidate: SemanticEventCandidate = {
  eventId: 'artifact.revised:workflow-1:artifact-1:r1',
  threadId: 'thread-1',
  resourceId: 'workspace-1',
  contextRole: 'included',
  sourceDomain: 'make_harness.artifact',
  sourceEntityId: 'artifact-1',
  sourceRevision: '1',
  correlationId: 'corr-1',
  eventType: 'artifact.revised',
  payload: { revision: 1 },
  occurredAt: '2026-08-11T00:00:00.000Z',
};

test('non-blocking artifact emission rethrows a typed semantic boundary conflict', async () => {
  const conflict = new AgentSemanticEventStoreError(
    'AGENT_SEMANTIC_EVENT_CONFLICT',
    'Semantic event is already projected under another boundary.',
    { eventId: boundaryCandidate.eventId, threadId: boundaryCandidate.threadId },
  );
  const dropped: unknown[] = [];
  const emitter = nonBlockingArtifactEmitter(
    {
      async project() {
        throw conflict;
      },
    },
    (error) => dropped.push(error),
  );

  await assert.rejects(
    emitter.project(boundaryCandidate),
    (error: unknown) => error === conflict,
  );
  assert.deepEqual(dropped, []);
});

test('non-blocking artifact emission still drops transient projector failures', async () => {
  const transient = new Error('projector unavailable');
  const dropped: unknown[] = [];
  const emitter = nonBlockingArtifactEmitter(
    {
      async project() {
        throw transient;
      },
    },
    (error) => dropped.push(error),
  );

  assert.equal(await emitter.project(boundaryCandidate), undefined);
  assert.deepEqual(dropped, [transient]);
});
