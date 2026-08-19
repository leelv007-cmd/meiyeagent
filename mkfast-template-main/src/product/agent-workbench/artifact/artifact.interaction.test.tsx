/**
 * V31-15 Artifact canvas / mobile sheet behavior.
 */
import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyAgentWorkbenchState,
  projectVisibleArtifacts,
  reduceAgentWorkbench,
  type AgentWorkbenchClientState,
} from '../agent-event-reducer';
import { AgentWorkstream } from '../agent-workstream';
import { ArtifactCanvas } from './artifact-canvas';
import { ArtifactMobileSheet } from './artifact-mobile-sheet';

afterEach(() => {
  cleanup();
});

function wire(overrides: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  payload?: unknown;
}) {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: 't1',
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'c1',
    payload: overrides.payload ?? {},
    occurredAt: '2026-08-08T12:00:00.000Z',
    eventId: overrides.eventId,
    streamOffset: overrides.streamOffset,
    eventType: overrides.eventType,
  });
}

function withNoteArtifact(): AgentWorkbenchClientState {
  let state = createEmptyAgentWorkbenchState();
  state = reduceAgentWorkbench(state, {
    type: 'hydrate_replay',
    session: {
      resourceId: 'r1',
      threadId: 't1',
      sessionRevision: 1,
    },
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [
      wire({
        eventId: 'a1',
        streamOffset: '1',
        eventType: 'artifact.revised',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-note-1',
          artifactType: 'note',
          revision: 2,
          status: 'partial',
          full: {
            pages: [
              {
                pageIndex: 0,
                stage: 'copy',
                title: '封面',
                body: '周末预约',
              },
              { pageIndex: 1, stage: 'skeleton' },
            ],
          },
        },
      }),
    ],
  }).state;
  return state;
}

