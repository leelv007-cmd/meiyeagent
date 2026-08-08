/**
 * Production path: Living Plan appears inside AgentWorkstream after plan events
 * (V31-10 hard acceptance — not library-only).
 */
import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmptyAgentWorkbenchState,
  reduceAgentWorkbench,
  type AgentWorkbenchClientState,
} from '../agent-event-reducer';
import { AgentWorkstream } from '../agent-workstream';
import { __resetControlledSurfaceRegistryForTests } from '../controlled-surface-registry';
import {
  __resetPlanSurfaceRegistrationForTests,
  registerPlanSurfaces,
} from './register-plan-surfaces';

afterEach(() => {
  cleanup();
  __resetControlledSurfaceRegistryForTests();
  __resetPlanSurfaceRegistrationForTests();
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

function withPlan(): AgentWorkbenchClientState {
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
        payload: { text: '已检索门店项目与授权素材' },
      }),
      wire({
        eventId: 'n2',
        streamOffset: '2',
        eventType: 'message.final',
        payload: { text: '这次你更想推新品还是填空档？' },
      }),
      wire({
        eventId: 'p1',
        streamOffset: '3',
        eventType: 'plan.created',
        payload: {
          planId: 'plan-ws-1',
          revision: 1,
          goal: { summary: '填补空档 · 奶油风美甲' },
          deliverables: [{ kind: 'note', platform: '小红书', quantity: 6 }],
          expression: { voice: '自然' },
          factsAssets: {
            factsSummary: '不写价格',
            rightsLabel: '素材授权通过',
          },
          costDuration: {
            creditCost: 38,
            balanceCredits: 126,
            failureRefundsCredits: true,
          },
        },
      }),
      wire({
        eventId: 'p2',
        streamOffset: '4',
        eventType: 'plan.revised',
        payload: {
          planId: 'plan-ws-1',
          revision: 2,
          goal: { summary: '填补空档 · 奶油风美甲' },
          deliverables: [{ kind: 'note', platform: '小红书', quantity: 4 }],
          adjustmentSummary: '只做小红书，减到 4 页',
          costDuration: {
            creditCost: 24,
            balanceCredits: 126,
            failureRefundsCredits: true,
          },
        },
      }),
    ],
  }).state;
  return state;
}

describe('AgentWorkstream Living Plan production path', () => {
  it('renders Living Plan in the process pane after plan.created/revised', () => {
    registerPlanSurfaces();
    render(<AgentWorkstream state={withPlan()} viewport="desktop" />);

    expect(screen.getByTestId('agent-workstream')).toBeInTheDocument();
    expect(screen.getByTestId('agent-living-plan')).toBeInTheDocument();
    expect(screen.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-plan-id',
      'plan-ws-1'
    );
    expect(screen.getByTestId('agent-plan-section-goal')).toHaveTextContent(
      '奶油风美甲'
    );
    expect(screen.getByTestId('agent-plan-diff')).toHaveTextContent('4 页');
    expect(screen.getByTestId('agent-commit-strip')).toBeInTheDocument();
  });
});
