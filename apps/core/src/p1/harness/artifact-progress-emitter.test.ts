/**
 * V31-14 producer: artifact.revised wire passes contracts artifactUpdateWireSchema.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactUpdateWireSchema,
  type ArtifactUpdateWire,
} from '@meiye/contracts';

import {
  buildNotePageArtifactUpdate,
  buildVideoSceneArtifactUpdate,
  emitNotePageArtifactProgress,
  emitVideoSceneArtifactProgress,
  toArtifactRevisedCandidate,
} from './artifact-progress-emitter.js';
import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';

test('note page delta parses artifactUpdateWireSchema', () => {
  const update = buildNotePageArtifactUpdate({
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'page-1',
    state: 'success',
    revision: 1,
    title: '封面',
    occurredAt: '2026-08-08T12:00:00.000Z',
  });
  const parsed = artifactUpdateWireSchema.parse(update);
  assert.equal(parsed.mode, 'delta');
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
    state: 'running',
    revision: 3,
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

test('emit without emitter is no-op', async () => {
  const note = await emitNotePageArtifactProgress(undefined, {
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    threadId: 'thread-1',
    artifactId: 'note:pkg-1',
    pageIndex: 0,
    pageId: 'p1',
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
