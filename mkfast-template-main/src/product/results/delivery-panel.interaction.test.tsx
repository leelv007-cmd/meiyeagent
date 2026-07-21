import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeliveryPanel } from './delivery-panel';
import { projectDeliveryPanel } from './delivery-panel-model';

afterEach(() => cleanup());

function view() {
  return projectDeliveryPanel({
    target: 'xiaohongshu',
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: false,
    shareDevice: {
      hasNavigatorShare: false,
      canShareFiles: false,
      canShareText: false,
    },
    sharePayload: { kind: 'files', downloadHref: '/download.zip' },
    nowIso: '2026-07-20T12:00:00.000Z',
    viewport: 'desktop',
  });
}

describe('delivery panel command outcomes', () => {
  it('announces download only after the real action resolves', async () => {
    const user = userEvent.setup();
    let complete: ((value: 'download_done') => void) | undefined;
    const onAction = vi.fn(
      () =>
        new Promise<'download_done'>((resolve) => {
          complete = resolve;
        })
    );
    render(<DeliveryPanel view={view()} onAction={onAction} />);

    await user.click(screen.getByTestId('delivery-action-full_package'));
    expect(screen.queryByTestId('delivery-outcome-download-done')).toBeNull();
    complete?.('download_done');
    expect(
      await screen.findByTestId('delivery-outcome-download-done')
    ).toHaveAttribute('data-platform-published', 'false');
  });

  it('does not invent a delivery outcome when the command rejects', async () => {
    const user = userEvent.setup();
    render(
      <DeliveryPanel
        view={view()}
        onAction={() => Promise.reject(new Error('export failed'))}
      />
    );

    await user.click(screen.getByTestId('delivery-action-full_package'));
    expect(screen.queryByTestId('delivery-outcome-download-done')).toBeNull();
  });

  it('lets the merchant choose an external responsible person before durable assisted handoff', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => 'handed_over' as const);
    const assistedView = projectDeliveryPanel({
      ...viewFacts(),
      hasExternalSendApproval: true,
    });
    render(<DeliveryPanel view={assistedView} onAction={onAction} />);

    await user.click(
      screen.getByTestId('delivery-assisted-role-external_owner')
    );
    await user.type(
      screen.getByTestId('delivery-assisted-owner-id'),
      'publisher-li'
    );
    await user.click(screen.getByTestId('delivery-action-assisted'));

    expect(onAction).toHaveBeenCalledWith('assisted', {
      ownerId: 'publisher-li',
      responsibilityRole: 'external_owner',
    });
  });
});

function viewFacts() {
  return {
    target: 'xiaohongshu' as const,
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: false,
    shareDevice: {
      hasNavigatorShare: false,
      canShareFiles: false,
      canShareText: false,
    },
    sharePayload: { kind: 'files' as const, downloadHref: '/download.zip' },
    nowIso: '2026-07-20T12:00:00.000Z',
    viewport: 'desktop' as const,
  };
}
