import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminRedemptionControl } from '@/p1/admin-redemption-control';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderControl(children: ReactNode = <AdminRedemptionControl />) {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('AdminRedemptionControl credit mode', () => {
  it('creates one positive credit grant without emitting legacy allowances', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValue([]);
    p1Client.commandP1.mockResolvedValue([]);
    const view = renderControl();

    await waitFor(() => expect(p1Client.queryP1).toHaveBeenCalledOnce());
    const numericInputs = view.container.querySelectorAll(
      'input[type="number"]'
    );
    expect(numericInputs).toHaveLength(1);

    await user.clear(numericInputs[0] as HTMLInputElement);
    await user.type(numericInputs[0] as HTMLInputElement, '30');
    await user.type(
      view.container.querySelector('#redeem-code') as HTMLInputElement,
      'CREDIT30'
    );
    await user.click(screen.getByRole('button', { name: /record|录入/u }));

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledOnce());
    expect(p1Client.commandP1.mock.calls[0]?.[1]).toEqual({
      action: 'create',
      payload: {
        code: 'CREDIT30',
        credits: 30,
        grants: {},
      },
    });
  });

  it('shows the credit amount and authoritative credit receipt returned by list', async () => {
    p1Client.queryP1.mockResolvedValue([
      {
        id: 'redemption-credit-30',
        code: 'CREDIT30',
        status: 'redeemed',
        revision: 2,
        credits: 30,
        grants: {},
        expiresAt: null,
        creditGrantTransactionId: 'credit-grant:lot-credit-30',
      },
    ]);
    renderControl();

    expect(await screen.findByText('CREDIT30')).toBeInTheDocument();
    expect(screen.getByText(/30\s*(credits|积分)/iu)).toBeInTheDocument();
    expect(screen.getByText('credit-grant:lot-credit-30')).toBeInTheDocument();
  });

  it('keeps void available for an active credit code', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValue([
      {
        id: 'redemption-credit-active',
        code: 'CREDITACTIVE',
        status: 'active',
        revision: 3,
        credits: 30,
        grants: {},
        expiresAt: null,
      },
    ]);
    p1Client.commandP1.mockResolvedValue([]);
    renderControl();

    await user.click(await screen.findByRole('button', { name: /void|作废/u }));

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledOnce());
    expect(p1Client.commandP1.mock.calls[0]?.[1]).toEqual({
      action: 'void',
      payload: { code: 'CREDITACTIVE', expectedRevision: 3 },
    });
  });
});
