/**
 * P2-11 / #323 — Delivered secondary AI cover: three ratios selectable.
 * @vitest-environment jsdom
 */

import type { ContentPackageRevisionDelivery } from '@meiye/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerDeliveryCard } from './composer-delivery-card';
import { AI_COVER_ASPECT_RATIOS, AI_COVER_SIZE_MAP } from './ai-cover-action';

const revision: ContentPackageRevisionDelivery = {
  packageId: 'pkg-1',
  revision: 1,
  versionId: 'ver-1',
};

afterEach(() => {
  cleanup();
});

describe('Delivered AI cover secondary action', () => {
  it('exposes three selectable ratios and prefills without opening Result Center', async () => {
    const user = userEvent.setup();
    const onAiCover = vi.fn();
    const onOpen = vi.fn();
    const onFollowUp = vi.fn();

    render(
      <ComposerDeliveryCard
        lensId="image_text"
        onAiCover={onAiCover}
        onFollowUp={onFollowUp}
        onOpen={onOpen}
        revision={revision}
        statement="成品已就绪"
        taskId="task-1"
        workId="work-1"
      />
    );

    expect(screen.getByTestId('composer-delivery-ai-cover')).toBeInTheDocument();
    await user.click(screen.getByTestId('composer-delivery-ai-cover-toggle'));

    const ratios = screen.getByTestId('composer-delivery-ai-cover-ratios');
    for (const ratio of AI_COVER_ASPECT_RATIOS) {
      const button = within(ratios).getByTestId(
        `composer-delivery-ai-cover-ratio-${ratio.replace(':', '-')}`
      );
      expect(button).toHaveAttribute('data-aspect-ratio', ratio);
      expect(button).toHaveAttribute('data-size', AI_COVER_SIZE_MAP[ratio]);
    }

    await user.click(
      screen.getByTestId('composer-delivery-ai-cover-ratio-9-16')
    );

    expect(onAiCover).toHaveBeenCalledTimes(1);
    expect(onAiCover.mock.calls[0]?.[0]).toMatchObject({
      id: 'ai_cover',
      aspectRatio: '9:16',
      size: '1440x2560',
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  it('does not show AI cover on pure copy deliveries', () => {
    render(
      <ComposerDeliveryCard
        lensId="copy"
        onAiCover={vi.fn()}
        onOpen={vi.fn()}
        revision={revision}
        statement="文案已就绪"
        taskId="task-2"
        workId="work-2"
      />
    );
    expect(screen.queryByTestId('composer-delivery-ai-cover')).toBeNull();
  });

  it('does not show AI cover without an onAiCover exit', () => {
    render(
      <ComposerDeliveryCard
        lensId="image_text"
        onOpen={vi.fn()}
        revision={revision}
        statement="成品已就绪"
        taskId="task-3"
        workId="work-3"
      />
    );
    expect(screen.queryByTestId('composer-delivery-ai-cover')).toBeNull();
  });
});
