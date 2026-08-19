import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
  useQuery,
} from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalHandoffQueryOptions } from './canonical-handoff-query';
import { handedOverReceiptFixture } from './delivery-assisted-model';

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

function HandoffQuery(props: {
  client: QueryClient;
  submit: (
    action: string,
    payload: Record<string, unknown>
  ) => Promise<unknown>;
}) {
  return (
    <QueryClientProvider client={props.client}>
      <HandoffQueryState submit={props.submit} />
    </QueryClientProvider>
  );
}

function HandoffQueryState(props: {
  submit: (
    action: string,
    payload: Record<string, unknown>
  ) => Promise<unknown>;
}) {
  const query = useQuery(
    canonicalHandoffQueryOptions({
      canShareFiles: false,
      nowIso: () => '2026-07-20T10:00:00.000Z',
      origin: 'https://app.example',
      submit: props.submit,
      token: 'canonical-live-token-1234',
    })
  );
  return <output data-testid="handoff-kind">{query.data?.resolve.kind}</output>;
}

describe('canonical handoff query lifecycle', () => {
  it('retains the first success across focus, reconnect and remount but not a new page session', async () => {
    const receipt = handedOverReceiptFixture({
      handoffLink: {
        consumedAt: '2026-07-20T10:00:00.000Z',
        createdAt: '2026-07-20T09:01:00.000Z',
        expiresAt: '2026-07-23T09:01:00.000Z',
        token: 'canonical-live-token-1234',
      },
    });
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        handoff: {
          assistedReceipt: receipt,
          body: '到店立减',
          checklist: ['核对价格'],
          contentPackageRevision: 4,
          conversionText: '私信预约',
          expiresAt: '2026-07-23T09:01:00.000Z',
          exportReceiptId: 'export-1',
          media: [],
          packageId: 'pkg-1',
          platform: 'xiaohongshu',
          sharePath: '/dashboard/handoff/canonical-live-token-1234',
          title: '夏日美甲',
          token: 'canonical-live-token-1234',
          topics: ['美甲'],
          variantVersionId: 'variant-v1',
        },
        kind: 'ok',
        receipt,
        revision: 2,
      })
      .mockResolvedValue({ kind: 'consumed' });
    const client = new QueryClient();
    const first = render(<HandoffQuery client={client} submit={submit} />);

    await waitFor(() =>
      expect(screen.getByTestId('handoff-kind')).toHaveTextContent('ready')
    );
    expect(submit).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<HandoffQuery client={client} submit={submit} />);
    await waitFor(() =>
      expect(screen.getByTestId('handoff-kind')).toHaveTextContent('ready')
    );
    expect(submit).toHaveBeenCalledTimes(1);

    cleanup();
    render(<HandoffQuery client={new QueryClient()} submit={submit} />);
    await waitFor(() =>
      expect(screen.getByTestId('handoff-kind')).toHaveTextContent('consumed')
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
