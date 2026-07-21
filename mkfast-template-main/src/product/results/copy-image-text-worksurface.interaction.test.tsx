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
  it('renders edit, rewrite, facts, platform preview, and 还想怎么改？', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(screen.getByTestId('copy-edit-panel')).toBeInTheDocument();
    expect(screen.getByTestId('copy-selection-rewrite')).toBeInTheDocument();
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
    expect(screen.getByTestId('copy-rewrite-rewrite')).toBeDisabled();
    await user.click(screen.getByTestId('copy-carrier-wechat_moments'));
    expect(screen.getByTestId('copy-carrier-wechat_moments')).toHaveAttribute(
      'data-active',
      'true'
    );
  });
});
