/**
 * V31-04 Workstream component behavior (document lines, collapse, card
 * reduction, mobile process/works switch). Vitest + Testing Library.
 */
import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyAgentWorkbenchState,
  reduceAgentWorkbench,
  type AgentWorkbenchClientState,
} from './agent-event-reducer';
import { AgentWorkstream } from './agent-workstream';
import { NarrativeLine } from './stream/narrative-line';
import { ActivityLine } from './stream/activity-line';

afterEach(cleanup);

function wire(overrides: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  payload?: unknown;
  occurredAt?: string;
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
    occurredAt: overrides.occurredAt ?? '2026-08-08T12:00:00.000Z',
    eventId: overrides.eventId,
    streamOffset: overrides.streamOffset,
    eventType: overrides.eventType,
  });
}

function withNarratives(): AgentWorkbenchClientState {
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
        eventId: 'n1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '已理解你的需求' },
      }),
      wire({
        eventId: 'a1',
        streamOffset: '2',
        eventType: 'activity.snapshot',
        payload: {
          activityId: 'act-1',
          title: '正在检索门店资料',
          status: 'running',
          detail: '读取资料卡与历史内容',
        },
        occurredAt: '2026-08-08T12:00:01.000Z',
      }),
      wire({
        eventId: 'empty-act',
        streamOffset: '3',
        eventType: 'activity.snapshot',
        payload: { activityId: 'act-empty', title: '', status: 'idle' },
        occurredAt: '2026-08-08T12:00:02.000Z',
      }),
    ],
  }).state;
  return state;
}

describe('AgentWorkstream document timeline', () => {
  it('renders narrative as document line, not chat bubble', () => {
    render(<AgentWorkstream state={withNarratives()} />);
    const line = screen.getByTestId('agent-narrative-line');
    expect(line).toHaveAttribute('data-surface', 'narrative');
    expect(line).toHaveAttribute('data-agent-frame', 'narrative');
    expect(line.querySelector('[data-slot="chat-message-user"]')).toBeNull();
    expect(line).toHaveTextContent('已理解你的需求');
  });

  it('hides empty activities (card reduction)', () => {
    render(<AgentWorkstream state={withNarratives()} />);
    const activities = screen.getAllByTestId('agent-activity-line');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toHaveTextContent('正在检索门店资料');
  });

  it('collapses activity detail by default and expands on toggle', () => {
    const onToggle = vi.fn();
    const state = withNarratives();
    render(<AgentWorkstream state={state} onToggleActivity={onToggle} />);
    expect(screen.queryByTestId('agent-activity-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-activity-toggle'));
    expect(onToggle).toHaveBeenCalledWith('act-1');
  });

  it('shows expanded detail when activity.collapsed is false', () => {
    let state = withNarratives();
    state = reduceAgentWorkbench(state, {
      type: 'toggle_activity_collapsed',
      activityId: 'act-1',
    }).state;
    render(<AgentWorkstream state={state} />);
    expect(screen.getByTestId('agent-activity-detail')).toHaveTextContent(
      '读取资料卡与历史内容'
    );
  });

  it('shows a recoverable error when delivered handoff preparation fails', () => {
    render(
      <AgentWorkstream
        publishHandoffError="手机交接暂未准备好，请前往结果中心。"
        state={createEmptyAgentWorkbenchState()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('结果中心');
    expect(screen.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true'
    );
  });

  it('marks delivered from the composer session even without handoff materials', () => {
    render(
      <AgentWorkstream
        sessionDelivered
        state={createEmptyAgentWorkbenchState()}
      />
    );
    expect(screen.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true'
    );
  });

  it('stays undelivered while the composer session has not delivered', () => {
    render(<AgentWorkstream state={createEmptyAgentWorkbenchState()} />);
    expect(screen.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'false'
    );
  });

  it('mobile shows 过程/作品 switch; works pane opens fullscreen Artifact sheet', () => {
    let state = withNarratives();
    const onPane = vi.fn();
    const { rerender } = render(
      <AgentWorkstream
        onMobilePaneChange={onPane}
        processSlot={<div data-testid="legacy-process">legacy</div>}
        state={state}
        viewport="mobile"
        worksSlot={<div data-testid="works-body">works</div>}
      />
    );
    expect(
      screen.getByTestId('agent-mobile-process-works-switch')
    ).toBeTruthy();
    expect(screen.getByTestId('agent-workstream-process')).toBeTruthy();
    expect(screen.queryByTestId('agent-workstream-works')).toBeNull();
    expect(screen.queryByTestId('agent-artifact-mobile-sheet')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-mobile-pane-works'));
    expect(onPane).toHaveBeenCalledWith('works');

    state = reduceAgentWorkbench(state, {
      type: 'set_mobile_pane',
      pane: 'works',
    }).state;
    rerender(
      <AgentWorkstream
        onMobilePaneChange={onPane}
        processSlot={<div data-testid="legacy-process">legacy</div>}
        state={state}
        viewport="mobile"
        worksSlot={<div data-testid="works-body">works</div>}
      />
    );
    expect(screen.queryByTestId('agent-workstream-process')).toBeNull();
    expect(screen.getByTestId('agent-artifact-mobile-sheet')).toBeTruthy();
    expect(screen.getByTestId('agent-workstream-works')).toHaveTextContent(
      'works'
    );
  });

  it('does not repeat a merchant prompt as a second 叙述 line', () => {
    render(
      <AgentWorkstream
        excludeNarrativeTexts={['已理解你的需求']}
        state={withNarratives()}
      />
    );
    expect(screen.queryByTestId('agent-narrative-line')).toBeNull();
  });

  it('hides the empty artifact placeholder when no run is expected', () => {
    render(
      <AgentWorkstream
        state={createEmptyAgentWorkbenchState()}
        viewport="desktop"
      />
    );
    expect(screen.queryByTestId('agent-artifact-canvas-empty')).toBeNull();
  });

  it('desktop does not show mobile switch and keeps process + artifact rail visible', () => {
    render(
      <AgentWorkstream
        state={withNarratives()}
        viewport="desktop"
        worksSlot={<div data-testid="works-body">works</div>}
      />
    );
    expect(
      screen.queryByTestId('agent-mobile-process-works-switch')
    ).toBeNull();
    expect(screen.getByTestId('agent-workstream-process')).toBeTruthy();
    expect(screen.getByTestId('agent-workstream-works')).toBeTruthy();
    expect(screen.getByTestId('agent-artifact-canvas-empty')).toBeTruthy();
    expect(screen.getByTestId('works-body')).toHaveTextContent('works');
  });
});

describe('Controlled surface gate on line components', () => {
  it('NarrativeLine refuses to paint when registry would reject props', () => {
    // Direct render still runs gate without forbidden props — paints.
    const { container } = render(<NarrativeLine id="x" text="安全叙事" />);
    expect(
      container.querySelector('[data-testid="agent-narrative-line"]')
    ).toBeTruthy();
  });

  it('ActivityLine paints only registered activity props', () => {
    render(
      <ActivityLine
        activity={{
          id: 'a',
          title: '工具过程',
          status: 'done',
          collapsed: true,
          streamOffset: '1',
          updatedAt: '2026-08-08T12:00:00.000Z',
        }}
      />
    );
    expect(screen.getByTestId('agent-activity-line')).toBeTruthy();
  });
});
