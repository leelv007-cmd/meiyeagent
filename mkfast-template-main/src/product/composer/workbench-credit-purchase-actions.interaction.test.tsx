import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';

import { WorkbenchCreditPurchaseActions } from './workbench-credit-purchase-actions';

afterEach(() => {
  cleanup();
});

async function renderPurchaseActions() {
  const rootRoute = createRootRoute({ component: Outlet });
  const actionsRoute = createRoute({
    component: WorkbenchCreditPurchaseActions,
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const pricingRoute = createRoute({
    component: () => <p>Pricing</p>,
    getParentRoute: () => rootRoute,
    path: '/pricing',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([actionsRoute, pricingRoute]),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

it('routes the two credit shortfall exits to their distinct pricing anchors', async () => {
  const boosterRouter = await renderPurchaseActions();
  const user = userEvent.setup();
  await user.click(screen.getByTestId('workbench-credit-buy-booster'));
  await waitFor(() =>
    expect(boosterRouter.state.location.href).toBe('/pricing#credit-boosters')
  );
  cleanup();

  const upgradeRouter = await renderPurchaseActions();
  await user.click(screen.getByTestId('workbench-credit-upgrade'));
  await waitFor(() =>
    expect(upgradeRouter.state.location.href).toBe(
      '/pricing#subscription-plans'
    )
  );
});
