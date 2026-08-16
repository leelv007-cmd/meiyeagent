/**
 * RTL: copy / image_text worksurface panels + adjust prompt.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyImageTextWorksurface } from './copy-image-text-worksurface';

afterEach(() => {
  cleanup();
});

const facts = {
  workId: 'work-copy',
  packageId: 'package-1',
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

async function selectBodyPrefix(
  _user: ReturnType<typeof userEvent.setup>,
  length = 4
) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.querySelector('[data-testid="copy-field-body"]'),
  });
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(),
    },
    getClientRects: {
      configurable: true,
      value: () => [],
    },
  });
  const body = screen.getByTestId('copy-field-body');
  body.focus();
  const textNode = body.querySelector('p')?.firstChild;
  if (!(textNode instanceof Text)) throw new Error('Missing editor text node');
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.collapse(textNode, 0);
  fireEvent(document, new Event('selectionchange', { bubbles: true }));
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, length);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event('selectionchange', { bubbles: true }));
  await waitFor(() =>
    expect(
      screen.getByTestId('object-workspace-selection-ai-scope')
    ).toHaveTextContent(`已选中 ${length} 个字`)
  );
}

describe('copy / image_text worksurface', () => {
  it('renders only supported result actions alongside editing and preview', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(screen.getByTestId('copy-edit-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-selection-rewrite')).toBeNull();
    expect(screen.getByTestId('copy-fact-sources')).toBeInTheDocument();
    expect(screen.getByTestId('copy-platform-preview')).toBeInTheDocument();
    expect(screen.getByTestId('result-adjust-prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('还想怎么改？')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-adopt-action')).toBeNull();
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
    await selectBodyPrefix(user);

    await user.click(screen.getByTestId('selection-ai-rewrite'));
    // Same crypto.subtle.digest hop the sensitive-inline-check site trips on:
    // user.click settles act, not a Web Crypto promise. Not yet observed
    // failing, fixed alongside its twin so the next red is relocated rather
    // than removed. This suite runs on real timers, so waitFor works here.
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(1));
    expect(onAdjust.mock.calls[0]?.[0]).toMatch(/改写以下选区/u);
    expect(onAdjust.mock.calls[0]?.[1]).toMatchObject({
      end: 4,
      kind: 'text_selection',
      packageId: facts.packageId,
      selectedText: '限时优惠',
      start: 0,
      versionId: facts.baseRevisionId,
    });
  });

  it('does not fabricate the whole document as a selection anchor', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);

    const panel = screen.getByTestId('object-workspace-selection-ai');
    expect(panel).toHaveAttribute('data-rewrite-scope', 'selection_required');
    expect(
      screen.getByTestId('object-workspace-selection-ai-scope')
    ).toHaveTextContent('先在正文里选中要调整的文字');

    await user.click(screen.getByTestId('selection-ai-rewrite'));
    expect(onAdjust).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '请先选择一段文字'
    );
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
    const { rerender } = render(
      <CopyImageTextWorksurface
        facts={facts}
        currentRevisionId="rev-stale-other"
        onAdjust={onAdjust}
        onSelectionRewriteResolved={onResolved}
      />
    );
    await selectBodyPrefix(user);
    await user.click(screen.getByTestId('selection-ai-shorten'));
    expect(onResolved).toHaveBeenCalled();
    expect(onResolved.mock.calls[0]?.[0]?.kind).toBe('conflict');
    expect(onAdjust).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId('copy-selection-rewrite-conflict')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('copy-rewrite-conflict-compare')).toBeNull();
    expect(screen.queryByTestId('copy-rewrite-conflict-reapply')).toBeNull();

    rerender(
      <CopyImageTextWorksurface
        facts={{
          ...facts,
          baseRevisionId: 'rev-2',
          document: { ...facts.document, body: '服务升级后的正文。' },
        }}
        currentRevisionId="rev-stale-other"
        onAdjust={onAdjust}
        onSelectionRewriteResolved={onResolved}
      />
    );
    await screen.findByText('服务升级后的正文。');
    expect(screen.queryByTestId('copy-selection-rewrite-conflict')).toBeNull();

    await selectBodyPrefix(user);
    await user.click(screen.getByTestId('selection-ai-shorten'));
    expect(
      await screen.findByTestId('copy-selection-rewrite-conflict')
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('copy-rewrite-conflict-discard'));
    expect(screen.queryByTestId('copy-selection-rewrite-conflict')).toBeNull();
  });
});
