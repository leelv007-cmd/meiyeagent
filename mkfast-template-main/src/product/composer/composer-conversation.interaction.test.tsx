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

import { cardLanguageIssues } from './card-language';
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

function promptBar(
  overrides: Partial<Parameters<typeof ComposerPromptBar>[0]> = {}
) {
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      creationMode="customized"
      destination={null}
      destinationCapability={null}
      disabled={false}
      submitDisabled={false}
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

  it('offers 旧内容换平台 as supply-layer suggestions, and one tap seeds the draft (U04)', async () => {
    const user = userEvent.setup();
    const onReuseChip = vi.fn();
    const chip = {
      id: 'xiaohongshu',
      intent: '把我之前发过的一条内容改成适合小红书的版本',
      label: '发小红书',
    };
    render(promptBar({ onReuseChip, reuseChips: [chip] }));

    const suggestions = screen.getByTestId('composer-reuse-chips');
    // Written by the vendored unit — red if the hand-rolled pill row returns.
    expect(suggestions.dataset.slot).toBe('prompt-suggestion');
    expect(suggestions).toHaveTextContent('想把旧内容换个平台再发？');

    await user.click(screen.getByTestId('composer-reuse-chip-xiaohongshu'));
    expect(onReuseChip).toHaveBeenCalledWith(chip);
  });

  it('shows the signed fields read-only, with no editable control', () => {
    render(
      promptBar({
        signedPreview: projectComposerSignedPreview({
          signed: {
            catalogModel: { id: 'deepseek-v4-pro', revision: 'catalog-7' },
            creationMode: 'customized',
            intent: '写一条周末预约文案',
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

/**
 * What the supply-layer markdown unit puts in the DOM while it believes the
 * body is still arriving: a caret custom property on its container, and a
 * per-block reveal marker.
 */
function candidateBodyIsStreaming() {
  const primary = screen.getByTestId('composer-candidate-primary');
  const container = primary.querySelector<HTMLElement>('[data-slot="markdown"]')
    ?.firstElementChild as HTMLElement | null;
  return (
    Boolean(container?.style.getPropertyValue('--streamdown-caret')) ||
    primary.querySelector('[data-sd-animate="true"]') !== null
  );
}

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

  it('still renders T10 Day-0 identity card when there is no transcript yet', () => {
    // The empty-transcript early return must not swallow the identity slot:
    // on Day-0 the identity choice is the only thing in the container, and
    // folding turns must not have narrowed that guard back to `turnCount === 0`.
    render(
      <ComposerConversation
        identitySlot={<div data-testid="t31-identity-probe">身份</div>}
        onOpenDelivery={() => {}}
        session={createComposerSession('session-1')}
        stream={emptyStream}
      />
    );
    expect(screen.getByTestId('composer-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('t31-identity-probe')).toBeInTheDocument();
  });

  it('hosts identity selection as a conversation card, never a form', () => {
    render(
      <ComposerConversation
        identitySlot={
          <section data-testid="identity-choice">
            <button type="button">老板娘口吻</button>
          </section>
        }
        onOpenDelivery={() => {}}
        session={createComposerSession('session-1')}
        stream={emptyStream}
      />
    );

    const conversation = screen.getByTestId('composer-conversation');
    expect(within(conversation).getByTestId('identity-choice')).toBeVisible();
    expect(conversation.querySelector('form')).toBeNull();
  });

  it('is the supply-layer transcript container, not a hand-rolled scroller (U03)', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={emptyStream}
      />
    );

    // `data-slot` is written by the vendored unit itself, so this goes red the
    // moment the container is swapped back for a <section> + endRef pair.
    const conversation = screen.getByTestId('composer-conversation');
    expect(conversation.dataset.slot).toBe('chat-conversation');
    expect(
      conversation.querySelector('[data-slot="chat-conversation-content"]')
    ).not.toBeNull();
    expect(
      conversation.querySelector(
        '[data-slot="chat-conversation-scroll-anchor"]'
      )
    ).not.toBeNull();
    // The whole transcript must not become one live region: the announcements
    // belong to the progress card and the candidate area.
    expect(conversation.getAttribute('aria-live')).toBe('off');
    // The app-side adaptation hook has to survive the unit's class merge, or
    // the unit's edge fade quietly comes back and eats whichever card sits at
    // the top of the pane.
    expect(conversation.className).toMatch(/meiye-conversation-pane/);
  });

  it('answers prefers-reduced-motion in both directions (U07)', () => {
    const setReducedMotion = (reduce: boolean) => {
      window.matchMedia = ((query: string) => ({
        addEventListener: () => {},
        addListener: () => {},
        dispatchEvent: () => false,
        matches: query.includes('prefers-reduced-motion') ? reduce : false,
        media: query,
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      })) as typeof window.matchMedia;
    };

    setReducedMotion(false);
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={emptyStream}
      />
    );
    const animated = screen.getByTestId('composer-conversation');
    expect(animated.dataset.motion).toBe('on');
    // Non-vacuous: without this the "no transform" leg below would pass even if
    // the arrival motion had never been wired at all.
    expect(
      [
        ...animated.querySelectorAll<HTMLElement>(
          '[data-slot="chat-conversation-content"] > div'
        ),
      ].some((turn) => turn.style.transform.includes('translateY'))
    ).toBe(true);

    cleanup();
    setReducedMotion(true);
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={emptyStream}
      />
    );
    const reduced = screen.getByTestId('composer-conversation');
    expect(reduced.dataset.motion).toBe('off');
    // A merchant who asked for no motion gets none — not a faster one. The
    // arrival transform must not be written onto the turn wrappers at all.
    for (const turn of reduced.querySelectorAll<HTMLElement>(
      '[data-slot="chat-conversation-content"] > div'
    )) {
      expect(turn.style.transform).toBe('');
    }
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
    const primary = screen.getByTestId('composer-candidate-primary');
    expect(primary).toHaveTextContent('周末预约');
    // U03: the body is rendered by the supply-layer markdown unit — red if the
    // prompt-kit response-stream copy comes back or the body drops to plain text.
    expect(primary.querySelector('[data-slot="markdown"]')).not.toBeNull();
    // D-113 / story 15: alternatives are an opt-in disclosure, never a grid.
    const alternates = screen.getByTestId('composer-candidate-alternates');
    expect(alternates.tagName).toBe('DETAILS');
    expect(alternates).not.toHaveAttribute('open');
    expect(alternates).toHaveTextContent('另有 1 个备选');
  });

  it('stops streaming the candidate body once the run is terminal', () => {
    // 「无假流式」at the render seam: the same text must read as arriving while
    // the workflow runs, and as delivered once it does not.
    const partialCandidates = [
      { candidateId: 'c1', title: '周末预约', body: '到店立减，先到先得。' },
    ];
    const { rerender } = render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={projectResultTokenStream({
          workspaceKind: 'copy',
          progressState: 'running',
          partialCandidates,
        })}
      />
    );
    expect(candidateBodyIsStreaming()).toBe(true);

    const terminal = projectResultTokenStream({
      workspaceKind: 'copy',
      progressState: 'success',
      partialCandidates,
    });
    rerender(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={terminal}
      />
    );
    expect(candidateBodyIsStreaming()).toBe(false);
    expect(screen.getByTestId('composer-candidate-primary')).toHaveTextContent(
      '到店立减，先到先得。'
    );

    // And on a reload of that finished run there is no live → terminal edge to
    // ride: the fresh mount must be settled from the first frame.
    cleanup();
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={running()}
        stream={terminal}
      />
    );
    expect(candidateBodyIsStreaming()).toBe(false);
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
      action: 'open',
      revision: null,
    });
  });
});

/**
 * T31 / #225 — the three outbound seam messages each get their card.
 */
describe('进度宣告卡', () => {
  const emptyStream = projectResultTokenStream({ workspaceKind: 'copy' });

  function withStages(...messages: string[]) {
    let session = running();
    messages.forEach((message, index) => {
      session = applyComposerProgress(session, {
        eventId: `workflow-1:event:${index + 1}`,
        workflowId: 'workflow-1',
        workflowType: 'creation',
        sequence: index + 1,
        stage: 'context_injection',
        state: 'success',
        occurredAt: '2026-07-25T08:00:00.000Z',
        message,
      });
    });
    return session;
  }

  it('groups the 白话进度 announcements into one card, in order', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={withStages(
          '已听懂这次想表达的重点',
          '已整理本次可用的门店资料'
        )}
        stream={emptyStream}
      />
    );

    const card = screen.getByTestId('composer-progress-card');
    expect(card).toHaveAttribute('data-running', 'true');
    const lines = within(card).getAllByTestId('composer-stage-line');
    expect(lines.map((line) => line.textContent)).toEqual([
      '已听懂这次想表达的重点',
      '已整理本次可用的门店资料',
    ]);
  });

  it('carries no engineering language, cost or internal id', () => {
    const session = withStages(
      '已听懂这次想表达的重点',
      '已整理本次可用的门店资料'
    );
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={session}
        stream={emptyStream}
      />
    );
    const card = screen.getByTestId('composer-progress-card');
    expect(
      cardLanguageIssues(card.textContent ?? '', [
        TASK.taskId,
        TASK.workId,
        TASK.packageId,
      ])
    ).toEqual([]);
  });

  it('stops marking a stage live once the run is no longer moving', () => {
    const session = applyComposerWorkflowState(
      withStages('已整理本次可用的门店资料'),
      'success'
    );
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={session}
        stream={emptyStream}
      />
    );
    expect(screen.getByTestId('composer-progress-card')).toHaveAttribute(
      'data-running',
      'false'
    );
  });

  it('is the supply-layer step rail, and it opens read (U03)', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={withStages('已听懂这次想表达的重点')}
        stream={emptyStream}
      />
    );

    const card = screen.getByTestId('composer-progress-card');
    // Written by the vendored unit — goes red if the hand-rolled <ol> returns.
    expect(card.dataset.slot).toBe('chain-of-thought');
    expect(
      card.querySelector('[data-slot="chain-of-thought-step"]')
    ).not.toBeNull();
    // D-116: the 白话进度 is a delivery statement the merchant is meant to
    // read, so a disclosure may offer to fold it but must never open folded.
    expect(within(card).getByTestId('composer-stage-line')).toBeVisible();
  });
});

