/**
 * CREDIT-01A / R-P1-10: a successful redeem must refresh the merchant
 * projection (balance) and credit-detail (batch + ledger) together, without
 * a full page reload. Repeat redeem is idempotent.
 */
import type { MerchantCreditDetail } from '@meiye/contracts';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedemptionCard } from '@/p1/redemption-card';
import { p1QueryKeys } from '@/p1/query-keys';
import type { AccountUsageProjection } from '@/product/account-usage';
import { ComposerCreditRecoveryHost } from '@/product/composer/quota-blocking-card';
import { MerchantCreditDetailPanel } from '@/product/merchant-credit-detail-panel';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const EMPTY_BALANCE = {
  grantedCredits: 0,
  usedCredits: 0,
  refundedCredits: 0,
  expiredCredits: 0,
  availableCredits: 0,
  soonestExpiringLot: null,
} as const;

const GRANTED_BALANCE = {
  ...EMPTY_BALANCE,
  grantedCredits: 30,
  availableCredits: 30,
};

const EMPTY_DETAIL: MerchantCreditDetail = {
  billing: null,
  batches: [],
  transactions: [],
};

const GRANTED_DETAIL: MerchantCreditDetail = {
  billing: null,
  batches: [
    {
      batchNumber: 1,
      expiresAt: null,
      remainingCredits: 30,
      source: 'redemption',
      status: 'active',
    },
  ],
  transactions: [
    {
      batchNumber: 1,
      credits: 30,
      creditedAmount: 0,
      operation: 'account_credit',
      occurredAt: '2026-08-01T12:00:00.000Z',
      refundDisposition: 'not_applicable',
      status: 'not_applicable',
      type: 'grant',
    },
  ],
};

const EMPTY_PROJECTION: AccountUsageProjection = {
  credits: { ...EMPTY_BALANCE },
  plan: { tier: 'trial' },
};

const GRANTED_PROJECTION: AccountUsageProjection = {
  credits: { ...GRANTED_BALANCE },
  plan: { tier: 'trial' },
};

const REDEEM_RECEIPT = {
  code: { status: 'redeemed' },
  grantTransactions: [],
  creditGrant: {
    originalCredits: 30,
    remainingCredits: 30,
    transactionType: 'REDEMPTION_CODE',
  },
};

const projectionKey = p1QueryKeys.request('entitlements', 'projection');
const creditDetailKey = p1QueryKeys.request('entitlements', 'credit_detail');

function ProjectionBalance() {
  const query = useQuery({
    queryKey: projectionKey,
    queryFn: ({ signal }) =>
      p1Client.queryP1(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
  });
  return (
    <div data-testid="credit-projection-available">
      {query.data?.credits.availableCredits ?? 'none'}
    </div>
  );
}

function createClient() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  client.setQueryData(projectionKey, EMPTY_PROJECTION);
  client.setQueryData(creditDetailKey, EMPTY_DETAIL);
  return client;
}

function renderCreditsSurface(client: QueryClient, children: ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectionBalance />
      <MerchantCreditDetailPanel />
      {children}
    </QueryClientProvider>
  );
}

function wireLedger() {
  let granted = false;
  p1Client.queryP1.mockImplementation(
    async (_module: string, call: { action: string }) => {
      if (call.action === 'credit_detail') {
        return granted ? GRANTED_DETAIL : EMPTY_DETAIL;
      }
      if (call.action === 'projection' || call.action === 'balance') {
        return granted ? GRANTED_PROJECTION : EMPTY_PROJECTION;
      }
      throw new Error(`unexpected query ${call.action}`);
    }
  );
  p1Client.commandP1.mockImplementation(
    async (
      module: string,
      call: { action: string; payload?: { code?: string } }
    ) => {
      expect(module).toBe('redemptions');
      expect(call.action).toBe('redeem');
      expect(call.payload?.code).toBe('CREDIT-30');
      granted = true;
      return REDEEM_RECEIPT;
    }
  );
  return () => granted;
}

