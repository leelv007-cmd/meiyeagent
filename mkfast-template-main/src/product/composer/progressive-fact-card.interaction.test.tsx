/**
 * D-C4: the idle Day-0 card is a reminder, not a second input surface.
 * The capture itself lives on the store page (five-step wizard) and in the
 * post-send questions; this card only names the next gap and points there.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProgressiveFactCard } from './progressive-fact-card';

afterEach(() => {
  cleanup();
});

const STORE = {
  name: '青禾美甲',
  city: '杭州',
  district: '拱墅区',
  address: '湖墅南路 88 号',
  booking: '提前一天预约',
  brandVoice: '真实、克制',
  prohibitions: ['不虚构价格'],
  accounts: [],
  projects: [
    {
      id: 'project-cat-eye',
      name: '透亮猫眼',
      price: 299,
      durationMinutes: 90,
      confirmed: true,
    },
  ],
  regulated: false,
  revision: 3,
};

/** The card renders a router Link, so it needs a router to render at all. */
function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const storeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/store',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, storeRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe('ProgressiveFactCard idle reminder', () => {
  it('carries no input or submit of its own — only the next gap and the way to it', async () => {
    renderInRouter(<ProgressiveFactCard activeFacts={[]} />);

    expect(await screen.findByTestId('progressive-fact-card')).toBeVisible();
    // The three controls that made this a second Composer are gone.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByTestId('progressive-fact-input')).toBeNull();
    expect(screen.queryByTestId('progressive-fact-continue')).toBeNull();
    expect(screen.queryByTestId('progressive-fact-confirm')).toBeNull();

    const link = screen.getByTestId('progressive-fact-store-link');
    expect(link).toHaveAttribute('href', '/dashboard/store');
  });

  it('names the next missing fact for a store that already has one', async () => {
    renderInRouter(<ProgressiveFactCard activeFacts={[]} store={STORE} />);

    const reminder = await screen.findByTestId('progressive-fact-reminder');
    // The profile names the store and city; the project facts are not in the
    // ledger yet, so 主推项目 is the gap the reminder should name.
    expect(reminder.textContent ?? '').toMatch(/主推项目/u);
  });
});
