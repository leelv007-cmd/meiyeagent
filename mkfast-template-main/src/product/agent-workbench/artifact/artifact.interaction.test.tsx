/**
 * V31-15 Artifact canvas / mobile sheet / registry surface behavior.
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
import {
  __resetControlledSurfaceRegistryForTests,
  resolveControlledSurface,
} from '../controlled-surface-registry';
import {
  __resetArtifactSurfaceRegistrationForTests,
  ARTIFACT_SURFACE_KEYS,
  registerArtifactSurfaces,
} from './artifact-registry';
import { ArtifactCanvas } from './artifact-canvas';
import { ArtifactMobileSheet } from './artifact-mobile-sheet';

afterEach(() => {
  cleanup();
  __resetControlledSurfaceRegistryForTests();
  __resetArtifactSurfaceRegistrationForTests();
  registerArtifactSurfaces();
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

describe('Artifact surfaces registry', () => {
  it('registers all artifact surfaces for Controlled Surface gate', () => {
    for (const key of ARTIFACT_SURFACE_KEYS) {
      const result = resolveControlledSurface({ surface: key, props: {} });
      expect(result.ok).toBe(true);
    }
  });

  it('still rejects className / html / action on artifact surfaces', () => {
    const bad = resolveControlledSurface({
      surface: 'artifact_note',
      props: { artifactId: 'x', className: 'evil' },
    });
    expect(bad.ok).toBe(false);
  });
});

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
    expect(screen.getByTestId('agent-mobile-process-works-switch')).toBeTruthy();

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