describe('ArtifactCanvas in-place growth', () => {
  it('renders one note card with page stages (no duplicate cards)', () => {
    const state = withNoteArtifact();
    const artifacts = projectVisibleArtifacts(state);
    render(<ArtifactCanvas artifacts={artifacts} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-note')).toBeTruthy();
    const pages = screen.getAllByTestId('agent-artifact-note-page');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveAttribute('data-page-stage', 'copy');
    expect(pages[1]).toHaveAttribute('data-page-stage', 'skeleton');
    expect(screen.getByTestId('agent-artifact-page-skeleton')).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-status')).toHaveTextContent(
      '还在生成'
    );
    expect(screen.getByTestId('agent-artifact-status')).not.toHaveTextContent(
      'partial'
    );
  });

  it('version browser can select historical revision', () => {
    const state = reduceAgentWorkbench(createEmptyAgentWorkbenchState(), {
      type: 'hydrate_replay',
      session: {
        resourceId: 'r1',
        threadId: 't1',
        sessionRevision: 1,
      },
      snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
      events: [
        wire({
          eventId: 'r1',
          streamOffset: '1',
          eventType: 'artifact.revised',
          payload: {
            schemaVersion: 'artifact-update/v1',
            mode: 'snapshot',
            artifactId: 'art-note-1',
            artifactType: 'note',
            revision: 1,
            status: 'ready',
            full: {
              pages: [
                {
                  pageIndex: 0,
                  stage: 'image',
                  body: '最后两个名额',
                  imageStatus: 'ready',
                },
              ],
            },
          },
        }),
        wire({
          eventId: 'r2',
          streamOffset: '2',
          eventType: 'artifact.revised',
          payload: {
            schemaVersion: 'artifact-update/v1',
            mode: 'snapshot',
            artifactId: 'art-note-1',
            artifactType: 'note',
            revision: 2,
            status: 'ready',
            parentRevision: 1,
            full: {
              pages: [
                {
                  pageIndex: 0,
                  stage: 'image',
                  body: '温馨预约',
                  imageStatus: 'ready',
                },
              ],
            },
          },
        }),
      ],
    }).state;

    const onView = vi.fn();
    render(
      <ArtifactCanvas
        artifacts={projectVisibleArtifacts(state)}
        onViewRevision={onView}
      />
    );
    expect(screen.getByTestId('agent-artifact-version-browser')).toBeTruthy();
    const chips = screen.getAllByTestId('agent-artifact-version-chip');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.map((chip) => chip.textContent ?? '').join(' ')).toMatch(
      /第 1 版/
    );
    expect(chips.map((chip) => chip.textContent ?? '').join(' ')).not.toMatch(
      /\br\d+\b/u
    );
    // Live head shows the derived body by default.
    expect(screen.getByTestId('agent-artifact-note')).toHaveTextContent(
      '温馨预约'
    );
    expect(screen.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-viewing-revision',
      '2'
    );
    fireEvent.click(chips[0]!);
    expect(onView).toHaveBeenCalledWith('art-note-1', 1);
  });

  it('AC4 lookback renders archived ready body without overwriting live head', () => {
    let state = reduceAgentWorkbench(createEmptyAgentWorkbenchState(), {
      type: 'hydrate_replay',
      session: {
        resourceId: 'r1',
        threadId: 't1',
        sessionRevision: 1,
      },
      snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
      events: [
        wire({
          eventId: 'r1',
          streamOffset: '1',
          eventType: 'artifact.revised',
          payload: {
            schemaVersion: 'artifact-update/v1',
            mode: 'snapshot',
            artifactId: 'art-note-1',
            artifactType: 'note',
            revision: 3,
            status: 'ready',
            full: {
              pages: [
                {
                  pageIndex: 0,
                  stage: 'image',
                  body: '最后两个名额',
                  imageStatus: 'ready',
                },
              ],
            },
          },
        }),
        wire({
          eventId: 'r2',
          streamOffset: '2',
          eventType: 'artifact.revised',
          payload: {
            schemaVersion: 'artifact-update/v1',
            mode: 'snapshot',
            artifactId: 'art-note-1',
            artifactType: 'note',
            revision: 4,
            status: 'ready',
            parentRevision: 3,
            full: {
              pages: [
                {
                  pageIndex: 0,
                  stage: 'image',
                  body: '温馨预约',
                  imageStatus: 'ready',
                },
              ],
            },
          },
        }),
      ],
    }).state;

    // Select historical revision (production host dispatches set_artifact_viewing_revision).
    state = reduceAgentWorkbench(state, {
      type: 'set_artifact_viewing_revision',
      artifactId: 'art-note-1',
      revision: 3,
    }).state;

    const { rerender } = render(
      <ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />
    );
    const note = screen.getByTestId('agent-artifact-note');
    expect(note).toHaveAttribute('data-revision', '4');
    expect(note).toHaveAttribute('data-viewing-revision', '3');
    expect(note).toHaveTextContent('最后两个名额');
    expect(note).not.toHaveTextContent('温馨预约');
    // Single card throughout lookback.
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);

    // Return to live head — historical body is gone; derived body restored.
    state = reduceAgentWorkbench(state, {
      type: 'set_artifact_viewing_revision',
      artifactId: 'art-note-1',
      revision: null,
    }).state;
    rerender(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    const live = screen.getByTestId('agent-artifact-note');
    expect(live).toHaveAttribute('data-viewing-revision', '4');
    expect(live).toHaveTextContent('温馨预约');
    expect(live).not.toHaveTextContent('最后两个名额');
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
  });
});

