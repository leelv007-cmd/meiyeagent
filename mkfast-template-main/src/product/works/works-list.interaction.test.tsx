/**
 * RTL: 作品列表 renders all four output shapes from fixture 产物 (T32 / #226).
 *
 * The journey against real core is tests/e2e/specs/works-reshell.spec.ts; this
 * file is the deterministic half of 「四类输出渲染正常」 — four canonical
 * ContentPackages in, four correctly-shaped cards out, with the media the
 * adopted version ordered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicContentPackage } from '@meiye/contracts';

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: React.ReactNode;
    params?: { workId?: string };
    to?: string;
  } & Record<string, unknown>) => (
    <a href={`${to}`.replace('$workId', params?.workId ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const operationsQuery = vi.fn();
vi.mock('@/p1/client', () => ({
  operationsQuery: (...args: unknown[]) => operationsQuery(...args),
}));

/**
 * jsdom ships no `Element.getAnimations`; React Aria's SelectionIndicator (the
 * Segment's sliding pill) calls it on every selection change. Kept local rather
 * than in the shared vitest setup — this ticket owns the first Segment mount.
 */
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

const { WorksListPage } = await import('./works-list-page');

afterEach(() => {
  cleanup();
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

function fixture(
  overrides: Partial<PublicContentPackage> &
    Pick<PublicContentPackage, 'id' | 'kind' | 'status'>
): PublicContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-20T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    lineage: {},
    revision: 2,
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    updatedAt: '2026-07-20T08:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

const FIXTURES: PublicContentPackage[] = [
  fixture({
    id: 'package-copy',
    kind: 'image_text',
    status: 'accepted',
    updatedAt: '2026-07-24T10:00:00.000Z',
    versions: [
      {
        body: '本周到店做一次头皮护理，回家继续养。',
        createdAt: '2026-07-24T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        title: '头皮护理到店文案',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['asset-image'],
      childRuns: [],
      ownedAssets: [ownedAsset('asset-image', 'image/png')],
    },
    id: 'package-image',
    kind: 'image_text',
    status: 'accepted',
    updatedAt: '2026-07-23T10:00:00.000Z',
    versions: [
      {
        body: '',
        createdAt: '2026-07-23T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['asset-image'],
        title: '门店门头图',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['asset-note'],
      childRuns: [],
      ownedAssets: [ownedAsset('asset-note', 'image/jpeg')],
    },
    id: 'package-note',
    kind: 'image_text',
    status: 'accepted',
    updatedAt: '2026-07-22T10:00:00.000Z',
    versions: [
      {
        body: '夏日美甲种草笔记。',
        createdAt: '2026-07-22T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['asset-note'],
        title: '夏日美甲种草',
        topics: [],
      },
    ],
  }),
  fixture({
    generated: {
      assetIds: ['asset-video'],
      childRuns: [],
      ownedAssets: [ownedAsset('asset-video', 'video/mp4')],
    },
    id: 'package-video',
    kind: 'video',
    status: 'accepted',
    updatedAt: '2026-07-21T10:00:00.000Z',
    versions: [
      {
        body: '15 秒到店成片。',
        createdAt: '2026-07-21T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['asset-video'],
        title: '到店体验成片',
        topics: [],
      },
    ],
  }),
];

function renderList() {
  // operationsQuery(action, payload, signal) — the module is fixed to operations.
  operationsQuery.mockImplementation(async (action: string) =>
    action === 'content_packages' ? FIXTURES : { canvasWorks: [] }
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorksListPage />
    </QueryClientProvider>
  );
}

describe('T32 作品列表 — 四类输出统一呈现', () => {
  it('files every fixture 产物 under the shape it actually delivered', async () => {
    renderList();

    await waitFor(() => expect(screen.getByTestId('works-list')).toBeTruthy());
    const cards = screen.getAllByTestId('works-card');
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.getAttribute('data-output-shape'))).toEqual(
      ['copy', 'image', 'note', 'video']
    );
    expect(
      screen.getAllByTestId('works-card-shape').map((chip) => chip.textContent)
    ).toEqual(['文案', '图片', '图文', '视频']);

    // Media rides the card for every shape that delivered any.
    const galleries = screen.getAllByTestId('works-media-gallery');
    expect(galleries).toHaveLength(3);
    expect(
      galleries.at(-1)?.querySelector('[data-media-kind="video"]')
    ).toBeTruthy();

    // The detail link is the works route, not the old object route.
    expect(cards[0]?.getAttribute('href')).toBe(
      '/dashboard/works/package-copy'
    );
  });

  it('the shape filter narrows the list to one 四类输出', async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId('works-list')).toBeTruthy());

    await userEvent.click(screen.getByTestId('works-shape-video'));

    await waitFor(() =>
      expect(screen.getAllByTestId('works-card')).toHaveLength(1)
    );
    expect(
      screen.getByTestId('works-card').getAttribute('data-output-shape')
    ).toBe('video');
  });

  it('an empty workspace says so instead of rendering an empty grid', async () => {
    operationsQuery.mockImplementation(async (action: string) =>
      action === 'content_packages' ? [] : { canvasWorks: [] }
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorksListPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('works-empty')).toBeTruthy());
    expect(screen.queryByTestId('works-list')).toBeNull();
  });
});
