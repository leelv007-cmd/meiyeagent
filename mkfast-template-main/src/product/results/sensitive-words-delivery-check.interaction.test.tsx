import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { p1QueryKeys } from '@/p1/query-keys';
import { buildXiaohongshuImageTextPackage } from './delivery-full-package';
import { projectDeliveryPanel } from './delivery-panel-model';
import { ResultCenterPage } from './result-center-page';
import {
  SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS,
  SensitiveWordsGuardedDeliveryPanel,
} from './sensitive-words-delivery-check';

const p1Client = vi.hoisted(() => {
  const query = vi.fn();
  return { boundedQueryP1: query, queryP1: query };
});

vi.mock('@/p1/client', () => p1Client);

vi.mock('@/components/layout/dashboard-layout', () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

function renderWithQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function viewFacts() {
  return {
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
    sharePayload: { downloadHref: '/download.zip' },
    nowIso: '2026-08-02T00:00:00.000Z',
    viewport: 'desktop',
  } as const;
}

function view() {
  return projectDeliveryPanel(viewFacts());
}

beforeEach(() => {
  p1Client.queryP1.mockReset();
});

describe('delivery sensitive-word check bar', () => {
  it('is mounted by the real copy Result delivery panel with canonical document text', async () => {
    p1Client.queryP1.mockResolvedValue({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'clear',
      summary: '未检出违禁词。',
      items: [],
    });
    renderWithQueryClient(
      <ResultCenterPage
        workId="work-sensitive-delivery"
        resolveOutcome={{
          kind: 'ok',
          mode: 'active',
          target: { workId: 'work-sensitive-delivery', panel: 'delivery' },
          workspaceId: 'workspace-sensitive-delivery',
        }}
        facts={{
          target: { workId: 'work-sensitive-delivery', panel: 'delivery' },
          workspaceKind: 'copy',
          progressState: 'success',
          hasAdoptedCandidate: true,
          requestedPanel: 'delivery',
        }}
        copyWorksurface={{
          workId: 'work-sensitive-delivery',
          baseRevisionId: 'version-1',
          lifecycle: 'adopted',
          document: {
            title: '周末护理指南',
            body: '温和补水护理',
            conversionHook: '私信预约',
            topics: ['护理日常', '敏感话题'],
            orderedAssetIds: [],
          },
          factSources: [],
        }}
        deliveryPanelFacts={viewFacts()}
      />
    );

    await screen.findByText('未检出违禁词。');
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'check_bar',
        payload: {
          text: '周末护理指南\n\n温和补水护理\n\n#护理日常 #敏感话题\n\n私信预约\n',
        },
      },
      {
        signal: expect.any(AbortSignal),
        timeoutMs: SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS,
      }
    );
    expect(screen.getByTestId('delivery-panel-live')).toBeInTheDocument();
  });

  it('guards image delivery with the exact caption from its full package', async () => {
    p1Client.queryP1.mockResolvedValue({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'clear',
      summary: '未检出违禁词。',
      items: [],
    });
    const fullPackagePlan = buildXiaohongshuImageTextPackage({
      caption: {
        title: '护理海报',
        body: '温和补水',
        conversionHook: '私信预约',
        topics: ['护理日常'],
      },
      compliance: { aigcLabelEnabled: true, watermarkEnabled: true },
      contentPackageRevision: 1,
      generatedAt: '2026-08-02T00:00:00.000Z',
      images: [{ mimeType: 'image/jpeg', path: 'images/01.jpg' }],
      packageId: 'package-sensitive-image',
      storeName: '测试门店',
      variantVersionId: 'variant-sensitive-image',
    });

    renderWithQueryClient(
      <ResultCenterPage
        workId="work-sensitive-image"
        resolveOutcome={{
          kind: 'ok',
          mode: 'active',
          target: { workId: 'work-sensitive-image', panel: 'delivery' },
          workspaceId: 'workspace-sensitive-image',
        }}
        facts={{
          target: { workId: 'work-sensitive-image', panel: 'delivery' },
          workspaceKind: 'image',
          progressState: 'success',
          hasAdoptedCandidate: true,
          requestedPanel: 'delivery',
        }}
        deliveryPanelFacts={{ ...viewFacts(), fullPackagePlan }}
      />
    );

    await screen.findByText('未检出违禁词。');
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'check_bar',
        payload: {
          text: '护理海报\n\n温和补水\n\n#护理日常\n\n私信预约\n',
        },
      },
      {
        signal: expect.any(AbortSignal),
        timeoutMs: SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS,
      }
    );
  });

  it('shows every structured match and keeps all delivery actions blocked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    p1Client.queryP1.mockResolvedValue({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'hits',
      summary: '检出 1 处违禁词，请按建议替换后再交付。',
      items: [
        {
          wordId: 'sw-extreme-001',
          word: '根治',
          category: 'extreme',
          snippet: '本店承诺根治色斑',
          replacements: ['明显改善', '持续护理后改善'],
        },
      ],
    });

    renderWithQueryClient(
      <SensitiveWordsGuardedDeliveryPanel
        text="本店承诺根治色斑"
        view={view()}
        onAction={onAction}
      />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('delivery-sensitive-words-check')
      ).toHaveAttribute('data-status', 'hits')
    );
    const bar = screen.getByTestId('delivery-sensitive-words-check');
    expect(bar).toHaveTextContent('根治');
    expect(bar).toHaveTextContent('本店承诺根治色斑');
    expect(bar).toHaveTextContent('明显改善');
    expect(bar).toHaveTextContent('持续护理后改善');
    const delivery = screen.getByTestId('delivery-action-full_package');
    expect(delivery).toBeDisabled();
    await user.click(delivery);
    expect(onAction).not.toHaveBeenCalled();
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'check_bar',
        payload: { text: '本店承诺根治色斑' },
      },
      {
        signal: expect.any(AbortSignal),
        timeoutMs: SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS,
      }
    );
  });

  it('enables delivery only after a valid clear response and fails closed on query error', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(async () => 'download_done' as const);
    p1Client.queryP1.mockResolvedValueOnce({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'clear',
      summary: '未检出违禁词。',
      items: [],
    });
    const first = renderWithQueryClient(
      <SensitiveWordsGuardedDeliveryPanel
        text="温和补水护理"
        view={view()}
        onAction={onAction}
      />
    );

    await screen.findByText('未检出违禁词。');
    const clearDelivery = screen.getByTestId('delivery-action-full_package');
    expect(clearDelivery).toBeEnabled();
    await user.click(clearDelivery);
    expect(onAction).toHaveBeenCalledTimes(1);
    first.unmount();

    p1Client.queryP1.mockRejectedValueOnce(new Error('Core unavailable'));
    renderWithQueryClient(
      <SensitiveWordsGuardedDeliveryPanel
        text="温和补水护理"
        view={view()}
        onAction={onAction}
      />
    );
    await screen.findByText('违禁词检查暂不可用，交付操作已暂停。');
    expect(
      screen.getByTestId('delivery-sensitive-words-check')
    ).toHaveAttribute('role', 'alert');
    await waitFor(() =>
      expect(screen.getByTestId('delivery-action-full_package')).toBeDisabled()
    );
    expect(onAction).toHaveBeenCalledTimes(1);

    p1Client.queryP1.mockResolvedValueOnce({
      schemaVersion: 'sensitive-check-bar/v1',
      status: 'clear',
      summary: '未检出违禁词。',
      items: [],
    });
    await user.click(screen.getByTestId('delivery-sensitive-words-retry'));
    await screen.findByText('未检出违禁词。');
    expect(screen.getByTestId('delivery-action-full_package')).toBeEnabled();
  });

  it('fails closed while a cached clear result is background revalidated', async () => {
    const text = '温和补水护理';
    const clear = {
      schemaVersion: 'sensitive-check-bar/v1' as const,
      status: 'clear' as const,
      summary: '未检出违禁词。',
      items: [],
    };
    let resolveCheck!: (value: typeof clear) => void;
    const revalidation = new Promise<typeof clear>((resolve) => {
      resolveCheck = resolve;
    });
    p1Client.queryP1.mockReturnValue(revalidation);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      p1QueryKeys.request('sensitive-words', 'check_bar', { text }),
      clear
    );

    render(
      <QueryClientProvider client={client}>
        <SensitiveWordsGuardedDeliveryPanel text={text} view={view()} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(p1Client.queryP1).toHaveBeenCalledTimes(1));
    const delivery = screen.getByTestId('delivery-action-full_package');
    const blockedWhileFetching = delivery.hasAttribute('disabled');
    resolveCheck(clear);
    await waitFor(() => expect(delivery).toBeEnabled());
    expect(blockedWhileFetching).toBe(true);
  });

  it('rechecks edited delivery text and stays closed until the new result is known', async () => {
    const clear = {
      schemaVersion: 'sensitive-check-bar/v1' as const,
      status: 'clear' as const,
      summary: '未检出违禁词。',
      items: [],
    };
    const hits = {
      schemaVersion: 'sensitive-check-bar/v1' as const,
      status: 'hits' as const,
      summary: '检出 1 处违禁词，请按建议替换后再交付。',
      items: [
        {
          wordId: 'sw-extreme-001',
          word: '根治',
          category: 'extreme' as const,
          snippet: '手改后的根治正文',
          replacements: ['明显改善'],
        },
      ],
    };
    let resolveEditedCheck!: (value: typeof hits) => void;
    const editedCheck = new Promise<typeof hits>((resolve) => {
      resolveEditedCheck = resolve;
    });
    p1Client.queryP1
      .mockResolvedValueOnce(clear)
      .mockReturnValueOnce(editedCheck);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = render(
      <QueryClientProvider client={client}>
        <SensitiveWordsGuardedDeliveryPanel text="原安全正文" view={view()} />
      </QueryClientProvider>
    );
    await screen.findByText('未检出违禁词。');
    expect(screen.getByTestId('delivery-action-full_package')).toBeEnabled();

    rendered.rerender(
      <QueryClientProvider client={client}>
        <SensitiveWordsGuardedDeliveryPanel
          text="手改后的根治正文"
          view={view()}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(p1Client.queryP1).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('delivery-action-full_package')).toBeDisabled();

    resolveEditedCheck(hits);
    await screen.findByText('检出 1 处违禁词，请按建议替换后再交付。');
    expect(screen.getByTestId('delivery-action-full_package')).toBeDisabled();
    expect(p1Client.queryP1).toHaveBeenLastCalledWith(
      'sensitive-words',
      {
        action: 'check_bar',
        payload: { text: '手改后的根治正文' },
      },
      {
        signal: expect.any(AbortSignal),
        timeoutMs: SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS,
      }
    );
  });

  it('does not treat the delivery receipt panel as a delivery-action command while extras stay disabled', async () => {
    const clear = {
      schemaVersion: 'sensitive-check-bar/v1' as const,
      status: 'clear' as const,
      summary: '未检出违禁词。',
      items: [],
    };
    let resolveCheck!: (value: typeof clear) => void;
    p1Client.queryP1.mockReturnValue(
      new Promise<typeof clear>((resolve) => {
        resolveCheck = resolve;
      })
    );

    renderWithQueryClient(
      <ResultCenterPage
        workId="work-sensitive-delivery"
        resolveOutcome={{
          kind: 'ok',
          mode: 'active',
          target: { workId: 'work-sensitive-delivery', panel: 'delivery' },
          workspaceId: 'workspace-sensitive-delivery',
        }}
        facts={{
          target: { workId: 'work-sensitive-delivery', panel: 'delivery' },
          workspaceKind: 'copy',
          progressState: 'success',
          hasAdoptedCandidate: true,
          requestedPanel: 'delivery',
        }}
        copyWorksurface={{
          workId: 'work-sensitive-delivery',
          baseRevisionId: 'version-1',
          lifecycle: 'adopted',
          document: {
            title: '周末护理指南',
            body: '温和补水护理',
            conversionHook: '私信预约',
            topics: ['护理日常'],
            orderedAssetIds: [],
          },
          factSources: [],
        }}
        deliveryPanelFacts={viewFacts()}
        closeLoop={{
          contentPackageId: 'pkg-a',
          contentPackageRevision: 3,
          deliveryReceipts: [
            {
              id: 'r-handed-off',
              kind: 'handed_off',
              idempotencyKey: 'pkg-a:3:handed_off:xiaohongshu:organic_post',
              binding: {
                contentPackageId: 'pkg-a',
                contentPackageRevision: 3,
                platform: 'xiaohongshu',
                accountOrOwnerLabel: '外协运营',
                purpose: 'organic_post',
                actorId: 'actor-a',
                occurredAt: '2026-07-20T11:00:00.000Z',
              },
            },
          ],
        }}
      />
    );

    await expect(
      screen.findByTestId('delivery-sensitive-words-check')
    ).resolves.toHaveAttribute('data-status', 'checking');

    const receiptPanel = screen.getByTestId('delivery-receipt-panel');
    expect(receiptPanel).toBeVisible();
    expect(receiptPanel).toHaveAttribute(
      'data-handed-over-not-published',
      'true'
    );
    expect(receiptPanel.tagName).not.toBe('BUTTON');
    expect(screen.queryByTestId('delivery-action-receipt-panel')).toBeNull();
    expect(screen.getByTestId('delivery-receipt-row')).toBeVisible();

    const deliveryActions = screen.getAllByTestId(/^delivery-action-/);
    expect(deliveryActions.length).toBeGreaterThan(0);
    for (const action of deliveryActions) {
      expect(action.tagName).toBe('BUTTON');
      expect(action).toBeDisabled();
    }

    resolveCheck(clear);
    await screen.findByText('未检出违禁词。');
  });
});
