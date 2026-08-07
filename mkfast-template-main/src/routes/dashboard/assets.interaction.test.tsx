/**
 * Assets cold-start: library + upload are the hero. Intake wizard and voice
 * manager stay behind single secondary entries.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

vi.mock('@/p1/client', () => ({
  operationsQuery: vi.fn(async () => ({
    assets: [],
    canvasWorks: [],
    contents: [],
    creativeWorks: [],
    exportReceipts: [],
    imageJobs: [],
    jobs: [],
    sessions: [],
    tasks: [],
  })),
}));

vi.mock('@/product/client', () => ({
  useProductState: () => ({
    error: undefined,
    execute: async () => undefined,
    loading: false,
    pending: false,
    refresh: async () => undefined,
    state: {
      assets: [],
      store: {
        name: '青禾美甲',
        revision: 1,
      },
      workspaceId: 'workspace-a',
    },
  }),
}));

vi.mock('@/product/creative-job-observer', () => ({
  useVideoWorkflowListObserver: () => ({
    data: [],
    isError: false,
    isLoading: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/product/store-intake/store-intake-wizard', () => ({
  StoreIntakeWizard: ({ surface }: { surface?: string }) => (
    <div data-testid={`store-intake-wizard-${surface ?? 'store'}`}>wizard</div>
  ),
}));

vi.mock('@/product/marketing-identity-manager', () => ({
  MarketingIdentityManager: () => (
    <section data-testid="marketing-identity-manager">identity</section>
  ),
}));

const { Route: assetsFileRoute } = await import('./assets');
const AssetLibraryPage = assetsFileRoute.options.component!;

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('asset library cold-start stacking', () => {
  it('defaults to library + upload without expanding intake or voice', async () => {
    renderWithQuery(<AssetLibraryPage />);

    expect(await screen.findByTestId('asset-library-search')).toBeTruthy();
    expect(screen.getByTestId('asset-library-secondary')).toBeTruthy();
    expect(screen.getByTestId('asset-store-intake-open')).toBeTruthy();
    expect(screen.queryByTestId('store-intake-wizard-assets')).toBeNull();

    const identityEntry = screen.getByTestId('asset-identity-entry');
    expect(identityEntry.hasAttribute('open')).toBe(false);
    // Collapsed <details> still mounts children in the DOM; the point is that
    // it is not an open first-screen panel competing with upload.
    expect(identityEntry.querySelector('[data-testid="marketing-identity-manager"]')).toBeTruthy();
  });

  it('opens the store intake wizard from the single secondary entry', async () => {
    renderWithQuery(<AssetLibraryPage />);

    fireEvent.click(await screen.findByTestId('asset-store-intake-open'));
    expect(screen.getByTestId('store-intake-wizard-assets')).toBeTruthy();
    expect(screen.getByTestId('asset-store-intake-close')).toBeTruthy();

    fireEvent.click(screen.getByTestId('asset-store-intake-close'));
    expect(screen.queryByTestId('store-intake-wizard-assets')).toBeNull();
  });
});
