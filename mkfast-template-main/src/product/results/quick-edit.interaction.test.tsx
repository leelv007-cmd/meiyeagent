/**
 * RTL: the W07 quick-edit seam on the copy worksurface.
 *
 * The contract side of quick edits shipped long ago; what these cover is the
 * part that did not exist — a merchant gesture that produces a QuickEditIntent.
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
    body: '限时优惠套餐，抢购从速。',
    conversionHook: '私信预约',
    topics: ['美甲'],
    orderedAssetIds: [] as string[],
  },
  factSources: [],
  lifecycle: 'adopted' as const,
  viewport: 'desktop' as const,
};

describe('quick edit on the copy worksurface', () => {
  it('shows a diff before anything is written, and writes only on 就用这版', async () => {
    const user = userEvent.setup();
    const onQuickEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={vi.fn()}
        onQuickEdit={onQuickEdit}
      />
    );

    await user.click(screen.getByTestId('copy-rewrite-weaker_promo'));

    const preview = await screen.findByTestId('copy-selection-rewrite-preview');
    expect(preview).toHaveAttribute('data-rewrite-action', 'weaker_promo');
    expect(
      screen.getByTestId('copy-selection-rewrite-before')
    ).toHaveTextContent('限时优惠套餐');
    // Preview alone must not write.
    expect(onQuickEdit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('copy-selection-rewrite-adopt'));

    expect(onQuickEdit).toHaveBeenCalledTimes(1);
    const request = onQuickEdit.mock.calls[0]![0];
    expect(request.action).toBe('promotion_weaker');
    expect(request.changes.body).not.toBe(facts.document.body);
    expect(request.changes.title).toBe('夏日美甲');
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
  });

  it('keeps the document unchanged when the merchant backs out', async () => {
    const user = userEvent.setup();
    const onQuickEdit = vi.fn();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={vi.fn()}
        onQuickEdit={onQuickEdit}
      />
    );
    await user.click(screen.getByTestId('copy-rewrite-stronger_cta'));
    await user.click(screen.getByTestId('copy-selection-rewrite-cancel'));
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
    expect(onQuickEdit).not.toHaveBeenCalled();
  });

  it('sends the four first-batch export intents', async () => {
    const user = userEvent.setup();
    const onQuickEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <CopyImageTextWorksurface facts={facts} onQuickEdit={onQuickEdit} />
    );
    for (const action of [
      'poster',
      'image_set',
      'spoken_script',
      'appointment_card',
    ]) {
      await user.click(screen.getByTestId(`copy-export-use-${action}`));
    }
    expect(onQuickEdit.mock.calls.map((call) => call[0].action)).toEqual([
      'poster',
      'image_set',
      'spoken_script',
      'appointment_card',
    ]);
  });

  it('hides the export row when the page has no write seam', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    expect(screen.queryByTestId('copy-export-use-actions')).toBeNull();
  });

  it('says why a rewrite failed instead of swallowing it', async () => {
    const user = userEvent.setup();
    const onQuickEdit = vi
      .fn()
      .mockRejectedValue(new Error('这一版已经被改过了，刷新后再试。'));
    render(
      <CopyImageTextWorksurface facts={facts} onQuickEdit={onQuickEdit} />
    );
    await user.click(screen.getByTestId('copy-export-use-poster'));
    expect(
      await screen.findByTestId('copy-quick-edit-error')
    ).toHaveTextContent('这一版已经被改过了');
  });

  it('tells the merchant why 还想怎么改 is unavailable rather than doing nothing', () => {
    render(
      <CopyImageTextWorksurface
        facts={facts}
        adjustUnavailableReason="这条是早期留下的成品，改写要从新的一次创作开始。"
      />
    );
    expect(screen.getByTestId('result-adjust-unavailable')).toHaveTextContent(
      '早期留下的成品'
    );
    expect(screen.getByTestId('result-adjust-input')).toBeDisabled();
    expect(screen.getByTestId('result-adjust-submit')).toBeDisabled();
  });
});