async function expectGrantedViews() {
  await waitFor(() => {
    expect(screen.getByTestId('credit-projection-available')).toHaveTextContent(
      '30'
    );
    expect(
      screen.queryByTestId('credit-detail-empty-batches')
    ).not.toBeInTheDocument();
    const detail = screen.getByTestId('merchant-credit-detail');
    expect(within(detail).getByText(/兑换|Redemption/u)).toBeInTheDocument();
    expect(within(detail).getAllByText('30').length).toBeGreaterThan(0);
    expect(within(detail).getByText(/发放|Granted/u)).toBeInTheDocument();
    expect(
      within(detail).getByText(/账户积分调整|Account credit adjustment/u)
    ).toBeInTheDocument();
  });
}

function composerHost(client: QueryClient) {
  return (
    <ComposerCreditRecoveryHost
      blocked
      quote={{ quoteId: 'quote-10', revision: 'revision-10', amount: 10 }}
      redeem={({ command, idempotencyKey }) =>
        p1Client.commandP1('redemptions', command, idempotencyKey)
      }
      refreshCredits={async () => {
        await client.refetchQueries({ queryKey: projectionKey });
        return client.getQueryData(projectionKey) as AccountUsageProjection;
      }}
    />
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  p1Client.commandP1.mockReset();
  p1Client.queryP1.mockReset();
});

describe('CREDIT-01A redemption refreshes batch, ledger, and balance', () => {
  it('settings redeem updates projection and credit detail without a page reload', async () => {
    const wasGranted = wireLedger();
    const client = createClient();
    renderCreditsSurface(client, <RedemptionCard />);

    expect(screen.getByTestId('credit-projection-available')).toHaveTextContent(
      '0'
    );
    expect(
      screen.getByTestId('credit-detail-empty-batches')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/兑换码|Redemption code/u), {
      target: { value: 'credit-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /立即兑换|Redeem/u }));

    await expectGrantedViews();
    expect(wasGranted()).toBe(true);
    expect(p1Client.commandP1).toHaveBeenCalledOnce();
    expect(p1Client.commandP1.mock.calls[0]?.[2]).toMatch(/^redeem-code-/u);
  });

  it('settings repeat redeem is idempotent and does not add a second batch', async () => {
    wireLedger();
    const client = createClient();
    renderCreditsSurface(client, <RedemptionCard />);

    const submit = () => {
      fireEvent.change(screen.getByLabelText(/兑换码|Redemption code/u), {
        target: { value: 'CREDIT-30' },
      });
      fireEvent.click(screen.getByRole('button', { name: /立即兑换|Redeem/u }));
    };

    submit();
    await expectGrantedViews();

    submit();
    await expectGrantedViews();
    expect(p1Client.commandP1).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByTestId('merchant-credit-detail')).getAllByText('30')
    ).toHaveLength(2);
  });

  it('composer redeem updates projection and credit detail without a page reload', async () => {
    const wasGranted = wireLedger();
    const client = createClient();
    renderCreditsSurface(client, composerHost(client));

    expect(
      screen.getByTestId('credit-detail-empty-batches')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('composer-quota-redemption-code'), {
      target: { value: 'CREDIT-30' },
    });
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));

    await expectGrantedViews();
    expect(wasGranted()).toBe(true);
    expect(p1Client.commandP1).toHaveBeenCalledOnce();
    expect(p1Client.commandP1.mock.calls[0]?.[1]).toEqual({
      action: 'redeem',
      payload: { code: 'CREDIT-30' },
    });
  });

  it('composer repeat redeem is idempotent and does not add a second batch', async () => {
    wireLedger();
    const client = createClient();
    const first = renderCreditsSurface(client, composerHost(client));

    fireEvent.change(screen.getByTestId('composer-quota-redemption-code'), {
      target: { value: 'CREDIT-30' },
    });
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));
    await expectGrantedViews();

    first.unmount();
    renderCreditsSurface(client, composerHost(client));
    fireEvent.change(screen.getByTestId('composer-quota-redemption-code'), {
      target: { value: 'CREDIT-30' },
    });
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));
    await expectGrantedViews();
    expect(p1Client.commandP1).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByTestId('merchant-credit-detail')).getAllByText('30')
    ).toHaveLength(2);
  });
});
