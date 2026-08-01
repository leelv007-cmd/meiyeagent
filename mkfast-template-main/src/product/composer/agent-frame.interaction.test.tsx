/**
 * RTL: AgentFrame registry path for document timeline (#313).
 */
import type { WorkflowProgressEnvelope } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComposerConversation } from './composer-conversation';
import {
  applyComposerExecutionConfirm,
  applyComposerProgress,
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
  type ComposerSession,
} from './composer-session';
import { projectResultTokenStream } from '@/product/results/result-token-stream';

afterEach(cleanup);

const TASK = { taskId: 'task-1', workId: 'work-1', packageId: 'package-1' };
const emptyStream = projectResultTokenStream({ workspaceKind: 'copy' });

function progress(
  overrides: Partial<WorkflowProgressEnvelope> & { sequence: number }
): WorkflowProgressEnvelope {
  return {
    eventId: `workflow-1:event:${overrides.sequence}`,
    workflowId: 'workflow-1',
    workflowType: 'creation',
    stage: 'context_injection',
    state: 'success',
    occurredAt: '2026-07-25T08:00:00.000Z',
    ...overrides,
  };
}

function withMerchant(): ComposerSession {
  return openComposerTurn(
    createComposerSession('session-1'),
    '写一条周末预约文案'
  );
}

function withStages(): ComposerSession {
  let session = bindComposerTask(withMerchant(), TASK);
  session = applyComposerProgress(
    session,
    progress({
      sequence: 1,
      stage: 'intent_naming',
      message: '已理解你的需求',
    })
  );
  session = applyComposerProgress(
    session,
    progress({ sequence: 2, message: '正在读你的门店资料' })
  );
  return session;
}

describe('AgentFrame registry document timeline', () => {
  it('marks merchant turns as narrative frames (light chip, not chat bubble stream)', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={withMerchant()}
        stream={emptyStream}
      />
    );
    const merchant = screen.getByTestId('composer-turn-merchant');
    expect(merchant).toHaveAttribute('data-agent-frame', 'narrative');
    expect(merchant).toHaveAttribute('data-turn-kind', 'merchant');
    expect(
      merchant.querySelector('[data-slot="chat-message-user"]')
    ).toBeNull();
  });

  it('marks stage rails as narrative frames via the registry', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={withStages()}
        stream={emptyStream}
      />
    );
    const frames = screen.getAllByTestId('agent-frame-narrative');
    // merchant + stages group (route_notice is also narrative but not present)
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const stageFrame = frames.find(
      (node) => node.getAttribute('data-turn-kind') === 'stages'
    );
    expect(stageFrame).toBeTruthy();
    expect(stageFrame).toHaveAttribute('data-agent-frame', 'narrative');
  });

  it('marks candidate stream as a result frame', () => {
    const session = bindComposerTask(withMerchant(), TASK);
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={session}
        stream={emptyStream}
      />
    );
    const result = screen.getByTestId('agent-frame-result');
    expect(result).toHaveAttribute('data-turn-kind', 'candidate');
  });

  it('marks execution_confirm as a decision-frame interrupt (P1-05)', () => {
    const session = applyComposerExecutionConfirm(
      bindComposerTask(withMerchant(), TASK),
      'execution-request-1'
    );
    render(
      <ComposerConversation
        executionConfirmSlot={
          <div data-testid="execution-confirmation-interaction-card">
            confirm
          </div>
        }
        onOpenDelivery={() => {}}
        session={session}
        stream={emptyStream}
      />
    );
    const frame = screen.getByTestId('composer-execution-confirm-turn');
    expect(frame).toHaveAttribute('data-agent-frame', 'decision');
    expect(frame).toHaveAttribute('data-turn-kind', 'execution_confirm');
    expect(
      screen.getByTestId('execution-confirmation-interaction-card')
    ).toBeTruthy();
  });
});
