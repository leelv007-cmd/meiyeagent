import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductState } from '@meiye/contracts';
import { afterEach, expect, it, vi } from 'vitest';

const productClient = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  state: undefined as ProductState | undefined,
}));
const p1Client = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/product/client', () => ({
  useProductState: () => ({
    error: undefined,
    execute: productClient.execute,
    loading: false,
    pending: false,
    refresh: productClient.refresh,
    state: productClient.state,
  }),
}));
vi.mock('@/p1/client', () => ({
  queryP1: p1Client.query,
}));
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

const { Route: storeFileRoute } = await import('./store');

afterEach(() => {
  vi.resetAllMocks();
});

function regulatedState(
  qualification?: ProductState['qualification']
): ProductState {
  return {
    assets: [],
    contents: [],
    ...(qualification ? { qualification } : {}),
    store: {
      accounts: [],
      address: '示范路 1 号',
      booking: '私信预约',
      brandVoice: '专业稳重',
      city: '上海',
      confirmedAt: '2026-07-20T02:00:00.000Z',
      district: '静安区',
      name: '示范医美门店',
      prohibitions: [],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-1',
          name: '光子嫩肤',
          price: 999,
        },
      ],
      regulated: true,
      revision: 1,
    },
    workspaceId: 'workspace-1',
    // Only the slices this surface reads are populated.
  } as unknown as ProductState;
}

async function renderStore() {
  p1Client.query.mockResolvedValue([]);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/dashboard/store'] }),
    routeTree: rootRoute.addChildren([
      createRoute({
        component: storeFileRoute.options.component,
        getParentRoute: () => rootRoute,
        path: '/dashboard/store',
      }),
    ]),
  });
  await router.load();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/**
 * W01 post-merge P0-1: D-151④ retired the manual store *profile* form, but the
 * deletion also took the qualification block with it — leaving a regulated store
 * with no way to reach `confirm_qualification` and no way out of
 * `missing: ['confirmed_qualification']`. This drives the restored block.
 */
it('a regulated store can submit its qualification from the store page', async () => {
  productClient.state = regulatedState();
  productClient.execute.mockResolvedValue({});
  const user = userEvent.setup();

  await renderStore();

  // The nudge only shows while the admission is actually outstanding.
  expect(
    screen.getByTestId('store-qualification-required')
  ).toBeInTheDocument();

  const confirm = screen.getByTestId('store-confirm-qualification');
  // Licence and treatment scope are the two the admission cannot be recorded
  // without.
  expect(confirm).toBeDisabled();

  await user.type(screen.getByLabelText('机构执业许可证'), '沪医执字第 001 号');
  await user.type(screen.getByLabelText('诊疗范围'), '医疗美容科');
  await user.type(screen.getByLabelText('平台认证'), '小红书医美认证');
  await user.type(screen.getByLabelText('有效期'), '2027-12-31');

  expect(confirm).toBeEnabled();
  await user.click(confirm);

  expect(productClient.execute).toHaveBeenCalledTimes(1);
  expect(productClient.execute).toHaveBeenCalledWith({
    qualification: {
      admitted: true,
      advertisingCertificate: '',
      institutionLicense: '沪医执字第 001 号',
      intakeAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      platformCertification: '小红书医美认证',
      treatmentScope: '医疗美容科',
      validUntil: '2027-12-31',
    },
    type: 'confirm_qualification',
  });
});

it('an already confirmed qualification drops the nudge and prefills what was filed', async () => {
  productClient.state = regulatedState({
    admitted: true,
    confirmed: true,
    institutionLicense: '沪医执字第 001 号',
    treatmentScope: '医疗美容科',
  });

  await renderStore();

  expect(screen.queryByTestId('store-qualification-required')).toBeNull();
  expect(screen.getByLabelText('机构执业许可证')).toHaveValue(
    '沪医执字第 001 号'
  );
  expect(screen.getByTestId('store-confirm-qualification')).toBeEnabled();
});