describe('成品交付卡', () => {
  const DELIVERY = {
    packageId: 'package-1',
    versionId: 'version-7',
    revision: 3,
  };
  const SUMMARY =
    '第 3 版已经准备好。策略依据：周末到店高峰。版本定位：这是本次适合小红书的主推荐。使用建议：建议先核对内容和预约引导，确认后再发布。';

  function delivered() {
    const session = applyComposerProgress(running(), {
      eventId: 'workflow-1:event:9',
      workflowId: 'workflow-1',
      workflowType: 'creation',
      sequence: 9,
      stage: 'assembly_delivery',
      state: 'success',
      occurredAt: '2026-07-25T08:00:00.000Z',
      message: SUMMARY,
    });
    return applyComposerWorkflowState(session, 'success', DELIVERY);
  }

  const finishedStream = projectResultTokenStream({
    workspaceKind: 'copy',
    completed: true,
    partialCandidates: [
      { candidateId: 'c1', title: '周末预约', body: '到店立减，先到先得。' },
    ],
  });

  it('states the 任务总结 and shows what was delivered', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={delivered()}
        stream={finishedStream}
      />
    );

    expect(screen.getByTestId('composer-delivery-card')).toHaveTextContent(
      '第 3 版'
    );
    expect(screen.getByTestId('composer-delivery-statement')).toHaveTextContent(
      '策略依据'
    );
    expect(screen.getByTestId('composer-delivery-excerpt')).toHaveTextContent(
      '到店立减'
    );
  });

  it('binds every action to the revision the server delivered', async () => {
    const user = userEvent.setup();
    const onOpenDelivery = vi.fn();
    render(
      <ComposerConversation
        onOpenDelivery={onOpenDelivery}
        session={delivered()}
        stream={finishedStream}
      />
    );

    for (const action of ['adopt', 'adjust', 'export'] as const) {
      onOpenDelivery.mockClear();
      await user.click(
        screen.getByTestId(`composer-delivery-action-${action}`)
      );
      expect(onOpenDelivery).toHaveBeenCalledWith({
        workId: 'work-1',
        taskId: 'task-1',
        action,
        revision: DELIVERY,
      });
    }
  });

  it('withholds the actions when no revision was confirmed', () => {
    // An action pointed at a revision the server never confirmed would be the
    // second truth ADR-0014 forbids — better no button than a wrong binding.
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={applyComposerWorkflowState(running(), 'success')}
        stream={finishedStream}
      />
    );
    expect(screen.queryByTestId('composer-delivery-actions')).toBeNull();
    expect(screen.getByTestId('composer-delivery-card')).toBeInTheDocument();
  });

  it('carries no engineering language, cost or internal id', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={delivered()}
        stream={finishedStream}
      />
    );
    const card = screen.getByTestId('composer-delivery-turn');
    expect(
      cardLanguageIssues(card.textContent ?? '', [
        TASK.taskId,
        TASK.workId,
        DELIVERY.packageId,
        DELIVERY.versionId,
      ])
    ).toEqual([]);
  });
});

