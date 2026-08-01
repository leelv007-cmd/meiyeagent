/**
 * RTL: copy / image_text worksurface panels + adjust prompt.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyImageTextWorksurface } from './copy-image-text-worksurface';

afterEach(() => {
  cleanup();
});

const facts = {
  workId: 'work-copy',
  baseRevisionId: 'rev-1',
  document: {
    title: '夏日美甲',
    body: '限时优惠套餐。',
    conversionHook: '私信预约',
    topics: ['美甲'],
    orderedAssetIds: [] as string[],
  },
  factSources: [
    {
      id: 'f1',
      kind: 'price' as const,
      label: '美甲价',
      summary: '128 元',
      status: 'pending' as const,
    },
  ],
  lifecycle: 'candidate' as const,
  viewport: 'mobile' as const,
};

describe('copy / image_text worksurface', () => {
  it('renders only supported result actions alongside editing and preview', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(screen.getByTestId('copy-edit-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-selection-rewrite')).toBeNull();
    expect(screen.getByTestId('copy-fact-sources')).toBeInTheDocument();
    expect(screen.getByTestId('copy-platform-preview')).toBeInTheDocument();
    expect(screen.getByTestId('result-adjust-prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('还想怎么改？')).toBeInTheDocument();
    expect(screen.getByTestId('copy-adopt-action')).toHaveTextContent(
      '采用此版本'
    );
  });

  it('submits free-text adjust', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn();
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);
    await user.type(screen.getByTestId('result-adjust-input'), '语气更柔和');
    await user.click(screen.getByTestId('result-adjust-submit'));
    expect(onAdjust).toHaveBeenCalledWith('语气更柔和');
  });

  it('mobile never shows 请到桌面继续', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(
      screen.getByTestId('copy-mobile-desktop-gate')
    ).toBeEmptyDOMElement();
    expect(screen.queryByText(/请到桌面/)).toBeNull();
  });

  it('rejects client-concat platform bodies when mis-tagged as formal', () => {
    render(
      <CopyImageTextWorksurface
        facts={{
          ...facts,
          selectedCarrier: 'xiaohongshu',
          platformPreviews: [
            {
              carrier: 'xiaohongshu',
              title: '假平台',
              body: '平台版\n拼接正文',
              conversionHook: 'x',
              topics: [],
              source: 'copy.adapt',
            },
          ],
        }}
      />
    );
    // Body is client-concat → treated as missing formal variant (pending).
    expect(
      screen.getByTestId('copy-platform-preview-pending')
    ).toBeInTheDocument();
  });

  it('does not expose inert rewrite actions and switches preview carrier locally', async () => {
    const user = userEvent.setup();
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(screen.queryByTestId('copy-rewrite-rewrite')).toBeNull();
    await user.click(screen.getByTestId('copy-carrier-wechat_moments'));
    expect(screen.getByTestId('copy-carrier-wechat_moments')).toHaveAttribute(
      'data-active',
      'true'
    );
  });

  it('keeps adoption failures visible and lets the user retry', async () => {
    const user = userEvent.setup();
    const onAdopt = vi
      .fn()
      .mockRejectedValue(new Error('正式平台版本生成失败'));
    render(<CopyImageTextWorksurface facts={facts} onAdopt={onAdopt} />);

    await user.click(screen.getByTestId('copy-adopt-action'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '正式平台版本生成失败'
    );
    expect(screen.getByTestId('copy-adopt-action')).toBeEnabled();
    expect(onAdopt).toHaveBeenCalledTimes(1);
  });

  it('surfaces hand-edit OCC failures without discarding the draft', async () => {
    const user = userEvent.setup();
    const onHandEdit = vi
      .fn()
      .mockRejectedValue(new Error('正文已有新版本，刷新后再试'));
    render(<CopyImageTextWorksurface facts={facts} onHandEdit={onHandEdit} />);

    const title = screen.getByTestId('copy-field-title');
    await user.clear(title);
    await user.type(title, '夏日美甲新标题');
    await user.click(screen.getByTestId('copy-save-hand-edit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '正文已有新版本'
    );
    expect(title).toHaveValue('夏日美甲新标题');
    expect(screen.getByTestId('copy-save-hand-edit')).toBeEnabled();
  });

  it('shows selection AI only with the model adjust seam', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);

    await user.click(screen.getByTestId('selection-ai-rewrite'));
    expect(onAdjust).toHaveBeenCalledTimes(1);
    expect(onAdjust.mock.calls[0]?.[0]).toMatch(/改写以下选区/u);
  });

  it('says which text a rewrite will touch before the click', async () => {
    const user = userEvent.setup();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
      />
    );

    // No selection: the rewrite runs over the whole 正文 and says so.
    // Body is Tiptap (object workspace); default scope is whole_document.
    const panel = screen.getByTestId('object-workspace-selection-ai');
    expect(panel).toHaveAttribute('data-rewrite-scope', 'whole_document');
    expect(
      screen.getByTestId('object-workspace-selection-ai-scope')
    ).toHaveTextContent('将改写整篇文案');

    await user.click(screen.getByTestId('selection-ai-rewrite'));
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
  });

  it('keeps alternatives collapsed by default and expands on demand', async () => {
    const user = userEvent.setup();
    render(
      <CopyImageTextWorksurface
        facts={{
          ...facts,
          alternativeCandidates: [
            {
              candidateId: 'alt-1',
              title: '备选标题',
              body: '备选正文',
              conversionHook: '到店',
            },
          ],
        }}
      />
    );
    expect(screen.getByTestId('copy-primary-badge')).toHaveTextContent(
      '默认展开'
    );
    expect(screen.getByTestId('copy-alternatives-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-alternatives-list')).toBeNull();
    await user.click(screen.getByTestId('copy-alternatives-toggle'));
    expect(screen.getByTestId('copy-alternatives-list')).toBeInTheDocument();
    expect(screen.getByText('备选标题')).toBeInTheDocument();
  });

  it('blocks selection AI when its base revision has drifted', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn();
    const onResolved = vi.fn();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        currentRevisionId="rev-stale-other"
        onAdjust={onAdjust}
        onSelectionRewriteResolved={onResolved}
      />
    );
    await user.click(screen.getByTestId('selection-ai-shorten'));
    expect(onResolved).toHaveBeenCalled();
    expect(onResolved.mock.calls[0]?.[0]?.kind).toBe('conflict');
    expect(onAdjust).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId('copy-selection-rewrite-conflict')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('copy-rewrite-conflict-compare')).toBeNull();
    expect(screen.queryByTestId('copy-rewrite-conflict-reapply')).toBeNull();
    await user.click(screen.getByTestId('copy-rewrite-conflict-discard'));
    expect(screen.queryByTestId('copy-selection-rewrite-conflict')).toBeNull();
  });
});
