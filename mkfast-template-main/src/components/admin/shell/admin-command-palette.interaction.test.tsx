/**
 * Admin ⌘K: open, search hit, Enter navigates.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Routes } from '@/lib/routes';
import { AdminCommandPalette } from './admin-command-palette';
import { buildAdminCommandEntries } from './admin-command-model';

// cmdk mounts ResizeObserver + scrollIntoView; jsdom ships neither.
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  navigate.mockReset();
  delete document.documentElement.dataset.adminCommandReady;
});

describe('AdminCommandPalette', () => {
  it('opens with ⌘K, filters by search, and navigates on select/enter', async () => {
    const user = userEvent.setup();
    render(<AdminCommandPalette />);

    await waitFor(() => {
      expect(document.documentElement.dataset.adminCommandReady).toBe('true');
    });

    await user.keyboard('{Meta>}k{/Meta}');
    const input = await screen.findByTestId('admin-command-input');
    expect(input).toBeInTheDocument();

    const refundEntry = buildAdminCommandEntries().find(
      (entry) =>
        entry.kind === 'navigation' && entry.href === Routes.AdminRefundReview
    );
    expect(refundEntry).toBeTruthy();

    await user.clear(input);
    await user.type(input, 'refund');

    const item = await screen.findByTestId(
      `admin-command-item-${refundEntry!.id}`
    );
    expect(item).toBeInTheDocument();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    const call = navigate.mock.calls.at(-1)?.[0] as { to?: string };
    expect(call?.to).toContain('/admin/refund-review');
  });
});
