/**
 * V31-68 — the operations health widget under an admin session Core's
 * job-runtime allowlist does not cover.
 *
 * The proxy answers that denial with a degraded 200 (see the p1-module-proxy
 * route test), so what has to hold here is the other half: the widget names the
 * degradation instead of crying "invalid response", it asks once, and it puts
 * nothing on the console. The browser-level "zero console errors" contract is
 * the e2e gate's to prove — jsdom does not log network failures the way a real
 * browser does — so this test pins the part that lives in the component.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jobRuntimeObservabilityUnauthorized } from '@/lib/job-runtime-observability-access';

const p1 = vi.hoisted(() => ({ queryP1: vi.fn() }));

// Only the transport is replaced; the retry policy under test is the real one.
vi.mock('@/p1/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/p1/client')>();
  return { ...actual, queryP1: p1.queryP1 };
});

const { P1RequestError } = await import('@/p1/client');
const { AdminOperationsHealth } = await import('./admin-operations-health');

const SNAPSHOT = {
  capturedAt: '2026-08-12T02:00:00.000Z',
  queue: {
    queueDepth: { status: 'known', value: 7 },
    averageClaimLatencyMs: { status: 'known', value: 41 },
  },
  database: {},
  worker: {},
  runner: { windowMinutes: 30 },
  moduleRevisions: {},
};

function renderWidget(node: ReactNode) {
  // No retry override here: the component's own policy is what is being tested.
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('AdminOperationsHealth under an unauthorized admin session', () => {
  it('names the degradation, asks once, and stays off the console', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    p1.queryP1.mockResolvedValue(jobRuntimeObservabilityUnauthorized());

    renderWidget(<AdminOperationsHealth />);

    const card = await screen.findByTestId(
      'admin-operations-health-unauthorized'
    );
    expect(card).toHaveTextContent('运维观测暂时没对你开放');
    expect(card).toHaveTextContent('运维白名单账号');
    // The invalid-response alert belongs to a different failure.
    expect(screen.queryByText('运维指标响应无效')).toBeNull();
    expect(p1.queryP1).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not retry a rejected read', async () => {
    p1.queryP1.mockRejectedValue(
      new P1RequestError('Denied.', 'FORBIDDEN', undefined, 403)
    );

    renderWidget(<AdminOperationsHealth />);

    await screen.findByText('无法读取运维指标');
    // A denial repeated three more times is still a denial — and three more
    // console entries in a real browser.
    await waitFor(() => expect(p1.queryP1).toHaveBeenCalledTimes(1));
  });

  it('renders the live metrics when the read is granted', async () => {
    p1.queryP1.mockResolvedValue(SNAPSHOT);

    renderWidget(<AdminOperationsHealth />);

    expect(await screen.findByText('积压')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-operations-health-unauthorized')).toBe(
      null
    );
  });
});
