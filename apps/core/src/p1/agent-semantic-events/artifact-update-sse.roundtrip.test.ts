/**
 * V31-15: ArtifactUpdate SSE round-trip via V31-03 encode/replay seams.
 * Projector → SSE frame → parse → wire schema → applyArtifactUpdate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventToWire,
  applyArtifactUpdate,
  artifactUpdateWireSchema,
  type ArtifactProjectionState,
  type ArtifactUpdateWire,
} from '@meiye/contracts';

import {
  encodeAgentSemanticSseFrame,
  semanticFrameFromDomain,
} from './agent-semantic-frames.js';
import { MemoryAgentSemanticEventStore } from './memory-semantic-event-store.js';
import { AgentSemanticEventProjector } from './semantic-event-projector.js';
import type { SemanticEventCandidate } from './semantic-event-store.js';

const RESOURCE = 'resource-artifact-sse';
const THREAD = 'thread-artifact-sse';
const TS = '2026-08-08T12:00:00.000Z';

function candidate(
  overrides: Partial<SemanticEventCandidate> &
    Pick<SemanticEventCandidate, 'eventId' | 'payload'>,
): SemanticEventCandidate {
  return {
    resourceId: RESOURCE,
    threadId: THREAD,
    contextRole: 'included',
    sourceDomain: 'content_package',
    sourceEntityId: 'pkg-1',
    sourceRevision: '1',
    correlationId: 'corr-art',
    eventType: 'artifact.revised',
    occurredAt: TS,
    ...overrides,
  };
}

function parseSseData(frameText: string): unknown {
  const line = frameText
    .split('\n')
    .find((row) => row.startsWith('data: '));
  assert.ok(line, 'SSE frame must include data line');
  return JSON.parse(line.slice('data: '.length));
}

test('ArtifactUpdate SSE round-trip: snapshot → delta → same-revision idempotent', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const snapPayload: ArtifactUpdateWire = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 1,
    status: 'skeleton',
    full: {
      pages: [
        { pageIndex: 0, stage: 'skeleton' },
        { pageIndex: 1, stage: 'skeleton' },
      ],
    },
  });

  const deltaPayload: ArtifactUpdateWire = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 2,
    status: 'partial',
    baseRevision: 1,
    patch: {
      pages: [
        {
          pageIndex: 0,
          stage: 'copy',
          title: '封面',
          body: '周末护理限时',
        },
      ],
    },
  });

  const p1 = await projector.project(
    candidate({ eventId: 'art-evt-1', payload: snapPayload }),
  );
  const p2 = await projector.project(
    candidate({ eventId: 'art-evt-2', payload: deltaPayload }),
  );
  assert.equal(p1.replayed, false);
  assert.equal(p2.replayed, false);

  // Encode as SSE frames (V31-03 seam)
  const frame1 = encodeAgentSemanticSseFrame(semanticFrameFromDomain(p1.event));
  const frame2 = encodeAgentSemanticSseFrame(semanticFrameFromDomain(p2.event));
  assert.match(frame1, /event: agent\.semantic/u);
  assert.match(frame2, /event: agent\.semantic/u);

  const wire1 = agentSemanticEventToWire(p1.event);
  const wire2 = agentSemanticEventToWire(p2.event);
  // Parsed from SSE data must match wire
  const fromSse1 = parseSseData(frame1) as typeof wire1;
  const fromSse2 = parseSseData(frame2) as typeof wire2;
  assert.equal(fromSse1.eventId, wire1.eventId);
  assert.equal(fromSse2.eventType, 'artifact.revised');

  let state: ArtifactProjectionState | null = null;
  const u1 = artifactUpdateWireSchema.parse(fromSse1.payload);
  const r1 = applyArtifactUpdate(state, u1);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  state = r1.state;

  const u2 = artifactUpdateWireSchema.parse(fromSse2.payload);
  const r2 = applyArtifactUpdate(state, u2);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  state = r2.state;
  assert.equal(state.revision, 2);
  assert.ok('pages' in state.body && state.body.pages[0]?.body === '周末护理限时');

  // same revision re-apply via replayed project
  const replay = await projector.project(
    candidate({ eventId: 'art-evt-2', payload: deltaPayload }),
  );
  assert.equal(replay.replayed, true);
  const rDup = applyArtifactUpdate(
    state,
    artifactUpdateWireSchema.parse(agentSemanticEventToWire(replay.event).payload),
  );
  assert.equal(rDup.ok, true);
  if (!rDup.ok) return;
  assert.equal(rDup.duplicate, true);
  assert.equal(rDup.state.revision, 2);
});

test('ArtifactUpdate SSE: skip revision fails apply → snapshot fallback via replay package', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  await projector.project(
    candidate({
      eventId: 's1',
      payload: artifactUpdateWireSchema.parse({
        schemaVersion: 'artifact-update/v1',
        mode: 'snapshot',
        artifactId: 'art-note-1',
        artifactType: 'note',
        revision: 1,
        status: 'skeleton',
        full: { pages: [{ pageIndex: 0, stage: 'skeleton' }] },
      }),
    }),
  );

  // Producer advances to rev 3 via snapshot (client missed rev 2)
  await projector.project(
    candidate({
      eventId: 's3',
      payload: artifactUpdateWireSchema.parse({
        schemaVersion: 'artifact-update/v1',
        mode: 'snapshot',
        artifactId: 'art-note-1',
        artifactType: 'note',
        revision: 3,
        status: 'partial',
        full: {
          pages: [
            { pageIndex: 0, stage: 'copy', body: '完整快照' },
            { pageIndex: 1, stage: 'copy', body: '第二页' },
          ],
        },
      }),
    }),
  );

  // Live client at rev 1 receives a skipped delta → needs_snapshot
  let state: ArtifactProjectionState | null = null;
  const head = applyArtifactUpdate(
    null,
    artifactUpdateWireSchema.parse({
      schemaVersion: 'artifact-update/v1',
      mode: 'snapshot',
      artifactId: 'art-note-1',
      artifactType: 'note',
      revision: 1,
      status: 'skeleton',
      full: { pages: [{ pageIndex: 0, stage: 'skeleton' }] },
    }),
  );
  assert.equal(head.ok, true);
  if (!head.ok) return;
  state = head.state;

  const skipped = applyArtifactUpdate(
    state,
    artifactUpdateWireSchema.parse({
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-note-1',
      artifactType: 'note',
      revision: 3,
      status: 'partial',
      baseRevision: 2,
      patch: { pages: [{ pageIndex: 0, stage: 'copy', body: '丢包' }] },
    }),
  );
  assert.equal(skipped.ok, false);
  if (skipped.ok) return;
  assert.equal(skipped.reason, 'needs_snapshot');

  // Fallback: full durable stream (loadReplay without cursor returns empty
  // events by design — snapshot is complete; list store for resync rebuild).
  const durable = await store.listByThread({
    resourceId: RESOURCE,
    threadId: THREAD,
  });
  assert.ok(durable.length >= 2);

  let rebuilt: ArtifactProjectionState | null = null;
  for (const event of durable) {
    if (event.eventType !== 'artifact.revised') continue;
    const update = artifactUpdateWireSchema.parse(
      agentSemanticEventToWire(event).payload,
    );
    const applied = applyArtifactUpdate(rebuilt, update);
    if (!applied.ok) {
      // mid-stream delta without base: continue; later snapshot wins.
      continue;
    }
    rebuilt = applied.state;
  }
  assert.ok(rebuilt);
  assert.equal(rebuilt.revision, 3);
  assert.ok(
    'pages' in rebuilt.body && rebuilt.body.pages[0]?.body === '完整快照',
  );
});

test('ArtifactUpdate SSE: cold delta first frame bootstraps client projection', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const coldDelta: ArtifactUpdateWire = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 1,
    status: 'partial',
    baseRevision: 0,
    patch: {
      pages: [
        { pageIndex: 0, stage: 'image', title: '封面', imageStatus: 'ready' },
      ],
    },
  });

  const projected = await projector.project(
    candidate({ eventId: 'cold-1', payload: coldDelta }),
  );
  const frame = encodeAgentSemanticSseFrame(
    semanticFrameFromDomain(projected.event),
  );
  const wire = agentSemanticEventToWire(projected.event);
  const update = artifactUpdateWireSchema.parse(
    (parseSseData(frame) as { payload: unknown }).payload,
  );
  assert.equal(update.mode, 'delta');
  assert.equal(update.revision, 1);

  // Cold client: baseRevision=0 delta bootstraps instead of needs_snapshot —
  // the resync replay of the same frame converges instead of looping.
  const applied = applyArtifactUpdate(null, update);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.state.revision, 1);
  assert.ok('pages' in applied.state.body);
  if ('pages' in applied.state.body) {
    assert.equal(applied.state.body.pages[0]?.imageStatus, 'ready');
  }

  // same frame re-apply idempotent (replay convergence)
  const again = applyArtifactUpdate(
    applied.state,
    artifactUpdateWireSchema.parse(wire.payload),
  );
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicate, true);
});

test('ArtifactUpdate SSE reconnect streamReplay frames decode cleanly', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  await projector.project(
    candidate({
      eventId: 'r1',
      payload: artifactUpdateWireSchema.parse({
        schemaVersion: 'artifact-update/v1',
        mode: 'snapshot',
        artifactId: 'art-vid-1',
        artifactType: 'video',
        revision: 1,
        status: 'partial',
        full: {
          scenes: [
            {
              sceneIndex: 0,
              storyboard: '开场',
              keyframeStatus: 'pending',
            },
          ],
        },
      }),
    }),
  );

  const frames: string[] = [];
  for await (const frame of projector.streamReplay({
    session: {
      resourceId: RESOURCE,
      threadId: THREAD,
      sessionRevision: 1,
    },
  })) {
    frames.push(encodeAgentSemanticSseFrame(frame));
  }
  assert.ok(frames.length >= 1);
  const semantic = frames.find((f) => f.includes('event: agent.semantic'));
  assert.ok(semantic);
  const data = parseSseData(semantic!) as { eventType: string; payload: unknown };
  assert.equal(data.eventType, 'artifact.revised');
  const update = artifactUpdateWireSchema.parse(data.payload);
  assert.equal(update.artifactType, 'video');
  assert.equal(update.mode, 'snapshot');
});