describe('Mobile Artifact fullscreen sheet', () => {
  it('opens fullscreen sheet on mobile works pane', () => {
    let state = withNoteArtifact();
    state = reduceAgentWorkbench(state, {
      type: 'set_mobile_pane',
      pane: 'works',
    }).state;
    render(
      <AgentWorkstream
        state={state}
        viewport="mobile"
        worksSlot={<div data-testid="works-body">works-extra</div>}
      />
    );
    expect(screen.getByTestId('agent-artifact-mobile-sheet')).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-note')).toBeTruthy();
    expect(screen.getByTestId('works-body')).toHaveTextContent('works-extra');
    expect(screen.queryByTestId('agent-workstream-process')).toBeNull();
  });

  it('sheet close returns to process pane callback', () => {
    const onPane = vi.fn();
    render(
      <ArtifactMobileSheet
        artifacts={projectVisibleArtifacts(withNoteArtifact())}
        onClose={() => onPane('process')}
        open
      />
    );
    fireEvent.click(screen.getByTestId('agent-artifact-mobile-sheet-close'));
    expect(onPane).toHaveBeenCalledWith('process');
  });

  it('AC3 open/close/content: works pane sheet carries same artifact pages as projection', () => {
    let state = withNoteArtifact();
    const onPane = vi.fn();
    const { rerender } = render(
      <AgentWorkstream
        onMobilePaneChange={onPane}
        state={state}
        viewport="mobile"
      />
    );
    // Default mobile = process; sheet closed.
    expect(screen.queryByTestId('agent-artifact-mobile-sheet')).toBeNull();
    expect(
      screen.getByTestId('agent-mobile-process-works-switch')
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-mobile-pane-works'));
    expect(onPane).toHaveBeenCalledWith('works');

    state = reduceAgentWorkbench(state, {
      type: 'set_mobile_pane',
      pane: 'works',
    }).state;
    rerender(
      <AgentWorkstream
        onMobilePaneChange={onPane}
        state={state}
        viewport="mobile"
      />
    );
    const sheet = screen.getByTestId('agent-artifact-mobile-sheet');
    expect(sheet).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-artifact-status',
      'partial'
    );
    const pages = screen.getAllByTestId('agent-artifact-note-page');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveAttribute('data-page-stage', 'copy');
    expect(pages[0]).toHaveTextContent('周末预约');
    expect(pages[1]).toHaveAttribute('data-page-stage', 'skeleton');
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('agent-artifact-mobile-sheet-close'));
    expect(onPane).toHaveBeenCalledWith('process');

    state = reduceAgentWorkbench(state, {
      type: 'set_mobile_pane',
      pane: 'process',
    }).state;
    rerender(
      <AgentWorkstream
        onMobilePaneChange={onPane}
        state={state}
        viewport="mobile"
      />
    );
    expect(screen.queryByTestId('agent-artifact-mobile-sheet')).toBeNull();
    expect(screen.getByTestId('agent-workstream-process')).toBeTruthy();
  });
});

describe('Workstream desktop right rail wires ArtifactCanvas', () => {
  it('desktop works column shows artifact canvas without worksSlot', () => {
    render(<AgentWorkstream state={withNoteArtifact()} viewport="desktop" />);
    expect(screen.getByTestId('agent-workstream-works')).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-canvas')).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-note')).toBeTruthy();
  });
});

const NOTE_COVER_REF = 'https://cdn.example.test/note-p0.webp';
const IMAGE_REF = 'https://cdn.example.test/poster.webp';
const KEYFRAME_REF = 'https://cdn.example.test/scene-0.webp';

function hydrateRevised(
  events: Array<{ eventId: string; streamOffset: string; payload: unknown }>
): AgentWorkbenchClientState {
  return reduceAgentWorkbench(createEmptyAgentWorkbenchState(), {
    type: 'hydrate_replay',
    session: {
      resourceId: 'r1',
      threadId: 't1',
      sessionRevision: 1,
    },
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: events.map((event) =>
      wire({
        eventId: event.eventId,
        streamOffset: event.streamOffset,
        eventType: 'artifact.revised',
        payload: event.payload,
      })
    ),
  }).state;
}

function applyRevised(
  state: AgentWorkbenchClientState,
  eventId: string,
  streamOffset: string,
  payload: unknown
): AgentWorkbenchClientState {
  return reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId,
      streamOffset,
      eventType: 'artifact.revised',
      payload,
    }),
  }).state;
}

