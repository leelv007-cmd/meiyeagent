/**
 * RTL: D-114 conversation container (T30 / #224).
 *
 * Covers the three things the reshell is most likely to get silently wrong:
 * the submit key contract the D-043 counter depends on, the default candidate
 * shape (one primary, alternatives folded), and the absence of any slot form.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerConversation,
  ComposerPromptBar,
} from './composer-conversation';
import { projectComposerSignedPreview } from './composer-signed-preview';
import {
  applyComposerProgress,
  applyComposerWorkflowState,
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
  type ComposerSession,
} from './composer-session';
import { projectResultTokenStream } from '@/product/results/result-token-stream';

afterEach(cleanup);

const TASK = { taskId: 'task-1', workId: 'work-1', packageId: 'package-1' };

function running(): ComposerSession {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-1'), '写一条周末预约文案'),
    TASK
  );
}

function promptBar(overrides: Partial<Parameters<typeof ComposerPromptBar>[0]> = {}) {
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      creationMode="customized"
      destination={null}
      destinationCapability={null}
      disabled={false}
      onCreationModeChange={() => {}}
      onDestinationChange={() => {}}
      onReuseChip={() => {}}
      onSubmit={() => {}}
      onValueChange={() => {}}
      placeholder="说说想发什么"
      reuseChips={[]}
      running={false}
      signedPreview={null}
      submitLabel="开始创作"
      value=""
      {...overrides}
    />
  );
}

describe('submit key contract (D-043 activation counting)', () => {
  it('bare Enter writes a newline instead of submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onValueChange = vi.fn();
    render(promptBar({ onSubmit, onValueChange, value: '写一条' }));

    await user.click(screen.getByTestId('composer-intent-input'));
    await user.keyboard('{Enter}');

    // Bare Enter is not an activation the counter can see, so it must not
    // start a run.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Enter submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(promptBar({ onSubmit, value: '写一条' }));

    await user.click(screen.getByTestId('composer-intent-input'));
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('the send button submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(promptBar({ onSubmit, value: '写一条' }));

    await user.click(screen.getByTestId('composer-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('entry and destination are conversation affordances, not a form', () => {
  it('declares 定制 and 自由 as two entries', async () => {
    const user = userEvent.setup();
    const onCreationModeChange = vi.fn();
    render(promptBar({ onCreationModeChange }));

    await user.click(screen.getByTestId('composer-creation-mode-free'));
    expect(onCreationModeChange).toHaveBeenCalledWith('free');
  });

  it('asks 「发到哪」once, as chips, and echoes the capability', async () => {
    const user = userEvent.setup();
    const onDestinationChange = vi.fn();
    render(
      promptBar({
        destination: 'wechat_moments',
        destinationCapability: '生成后协办交接',
        onDestinationChange,
      })
    );

    expect(
      screen.getByTestId('composer-destination-option-wechat_moments')
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByTestId('composer-destination-capability')
    ).toHaveTextContent('生成后协办交接');

    await user.click(screen.getByTestId('composer-destination-option-douyin'));
    expect(onDestinationChange).toHaveBeenCalledWith('douyin');
  });

  it('shows the signed fields read-only, with no editable control', () => {
    render(
      promptBar({
        signedPreview: projectComposerSignedPreview({
          signed: {
            catalogModel: { id: 'deepseek-v4-pro', revision: 'catalog-7' },
            recipe: { id: 'recipe-weekend', revision: 'rev-3' },
            contentPackagePlatform: 'xiaohongshu',
            distributionTarget: 'export',
            deliverable: { kind: 'copy_document', quantity: 1 },
          },
          modelName: '深度文案模型',
        }),
        modelChannelReadiness: 'multi_channel_ready',
      })
    );

    const preview = screen.getByTestId('composer-signed-preview');
    expect(preview).toHaveTextContent('发到哪：小红书');
    expect(preview).toHaveTextContent('交付物：文案');
    expect(
      screen.getByTestId('composer-model-channel-readiness')
    ).toHaveAttribute('data-channel-readiness', 'multi_channel_ready');
    // Read-only means read-only: no inputs, selects or textboxes in here.
    expect(within(preview).queryByRole('textbox')).toBeNull();
    expect(within(preview).queryByRole('combobox')).toBeNull();
    expect(preview.querySelector('input, select')).toBeNull();
  });
});

describe('the transcript is a card flow', () => {
  const emptyStream = projectResultTokenStream({ workspaceKind: 'copy' });

  it('renders nothing before the merchant says anything', () => {
    const { container } = render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={createComposerSession('session-1')}
        stream={emptyStream}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('streams one primary candidate and folds alternatives away', () => {
    const stream = projectResultTokenStream({
      workspaceKind: 'copy',
      progressState: 'running',
      partialCandidates: [
        { candidateId: 'c1', title: '周末预约', body: '到店立减' },
        { candidateId: 'c2', title: '备选一' },
      ],
    });
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={stream}
      />
    );

    const area = screen.getByTestId('composer-candidate-stream');
    expect(area).toHaveAttribute('data-has-token', 'true');
    expect(screen.getByTestId('composer-candidate-primary')).toHaveTextContent(
      '周末预约'
    );
    // D-113 / story 15: alternatives are an opt-in disclosure, never a grid.
    const alternates = screen.getByTestId('composer-candidate-alternates');
    expect(alternates.tagName).toBe('DETAILS');
    expect(alternates).not.toHaveAttribute('open');
    expect(alternates).toHaveTextContent('另有 1 个备选');
  });

  it('renders the D-111 route notice from the intent_naming frame', () => {
    const session = applyComposerProgress(running(), {
      eventId: 'workflow-1:event:1',
      workflowId: 'workflow-1',
      workflowType: 'creation',
      sequence: 1,
      stage: 'intent_naming',
      state: 'success',
      occurredAt: '2026-07-25T08:00:00.000Z',
      message:
        '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。',
    });
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={session}
        stream={emptyStream}
      />
    );
    expect(screen.getByTestId('composer-route-notice')).toHaveTextContent(
      '通用模式'
    );
  });

  it('opens the Result Center only when the delivery card is clicked', async () => {
    const user = userEvent.setup();
    const onOpenDelivery = vi.fn();
    const session = applyComposerWorkflowState(running(), 'success');
    render(
      <ComposerConversation
        onOpenDelivery={onOpenDelivery}
        session={session}
        stream={emptyStream}
      />
    );

    expect(onOpenDelivery).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('composer-delivery-card'));
    expect(onOpenDelivery).toHaveBeenCalledWith({
      workId: 'work-1',
      taskId: 'task-1',
    });
  });
});
