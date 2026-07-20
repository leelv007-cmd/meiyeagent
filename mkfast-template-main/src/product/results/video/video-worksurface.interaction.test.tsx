import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { videoWorksurfaceFixture } from './video-worksurface-model';
import { VideoWorksurface } from './video-worksurface';

afterEach(() => cleanup());

describe('video result worksurface', () => {
  it('renders player, cover, subtitle proof, storyboard and regeneration controls', () => {
    render(<VideoWorksurface initialState={videoWorksurfaceFixture()} />);

    expect(screen.getByTestId('video-worksurface')).toBeInTheDocument();
    expect(screen.getByTestId('video-player')).toBeInTheDocument();
    expect(screen.getByTestId('video-cover-panel')).toBeInTheDocument();
    expect(screen.getByTestId('video-subtitle-panel')).toBeInTheDocument();
    expect(screen.getByTestId('video-storyboard')).toBeInTheDocument();
    expect(screen.getAllByTestId('video-shot')).toHaveLength(3);
    expect(screen.getByTestId('video-full-recompose')).toHaveTextContent(
      '重新合成整段'
    );
  });

  it('adopts the candidate and opens delivery without inventing a delivered receipt', async () => {
    const user = userEvent.setup();
    const onAdopt = vi.fn();
    const onDeliver = vi.fn();
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onAdopt={onAdopt}
        onDeliver={onDeliver}
      />
    );

    await user.click(screen.getByTestId('video-adopt-action'));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('video-loop-phase')).toHaveTextContent('adopted');

    await user.click(screen.getByTestId('video-deliver-action'));
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('video-loop-phase')).toHaveTextContent('adopted');
  });

  it('keeps independent subtitle proof free and opens confirmation for burned-in edits', async () => {
    const user = userEvent.setup();
    const onSubtitleChange = vi.fn();
    const { rerender } = render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const input = screen.getByTestId('video-subtitle-input');
    await user.clear(input);
    await user.type(input, '新的独立字幕');
    expect(onSubtitleChange).toHaveBeenLastCalledWith(
      '新的独立字幕',
      expect.objectContaining({ fee: 'none' })
    );

    rerender(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture({
          subtitleMode: 'burned_in',
        })}
      />
    );
    const burnedInput = screen.getByTestId('video-subtitle-input');
    await user.clear(burnedInput);
    await user.type(burnedInput, '烧录字幕改动');
    expect(screen.getByTestId('video-regen-confirm')).toHaveTextContent(
      '重新合成整段'
    );
  });

  it('builds Pro Studio handoff with current revision and uncommitted adjustments', async () => {
    const user = userEvent.setup();
    const onOpenProStudio = vi.fn();
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture({
          uncommitted: { subtitleDraftText: '待提交字幕' },
        })}
        onOpenProStudio={onOpenProStudio}
      />
    );

    await user.click(screen.getByTestId('video-pro-studio-refine'));
    expect(onOpenProStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPath: '/pro-studio',
        workId: 'work-video-1',
        baseRevisionId: 'rev-cp-2',
        uncommitted: { subtitleDraftText: '待提交字幕' },
      })
    );
  });

  it('renders the server quote and confirms a derived regeneration task only after approval', async () => {
    const user = userEvent.setup();
    const onRequestRegenerationQuote = vi.fn().mockResolvedValue({
      confirm: {
        actionLabel: '重新生成此镜头',
        authorizedCeiling: 0.32,
        billingModeLabel: '按生成成片 4 秒计费',
        createsNewTaskAndIndependentQuote: true,
        createsNewTaskNotice: '确认后创建新任务',
        estimatedCredits: 0.24,
        eta: {
          estimatedCompletionAt: null,
          honestyNote: '实际完成时间以供应商为准',
          status: 'unknown',
        },
        formulaExpression: 'max(4s, actual) × 0.06',
        quoteId: 'quote-server-1',
        quoteRevision: 'quote-rev-1',
        scope: 'shot',
        targetSeconds: 4,
      },
      quote: { formula: { currency: 'CNY' } },
      scope: 'shot',
    });
    const onConfirmRegeneration = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onRequestRegenerationQuote={onRequestRegenerationQuote}
        onConfirmRegeneration={onConfirmRegeneration}
      />
    );

    await user.click(screen.getAllByTestId('video-shot-regenerate')[0]!);
    expect(onRequestRegenerationQuote).toHaveBeenCalledWith({
      scope: 'shot',
      shotId: 'shot-opening',
      sourceRunId: 'wf-video-fixture-1',
    });
    expect(await screen.findByTestId('video-regen-confirm')).toHaveTextContent(
      '预估¥0.24'
    );
    expect(screen.getByTestId('video-regen-confirm')).toHaveTextContent(
      '按生成成片 4 秒计费'
    );

    await user.click(screen.getByTestId('video-regen-confirm-action'));
    expect(onConfirmRegeneration).toHaveBeenCalledWith({
      quoteId: 'quote-server-1',
      taskId: expect.stringMatching(/^video-regen-/),
    });
    expect(screen.queryByTestId('video-regen-confirm')).not.toBeInTheDocument();
  });

  it('cancels a server quote without creating a derived task', async () => {
    const user = userEvent.setup();
    const onRequestRegenerationQuote = vi.fn().mockResolvedValue({
      confirm: {
        actionLabel: '重新合成整段',
        authorizedCeiling: 1.5,
        billingModeLabel: '按生成成片 24 秒计费',
        createsNewTaskAndIndependentQuote: true,
        createsNewTaskNotice: '确认后创建新任务',
        estimatedCredits: 1.44,
        eta: {
          estimatedCompletionAt: null,
          honestyNote: '实际完成时间以供应商为准',
          status: 'unknown',
        },
        formulaExpression: '24 × 0.06',
        quoteId: 'quote-server-2',
        quoteRevision: 'quote-rev-2',
        scope: 'full_compose',
        targetSeconds: 24,
      },
      quote: { formula: { currency: 'CNY' } },
      scope: 'full_compose',
    });
    const onConfirmRegeneration = vi.fn();
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onRequestRegenerationQuote={onRequestRegenerationQuote}
        onConfirmRegeneration={onConfirmRegeneration}
      />
    );

    await user.click(screen.getByTestId('video-full-recompose'));
    await screen.findByTestId('video-regen-confirm');
    await user.click(screen.getByTestId('video-regen-cancel-action'));

    expect(onConfirmRegeneration).not.toHaveBeenCalled();
    expect(screen.queryByTestId('video-regen-confirm')).not.toBeInTheDocument();
  });

  it('reuses the same derived task id when confirmation is retried', async () => {
    const user = userEvent.setup();
    const onRequestRegenerationQuote = vi.fn().mockResolvedValue({
      confirm: {
        actionLabel: '重新合成整段',
        authorizedCeiling: 1.5,
        billingModeLabel: '按生成成片 24 秒计费',
        createsNewTaskAndIndependentQuote: true,
        createsNewTaskNotice: '确认后创建新任务',
        estimatedCredits: 1.44,
        eta: {
          estimatedCompletionAt: null,
          honestyNote: '实际完成时间以供应商为准',
          status: 'unknown',
        },
        formulaExpression: '24 × 0.06',
        quoteId: 'quote-retry',
        quoteRevision: 'quote-rev-retry',
        scope: 'full_compose',
        targetSeconds: 24,
      },
      quote: { formula: { currency: 'CNY' } },
      scope: 'full_compose',
    });
    const onConfirmRegeneration = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce(undefined);
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onRequestRegenerationQuote={onRequestRegenerationQuote}
        onConfirmRegeneration={onConfirmRegeneration}
      />
    );

    await user.click(screen.getByTestId('video-full-recompose'));
    await screen.findByTestId('video-regen-confirm-action');
    await user.click(screen.getByTestId('video-regen-confirm-action'));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    await user.click(screen.getByTestId('video-regen-confirm-action'));

    const firstTaskId = onConfirmRegeneration.mock.calls[0]?.[0].taskId;
    const retryTaskId = onConfirmRegeneration.mock.calls[1]?.[0].taskId;
    expect(retryTaskId).toBe(firstTaskId);
  });

  it('persists candidate selection, shot order and subtitle text through canonical commands', async () => {
    const user = userEvent.setup();
    const onCanonicalEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onCanonicalEdit={onCanonicalEdit}
      />
    );

    await user.click(screen.getAllByTestId('video-shot-candidate')[1]!);
    expect(onCanonicalEdit).toHaveBeenLastCalledWith({
      candidateIndex: 1,
      expectedRevision: 3,
      kind: 'select_candidate',
      shotId: 'shot-opening',
      workflowId: 'wf-video-fixture-1',
    });

    await user.click(screen.getByLabelText('后移镜头 1'));
    expect(onCanonicalEdit).toHaveBeenLastCalledWith({
      expectedRevision: 3,
      kind: 'reorder_shots',
      shotIds: ['shot-service', 'shot-opening', 'shot-cta'],
      workflowId: 'wf-video-fixture-1',
    });

    const input = screen.getByTestId('video-subtitle-input');
    await user.clear(input);
    await user.type(input, '已持久化字幕');
    await user.click(screen.getByTestId('video-subtitle-save'));
    expect(onCanonicalEdit).toHaveBeenLastCalledWith({
      expectedRevision: 3,
      kind: 'set_subtitle',
      text: '已持久化字幕',
      workflowId: 'wf-video-fixture-1',
    });
  });
});