describe('ART-01 Artifact media refs (image/note/video)', () => {
  it('image artifact with imageRef renders an img from that ref', () => {
    const state = hydrateRevised([
      {
        eventId: 'img-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-image-1',
          artifactType: 'image',
          revision: 1,
          status: 'ready',
          full: {
            imageStatus: 'ready',
            imageRef: IMAGE_REF,
            caption: '夏日美甲海报',
          },
        },
      },
    ]);
    render(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    const card = screen.getByTestId('agent-artifact-card');
    expect(card).toHaveAttribute('data-artifact-id', 'art-image-1');
    expect(card).toHaveAttribute('data-carrier', 'media');
    const media = screen.getByTestId('agent-artifact-image-media');
    expect(media.tagName).toBe('IMG');
    expect(media).toHaveAttribute('src', IMAGE_REF);
    expect(screen.getByTestId('agent-artifact-image')).toHaveTextContent(
      '夏日美甲海报'
    );
  });

  it('image artifact grows generating placeholder into ready img in place', () => {
    let state = hydrateRevised([
      {
        eventId: 'img-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-image-1',
          artifactType: 'image',
          revision: 1,
          status: 'partial',
          full: { imageStatus: 'generating' },
        },
      },
    ]);
    const { rerender } = render(
      <ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />
    );
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-image')).toHaveAttribute(
      'data-artifact-status',
      'partial'
    );
    expect(screen.queryByTestId('agent-artifact-image-media')).toBeNull();
    expect(
      screen.getByTestId('agent-artifact-image-media-placeholder')
    ).toHaveAttribute('data-image-status', 'generating');

    state = applyRevised(state, 'img-2', '2', {
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-image-1',
      artifactType: 'image',
      revision: 2,
      status: 'ready',
      baseRevision: 1,
      patch: { imageStatus: 'ready', imageRef: IMAGE_REF },
    });
    rerender(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-card')).toHaveAttribute(
      'data-artifact-id',
      'art-image-1'
    );
    expect(screen.getByTestId('agent-artifact-image')).toHaveAttribute(
      'data-artifact-status',
      'ready'
    );
    expect(screen.getByTestId('agent-artifact-image-media')).toHaveAttribute(
      'src',
      IMAGE_REF
    );
    expect(
      screen.queryByTestId('agent-artifact-image-media-placeholder')
    ).toBeNull();
  });

  it('note page with imageRef renders img and dual preview from the same ref', () => {
    const state = hydrateRevised([
      {
        eventId: 'note-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-note-1',
          artifactType: 'note',
          revision: 2,
          status: 'ready',
          full: {
            pages: [
              {
                pageIndex: 0,
                stage: 'image',
                title: '封面',
                body: '周末护理预约',
                imageStatus: 'ready',
                imageRef: NOTE_COVER_REF,
              },
              {
                pageIndex: 1,
                stage: 'copy',
                title: '内页',
                body: '名额有限',
              },
            ],
          },
        },
      },
    ]);
    render(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-carrier',
      'note'
    );
    const pageMedia = screen.getByTestId('agent-artifact-page-image');
    expect(pageMedia.tagName).toBe('IMG');
    expect(pageMedia).toHaveAttribute('src', NOTE_COVER_REF);
    expect(
      screen.getAllByTestId('agent-artifact-note-page')[0]
    ).toHaveAttribute('data-image-ref', NOTE_COVER_REF);

    const dual = screen.getByTestId('agent-artifact-note-dual-preview');
    expect(dual).toBeTruthy();
    const phoneCover = screen.getByTestId('note-phone-preview-cover');
    expect(phoneCover.tagName).toBe('IMG');
    expect(phoneCover).toHaveAttribute('src', NOTE_COVER_REF);
    const discoveryCover = screen.getByTestId('note-discovery-preview-cover');
    expect(discoveryCover.tagName).toBe('IMG');
    expect(discoveryCover).toHaveAttribute('src', NOTE_COVER_REF);
    expect(screen.getByTestId('note-discovery-columns')).toHaveAttribute(
      'data-column-count',
      '2'
    );
  });

  it('note page grows generating image into ready img in place', () => {
    let state = hydrateRevised([
      {
        eventId: 'note-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-note-1',
          artifactType: 'note',
          revision: 1,
          status: 'partial',
          full: {
            pages: [
              {
                pageIndex: 0,
                stage: 'image',
                title: '封面',
                body: '周末护理预约',
                imageStatus: 'generating',
              },
            ],
          },
        },
      },
    ]);
    const { rerender } = render(
      <ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />
    );
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.queryByTestId('agent-artifact-page-image')).toBeNull();
    expect(
      screen.getByTestId('agent-artifact-page-image-placeholder')
    ).toHaveAttribute('data-image-status', 'generating');

    state = applyRevised(state, 'note-2', '2', {
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-note-1',
      artifactType: 'note',
      revision: 2,
      status: 'ready',
      baseRevision: 1,
      patch: {
        pages: [
          {
            pageIndex: 0,
            stage: 'image',
            imageStatus: 'ready',
            imageRef: NOTE_COVER_REF,
          },
        ],
      },
    });
    rerender(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-artifact-status',
      'ready'
    );
    expect(screen.getByTestId('agent-artifact-page-image')).toHaveAttribute(
      'src',
      NOTE_COVER_REF
    );
    expect(screen.getByTestId('note-phone-preview-cover')).toHaveAttribute(
      'src',
      NOTE_COVER_REF
    );
  });

  it('video scene with keyframeRef renders keyframe img and delivery shot list', () => {
    const state = hydrateRevised([
      {
        eventId: 'vid-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-vid-1',
          artifactType: 'video',
          revision: 1,
          status: 'ready',
          full: {
            title: '门店探店片',
            scenes: [
              {
                sceneIndex: 0,
                storyboard: '开场门店外景',
                keyframeStatus: 'ready',
                keyframeRef: KEYFRAME_REF,
              },
              {
                sceneIndex: 1,
                storyboard: '护理手法特写',
                keyframeStatus: 'ready',
                keyframeRef: 'https://cdn.example.test/scene-1.webp',
              },
            ],
          },
        },
      },
    ]);
    render(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getByTestId('agent-artifact-video')).toHaveAttribute(
      'data-carrier',
      'media'
    );
    const shots = screen.getByTestId('agent-artifact-video-shot-list');
    expect(shots).toBeTruthy();
    expect(screen.getAllByTestId('agent-artifact-video-scene')).toHaveLength(2);
    const keyframe = screen.getAllByTestId(
      'agent-artifact-scene-keyframe-media'
    );
    expect(keyframe[0]?.tagName).toBe('IMG');
    expect(keyframe[0]).toHaveAttribute('src', KEYFRAME_REF);
    expect(
      screen.getAllByTestId('agent-artifact-scene-storyboard')[0]
    ).toHaveTextContent('开场门店外景');
    expect(screen.queryByTestId('video-subtitle-panel')).toBeNull();
    expect(screen.queryByTestId('video-cover-panel')).toBeNull();
    expect(screen.queryByTestId('agent-artifact-scene-subtitle')).toBeNull();
    expect(screen.queryByTestId('agent-artifact-scene-cover')).toBeNull();
    expect(screen.queryByTestId('object-workspace-shell')).toBeNull();
    expect(screen.queryByTestId('video-worksurface')).toBeNull();
  });

  it('video keyframe grows generating placeholder into ready img in place', () => {
    let state = hydrateRevised([
      {
        eventId: 'vid-1',
        streamOffset: '1',
        payload: {
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
                storyboard: '开场门店外景',
                keyframeStatus: 'generating',
              },
            ],
          },
        },
      },
    ]);
    const { rerender } = render(
      <ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />
    );
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(
      screen.queryByTestId('agent-artifact-scene-keyframe-media')
    ).toBeNull();
    expect(
      screen.getByTestId('agent-artifact-scene-keyframe-media-placeholder')
    ).toHaveAttribute('data-keyframe-status', 'generating');

    state = applyRevised(state, 'vid-2', '2', {
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-vid-1',
      artifactType: 'video',
      revision: 2,
      status: 'ready',
      baseRevision: 1,
      patch: {
        scenes: [
          {
            sceneIndex: 0,
            keyframeStatus: 'ready',
            keyframeRef: KEYFRAME_REF,
          },
        ],
      },
    });
    rerender(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(1);
    expect(screen.getByTestId('agent-artifact-video')).toHaveAttribute(
      'data-artifact-status',
      'ready'
    );
    expect(
      screen.getByTestId('agent-artifact-scene-keyframe-media')
    ).toHaveAttribute('src', KEYFRAME_REF);
    expect(
      screen.getByTestId('agent-artifact-scene-storyboard')
    ).toHaveTextContent('开场门店外景');
  });

  it('copy|note|media carriers cover copy/note/image/video product paths', () => {
    const state = hydrateRevised([
      {
        eventId: 'c1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-copy-1',
          artifactType: 'copy',
          revision: 1,
          status: 'ready',
          full: {
            blocks: [{ blockId: 'b1', role: 'title', text: '朋友圈文案' }],
          },
        },
      },
      {
        eventId: 'n1',
        streamOffset: '2',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-note-1',
          artifactType: 'note',
          revision: 1,
          status: 'ready',
          full: {
            pages: [
              {
                pageIndex: 0,
                stage: 'image',
                title: '封面',
                imageStatus: 'ready',
                imageRef: NOTE_COVER_REF,
              },
            ],
          },
        },
      },
      {
        eventId: 'i1',
        streamOffset: '3',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-image-1',
          artifactType: 'image',
          revision: 1,
          status: 'ready',
          full: { imageStatus: 'ready', imageRef: IMAGE_REF },
        },
      },
      {
        eventId: 'v1',
        streamOffset: '4',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-vid-1',
          artifactType: 'video',
          revision: 1,
          status: 'ready',
          full: {
            scenes: [
              {
                sceneIndex: 0,
                storyboard: '开场',
                keyframeStatus: 'ready',
                keyframeRef: KEYFRAME_REF,
              },
            ],
          },
        },
      },
    ]);
    render(<ArtifactCanvas artifacts={projectVisibleArtifacts(state)} />);
    expect(screen.getAllByTestId('agent-artifact-card')).toHaveLength(4);
    expect(screen.getByTestId('agent-artifact-copy')).toHaveAttribute(
      'data-carrier',
      'copy'
    );
    expect(screen.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-carrier',
      'note'
    );
    expect(screen.getByTestId('agent-artifact-image')).toHaveAttribute(
      'data-carrier',
      'media'
    );
    expect(screen.getByTestId('agent-artifact-video')).toHaveAttribute(
      'data-carrier',
      'media'
    );
    expect(screen.getByTestId('agent-artifact-image-media')).toHaveAttribute(
      'src',
      IMAGE_REF
    );
    expect(screen.getByTestId('agent-artifact-page-image')).toHaveAttribute(
      'src',
      NOTE_COVER_REF
    );
    expect(
      screen.getByTestId('agent-artifact-scene-keyframe-media')
    ).toHaveAttribute('src', KEYFRAME_REF);
  });

  it('Workstream works rail consumes media refs on the real Artifact renderer', () => {
    const state = hydrateRevised([
      {
        eventId: 'img-1',
        streamOffset: '1',
        payload: {
          schemaVersion: 'artifact-update/v1',
          mode: 'snapshot',
          artifactId: 'art-image-1',
          artifactType: 'image',
          revision: 1,
          status: 'ready',
          full: { imageStatus: 'ready', imageRef: IMAGE_REF },
        },
      },
    ]);
    render(<AgentWorkstream state={state} viewport="desktop" />);
    expect(screen.getByTestId('agent-workstream-works')).toContainElement(
      screen.getByTestId('agent-artifact-image-media')
    );
    expect(screen.getByTestId('agent-artifact-image-media')).toHaveAttribute(
      'src',
      IMAGE_REF
    );
  });

  it('video storyboard stays on Artifact and does not enter Living Plan', () => {
    let state = hydrateRevised([
      {
        eventId: 'vid-1',
        streamOffset: '2',
        payload: {
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
                storyboard: '开场门店外景',
                keyframeStatus: 'generating',
              },
            ],
          },
        },
      },
    ]);
    state = reduceAgentWorkbench(state, {
      type: 'apply_semantic_event',
      event: wire({
        eventId: 'plan-1',
        streamOffset: '1',
        eventType: 'plan.created',
        payload: {
          planId: 'plan-1',
          revision: 1,
          goal: { summary: '拍一条探店片' },
          deliverables: [{ kind: 'video', platform: '小红书', quantity: 1 }],
          costDuration: { creditCost: 48, durationLabel: '约 15 秒' },
        },
      }),
    }).state;
    render(<AgentWorkstream state={state} viewport="desktop" />);
    expect(
      screen.getByTestId('agent-artifact-scene-storyboard')
    ).toHaveTextContent('开场门店外景');
    const plan = screen.getByTestId('agent-living-plan');
    expect(plan).toHaveTextContent('拍一条探店片');
    expect(plan).toHaveTextContent('约 15 秒');
    expect(plan).not.toHaveTextContent('开场门店外景');
    expect(plan).not.toHaveTextContent('分镜');
  });
});