describe('终态申报', () => {
  it('shows hold expiry cancellation and refund instead of an empty delivery card', () => {
    const stream = projectResultTokenStream({ workspaceKind: 'copy' });
    const session = applyComposerWorkflowState(
      running(),
      'success',
      undefined,
      {
        merchantMessage: '超时未选择，本次任务已取消，额度已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      }
    );
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        session={session}
        stream={stream}
      />
    );
    expect(screen.getByTestId('composer-terminal-outcome')).toHaveTextContent(
      '已取消，额度已退回'
    );
    expect(screen.queryByTestId('composer-delivery-card')).toBeNull();
  });
});

/**
 * W03 / P0-2 申报卡. The audit found a failed run rendering as *nothing* — the
 * transcript stopped and a generic toast was the whole story. These cover what
 * replaced it: the reason, the next step, the refund, and a way back in.
 */
describe('失败/partial 申报卡', () => {
  const failureReport = {
    kind: 'failure' as const,
    category: 'media_generation' as const,
    message: '这次图片没有顺利生成。你可以重新生成，或换一张参考素材再试。',
    nextStep: '可以直接重新生成，或者先改用文字方案发布。',
    actions: ['retry' as const, 'switch_form' as const],
    quotaRefunded: true,
  };

  function failed(report = failureReport) {
    return applyComposerWorkflowState(
      running(),
      'failed',
      undefined,
      undefined,
      report
    );
  }

  it('states 白话原因, 下一步动作 and the refund, in merchant language', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        onRecover={() => {}}
        session={failed()}
        stream={projectResultTokenStream({ workspaceKind: 'copy' })}
      />
    );

    const card = screen.getByTestId('composer-report-card');
    expect(card).toHaveAttribute('data-report-kind', 'failure');
    expect(screen.getByTestId('composer-report-reason')).toHaveTextContent(
      '这次图片没有顺利生成'
    );
    expect(screen.getByTestId('composer-report-next-step')).toHaveTextContent(
      '先改用文字方案发布'
    );
    expect(screen.getByTestId('composer-report-quota')).toHaveTextContent(
      '已经退回'
    );
    // D-116: nothing on a merchant card may read as engineering output.
    expect(
      cardLanguageIssues(card.textContent ?? '', ['task-1', 'work-1'])
    ).toEqual([]);
  });

  it('offers a way back in rather than a dead end', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        onRecover={onRecover}
        session={failed()}
        stream={projectResultTokenStream({ workspaceKind: 'copy' })}
      />
    );

    const actions = within(screen.getByTestId('composer-report-actions'));
    await user.click(screen.getByTestId('composer-report-action-retry'));
    expect(onRecover).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retry' })
    );
    expect(
      actions.getByTestId('composer-report-action-switch_form')
    ).toBeInTheDocument();
  });

  it('never claims a refund the run did not make', () => {
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        onRecover={() => {}}
        session={failed({ ...failureReport, quotaRefunded: false })}
        stream={projectResultTokenStream({ workspaceKind: 'copy' })}
      />
    );

    expect(screen.queryByTestId('composer-report-quota')).toBeNull();
  });

  it('a partial delivery keeps the deliverable and declares the rest', () => {
    const delivered = applyComposerWorkflowState(
      running(),
      'success',
      { packageId: 'package-1', versionId: 'version-1', revision: 3 },
      undefined,
      {
        kind: 'partial',
        category: 'consistency',
        message: '整套图文已经生成好了；其中 1 页的画面和文字还没完全对上。',
        nextStep: '可以先用已经对好的页面发布，稍后再让我重做那一页。',
        actions: ['review_partial', 'retry'],
        quotaRefunded: false,
      }
    );
    render(
      <ComposerConversation
        onOpenDelivery={() => {}}
        onRecover={() => {}}
        session={delivered}
        stream={projectResultTokenStream({ workspaceKind: 'copy' })}
      />
    );

    expect(screen.getByTestId('composer-delivery-turn')).toBeInTheDocument();
    const card = screen.getByTestId('composer-report-card');
    expect(card).toHaveAttribute('data-report-kind', 'partial');
    expect(
      screen.getByTestId('composer-report-action-review_partial')
    ).toBeInTheDocument();
    expect(cardLanguageIssues(card.textContent ?? '', [])).toEqual([]);
  });
});
