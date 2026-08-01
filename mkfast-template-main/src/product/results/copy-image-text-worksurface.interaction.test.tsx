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

  it('shows a rewrite action only with a real handler', async () => {
    const user = userEvent.setup();
    const onSelectionRewrite = vi.fn();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={onSelectionRewrite}
      />
    );

    await user.click(screen.getByTestId('copy-rewrite-rewrite'));
    expect(onSelectionRewrite).toHaveBeenCalled();
    expect(onSelectionRewrite.mock.calls[0]?.[0]).toBe('rewrite');
  });

  it('says which text a rewrite will touch before the click', async () => {
    const user = userEvent.setup();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={vi.fn()}
        onSelectionRewriteResolved={vi.fn()}
      />
    );

    // No selection: the rewrite runs over the whole 正文 and says so.
    // Body is Tiptap (object workspace); default scope is whole_document.
    const panel = screen.getByTestId('copy-selection-rewrite');
    expect(panel).toHaveAttribute('data-rewrite-scope', 'whole_document');
    expect(
      screen.getByTestId('copy-selection-rewrite-scope')
    ).toHaveTextContent('将改写整篇文案');

    // Whole-document path stays available and never blocks.
    await user.click(screen.getByTestId('copy-rewrite-rewrite'));
    expect(
      screen.getByTestId('copy-selection-rewrite-preview')
    ).toHaveAttribute('data-rewrite-scope', 'whole_document');
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

  it('surfaces base-revision drift conflict for selection rewrite', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        currentRevisionId="rev-stale-other"
        onSelectionRewrite={vi.fn()}
        onSelectionRewriteResolved={onResolved}
      />
    );
    await user.click(screen.getByTestId('copy-rewrite-shorten'));
    expect(onResolved).toHaveBeenCalled();
    expect(onResolved.mock.calls[0]?.[0]?.kind).toBe('conflict');
    expect(
      await screen.findByTestId('copy-selection-rewrite-conflict')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('copy-rewrite-conflict-compare')
    ).toBeInTheDocument();
  });
});
