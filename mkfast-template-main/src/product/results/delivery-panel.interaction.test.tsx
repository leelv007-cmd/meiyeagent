import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handedOverReceiptFixture } from './delivery-assisted-model';
import {
  DeliveryPanel,
  type DeliverySensitiveWordsCheckState,
} from './delivery-panel';
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
      assistedReceipt: handedOverReceiptFixture(),
      hasExternalSendApproval: true,
    });
    render(<DeliveryPanel view={assistedView} onAction={onAction} />);

    await user.click(
      screen.getByTestId('delivery-assisted-role-external_owner')
    );
    expect(screen.getByTestId('delivery-action-assisted')).toBeDisabled();
    expect(screen.getByTestId('delivery-assisted-cta')).toBeDisabled();
    await user.type(
      screen.getByTestId('delivery-assisted-owner-id'),
      'publisher-li'
    );
    expect(screen.getByTestId('delivery-action-assisted')).toBeEnabled();
    expect(screen.getByTestId('delivery-assisted-cta')).toBeEnabled();
    await user.click(screen.getByTestId('delivery-action-assisted'));

    expect(onAction).toHaveBeenCalledWith('assisted', {
      ownerId: 'publisher-li',
      responsibilityRole: 'external_owner',
    });
  });

  const blockedSensitiveStates: Array<
    [string, DeliverySensitiveWordsCheckState]
  > = [
    ['checking', { kind: 'checking' }],
    [
      'hits',
      {
        kind: 'ready',
        checkBar: {
          schemaVersion: 'sensitive-check-bar/v1',
          status: 'hits',
          summary: '检出 1 处违禁词。',
          items: [],
        },
      },
    ],
    ['error', { kind: 'failed' }],
  ];

  it.each(
    blockedSensitiveStates
  )('keeps both assisted handoff controls fail-closed while the sensitive-word check is %s', async (_status, sensitiveWordsCheck) => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <DeliveryPanel
        view={projectDeliveryPanel({
          ...viewFacts(),
          assistedReceipt: handedOverReceiptFixture(),
          hasExternalSendApproval: true,
        })}
        onAction={onAction}
        sensitiveWordsCheck={sensitiveWordsCheck}
      />
    );

    const groupedAction = screen.getByTestId('delivery-action-assisted');
    const receiptCta = screen.getByTestId('delivery-assisted-cta');
    expect(groupedAction).toBeDisabled();
    expect(receiptCta).toBeDisabled();
    await user.click(groupedAction);
    await user.click(receiptCta);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('blocks the receipt CTA while another assisted action is pending', async () => {
    const user = userEvent.setup();
    let complete: ((value: 'handed_over') => void) | undefined;
    const onAction = vi.fn(
      () =>
        new Promise<'handed_over'>((resolve) => {
          complete = resolve;
        })
    );
    render(
      <DeliveryPanel
        view={projectDeliveryPanel({
          ...viewFacts(),
          assistedReceipt: handedOverReceiptFixture(),
          hasExternalSendApproval: true,
        })}
        onAction={onAction}
      />
    );

    await user.click(screen.getByTestId('delivery-action-assisted'));
    expect(screen.getByTestId('delivery-assisted-cta')).toBeDisabled();
    complete?.('handed_over');
    await waitFor(() =>
      expect(screen.getByTestId('delivery-assisted-cta')).toBeEnabled()
    );
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
