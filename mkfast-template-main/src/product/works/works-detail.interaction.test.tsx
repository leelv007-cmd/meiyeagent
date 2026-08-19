/**
 * RTL: Works archive export is a Result deep-link (WORK-01 / R-P1-08).
 *
 * Clicking 导出 from Works must not submit result_export. Result is the writer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicContentPackage } from '@meiye/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a href={`${to}`} {...props}>
      {children}
    </a>
  ),
}));

const operationsQuery = vi.fn();
const commandP1 = vi.fn();
vi.mock('@/p1/client', () => ({
  commandP1: (...args: unknown[]) => commandP1(...args),
  operationsQuery: (...args: unknown[]) => operationsQuery(...args),
}));

const { WorksDetailPage } = await import('./works-detail-page');

afterEach(() => {
  cleanup();
  commandP1.mockReset();
  operationsQuery.mockReset();
});

function ownedAsset(id: string, contentType: string) {
  return {
    contentType,
    id,
    objectKey: `workspace-1/${id}`,
    sha256: `sha-${id}`,
  };
}

const exportReady: PublicContentPackage = {
  compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
  createdAt: '2026-07-20T08:00:00.000Z',
  currentVersionId: 'version-1',
  exportReceipts: [],
  generated: {
    assetIds: ['asset-note'],
    childRuns: [],
    ownedAssets: [ownedAsset('asset-note', 'image/jpeg')],
  },
  id: 'package-note',
  kind: 'image_text',
  lineage: {},
  revision: 3,
  rights: { state: 'authorized' },
  source: {
    assetIds: [],
    targetPlatform: 'xiaohongshu',
    workId: 'work-note',
  },
  status: 'accepted',
  updatedAt: '2026-07-23T10:00:00.000Z',
  variants: [
    {
      currentVersionId: 'variant-version-1',
      id: 'variant-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '夏日美甲种草笔记正文。',
          createdAt: '2026-07-23T08:00:00.000Z',
          id: 'variant-version-1',
          orderedAssetIds: ['asset-note'],
          title: '夏日美甲种草',
          topics: [],
        },
      ],
    },
  ],
  versions: [
    {
      body: '夏日美甲种草笔记正文。',
      createdAt: '2026-07-23T08:00:00.000Z',
      id: 'version-1',
      orderedAssetIds: ['asset-note'],
      title: '夏日美甲种草',
      topics: [],
    },
  ],
  workspaceId: 'workspace-1',
};

function renderDetail(props?: {
  restoreFocusKey?: 'works-detail-actions';
  restoreScrollY?: number;
}) {
  operationsQuery.mockImplementation(async (action: string) =>
    action === 'content_packages'
      ? [exportReady]
      : { canvasWorks: [], creativeWorks: [] }
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorksDetailPage
        restoreFocusKey={props?.restoreFocusKey}
        restoreScrollY={props?.restoreScrollY}
        workId="package-note"
      />
    </QueryClientProvider>
  );
}

describe('WORK-01 Works archive — Result is the only writer', () => {
  it('export from Works navigates to Result and does not submit result_export', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('works-action-export')).toBeTruthy()
    );

    const exportLink = screen.getByTestId('works-action-export');
    expect(exportLink.tagName).toBe('A');
    expect(exportLink.getAttribute('data-result-writer')).toBe('result');
    expect(exportLink.getAttribute('href')).toContain(
      '/dashboard/results/work-note'
    );
    expect(exportLink.getAttribute('href')).toContain('contentId=package-note');
    expect(exportLink.getAttribute('href')).toContain('versionId=version-1');
    expect(exportLink.getAttribute('href')).toContain('panel=delivery');
    expect(exportLink.getAttribute('href')).toContain('returnTo=works');

    await userEvent.click(exportLink);
    expect(commandP1).not.toHaveBeenCalled();
  });

  it('adopt, adjust, and handoff share the same revision target', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('works-action-adjust')).toBeTruthy()
    );

    expect(screen.queryByTestId('works-action-adopt')).toBeNull();
    const adjust = screen
      .getByTestId('works-action-adjust')
      .getAttribute('href');
    const handoff = screen
      .getByTestId('works-action-handoff')
      .getAttribute('href');
    expect(adjust).toContain('panel=adjust');
    expect(adjust).toContain('contentId=package-note');
    expect(adjust).toContain('versionId=version-1');
    expect(handoff).toContain('panel=delivery');
    expect(handoff).toContain('contentId=package-note');
    expect(handoff).toContain('versionId=version-1');
  });

  it('restores scroll and focus when returning from Result', async () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    renderDetail({
      restoreFocusKey: 'works-detail-actions',
      restoreScrollY: 180,
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('works-detail-actions')
      )
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 180);
  });
});
