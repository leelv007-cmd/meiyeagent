/**
 * RTL: GL-23 blocking card — redemption success unlocks continue creation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComposerCreditRecoveryHost,
  QuotaBlockingCard,
  type QuotaBlockingCardProps,
} from './quota-blocking-card';
import {
  recoverComposerCredits,
  type ComposerCreditRedemptionReceipt,
} from './quota-blocking';

afterEach(() => {
  cleanup();
});

/** Controlled uppercase input fights per-key user.type; set value in one change. */
function setRedeemCode(code: string) {
  const input = screen.getByTestId('composer-quota-redemption-code');
  fireEvent.change(input, { target: { value: code } });
  return input;
}

const QUOTE_50 = {
  quoteId: 'quote-50',
  revision: 'revision-50',
  amount: 50,
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function wrapQuery(ui: ReactElement, client = createQueryClient()) {
  return {
    client,
    element: <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  };
}

function UnlockHarness({
  redeemImpl,
}: {
  redeemImpl: (
    code: string
  ) => Promise<{ ok: true } | { ok: false; message?: string }>;
}) {
  const [canContinue, setCanContinue] = useState(false);

  return (
    <div>
      <output data-testid="continue-creation">
        {canContinue ? 'ready' : 'blocked'}
      </output>
      {/* Keep card mounted after unlock so success + continue CTA are both visible. */}
      <QuotaBlockingCard
        blocked={!canContinue}
        onRedeem={async ({ code }) => redeemImpl(code)}
        onUnlocked={() => {
          setCanContinue(true);
        }}
      />
      {canContinue ? (
        <button type="button" data-testid="continue-create-cta">
          继续创作
        </button>
      ) : null}
    </div>
  );
}

describe('GL-23 quota blocking card — redeem unlocks continue', () => {
  it('keeps the blocker when the current quote changes while redemption is pending', async () => {
    let finishRedeem!: (receipt: ComposerCreditRedemptionReceipt) => void;
    const redeem = vi.fn(
      () =>
        new Promise<ComposerCreditRedemptionReceipt>((resolve) => {
          finishRedeem = resolve;
        })
    );
    const refreshCredits = vi.fn(async () => ({
      credits: { availableCredits: 70 },
    }));
    const onUnlocked = vi.fn();
    const query = wrapQuery(
      <ComposerCreditRecoveryHost
        blocked
        quote={{ quoteId: 'quote-low', revision: 'revision-low', amount: 50 }}
        redeem={redeem}
        refreshCredits={refreshCredits}
        onUnlocked={onUnlocked}
      />
    );
    const view = render(query.element);

    setRedeemCode('CREDIT-30');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));
    await waitFor(() => expect(redeem).toHaveBeenCalledOnce());

    view.rerender(
      wrapQuery(
        <ComposerCreditRecoveryHost
          blocked
          quote={{
            quoteId: 'quote-high',
            revision: 'revision-high',
            amount: 80,
          }}
          redeem={redeem}
          refreshCredits={refreshCredits}
          onUnlocked={onUnlocked}
        />,
        query.client
      ).element
    );
    finishRedeem({
      creditGrant: {
        originalCredits: 30,
        transactionType: 'REDEMPTION_CODE',
      },
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('composer-quota-redeem-error')
      ).toHaveTextContent('报价已更新，请按最新报价重试')
    );
    expect(refreshCredits).toHaveBeenCalledOnce();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('composer-quota-continue-ready')
    ).not.toBeInTheDocument();
  });

  it('keeps the blocker when the current quote changes while recovery settlement is pending', async () => {
    let finishSettlement!: () => void;
    const onRecoverySettled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSettlement = resolve;
        })
    );
    const onUnlocked = vi.fn();
    const query = wrapQuery(
      <ComposerCreditRecoveryHost
        blocked
        quote={{ quoteId: 'quote-low', revision: 'revision-low', amount: 50 }}
        redeem={async () => ({
          creditGrant: {
            originalCredits: 30,
            transactionType: 'REDEMPTION_CODE',
          },
        })}
        refreshCredits={async () => ({
          credits: { availableCredits: 70 },
        })}
        onRecoverySettled={onRecoverySettled}
        onUnlocked={onUnlocked}
      />
    );
    const view = render(query.element);

    setRedeemCode('CREDIT-30');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));
    await waitFor(() => expect(onRecoverySettled).toHaveBeenCalledOnce());

    view.rerender(
      wrapQuery(
        <ComposerCreditRecoveryHost
          blocked
          quote={{
            quoteId: 'quote-high',
            revision: 'revision-high',
            amount: 80,
          }}
          redeem={async () => ({})}
          refreshCredits={async () => ({
            credits: { availableCredits: 70 },
          })}
          onRecoverySettled={onRecoverySettled}
          onUnlocked={onUnlocked}
        />,
        query.client
      ).element
    );
    finishSettlement();

    await waitFor(() =>
      expect(
        screen.getByTestId('composer-quota-redeem-error')
      ).toHaveTextContent('报价已更新，请按最新报价重试')
    );
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('composer-quota-continue-ready')
    ).not.toBeInTheDocument();
  });

  it('unlocks only after a credit receipt is confirmed by the authoritative balance', async () => {
    const events: string[] = [];
    const redeem = vi.fn(async () => {
      events.push('redeem');
      return {
        code: { status: 'redeemed' },
        grantTransactions: [],
        creditGrant: {
          originalCredits: 30,
          transactionType: 'REDEMPTION_CODE' as const,
        },
      };
    });
    const refreshCredits = vi.fn(async () => {
      events.push('refresh');
      return { credits: { availableCredits: 70 } };
    });

    render(
      <UnlockHarness
        redeemImpl={() =>
          recoverComposerCredits({
            quote: QUOTE_50,
            currentQuote: () => QUOTE_50,
            redeem,
            refreshCredits,
          })
        }
      />
    );
    setRedeemCode('CREDIT-30');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('continue-creation')).toHaveTextContent('ready')
    );
    expect(events).toEqual(['redeem', 'refresh']);
    expect(
      screen.getByTestId('composer-quota-unlock-success')
    ).toBeInTheDocument();
  });

  it('unlocks an idempotent replay from its receipt and fresh balance', async () => {
    const result = await recoverComposerCredits({
      quote: QUOTE_50,
      currentQuote: () => QUOTE_50,
      redeem: async () => ({
        creditGrant: {
          originalCredits: 30,
          transactionType: 'REDEMPTION_CODE',
        },
      }),
      refreshCredits: async () => ({ credits: { availableCredits: 70 } }),
    });

    expect(result).toEqual({ ok: true });
  });

  it('keeps the blocker when the fresh authoritative balance remains insufficient', async () => {
    render(
      <UnlockHarness
        redeemImpl={() =>
          recoverComposerCredits({
            quote: QUOTE_50,
            currentQuote: () => QUOTE_50,
            redeem: async () => ({
              code: { status: 'redeemed' },
              grantTransactions: [],
              creditGrant: {
                originalCredits: 30,
                transactionType: 'REDEMPTION_CODE',
              },
            }),
            refreshCredits: async () => ({
              credits: { availableCredits: 40 },
            }),
          })
        }
      />
    );
    setRedeemCode('NO-CREDIT');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));

    await waitFor(() =>
      expect(
        screen.getByTestId('composer-quota-redeem-error')
      ).toHaveTextContent('积分已到账，但仍不足以完成本次创作')
    );
    expect(screen.getByTestId('continue-creation')).toHaveTextContent(
      'blocked'
    );
    expect(
      screen.queryByTestId('composer-quota-unlock-success')
    ).not.toBeInTheDocument();
  });

  it('does not unlock from a sufficient balance without a credit receipt', async () => {
    const result = await recoverComposerCredits({
      quote: QUOTE_50,
      currentQuote: () => QUOTE_50,
      redeem: async () => ({}),
      refreshCredits: async () => ({ credits: { availableCredits: 70 } }),
    });

    expect(result).toEqual({
      ok: false,
      message: '兑换后积分未到账，请重试',
    });
  });

  it('renders inline code input when quota exhausted', () => {
    render(<UnlockHarness redeemImpl={async () => ({ ok: true })} />);
    expect(
      screen.getByTestId('composer-quota-blocking-card')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('composer-quota-redemption-code')
    ).toBeInTheDocument();
    expect(screen.getByTestId('composer-quota-redeem-submit')).toBeDisabled();
    expect(screen.getByTestId('continue-creation')).toHaveTextContent(
      'blocked'
    );
    expect(screen.queryByTestId('continue-create-cta')).not.toBeInTheDocument();
  });

  it('successful redeem unlocks continue creation in place', async () => {
    const redeem = vi.fn(async (code: string) => {
      expect(code).toBe('GIFT99');
      return { ok: true as const };
    });

    render(<UnlockHarness redeemImpl={redeem} />);

    const input = setRedeemCode('gift99');
    expect(input).toHaveValue('GIFT99');

    const submit = screen.getByTestId('composer-quota-redeem-submit');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(
        screen.getByTestId('composer-quota-unlock-success')
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('composer-quota-continue-ready')
    ).toHaveTextContent('已解锁，可继续创作');
    expect(screen.getByTestId('continue-creation')).toHaveTextContent('ready');
    expect(screen.getByTestId('continue-create-cta')).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('failed redeem keeps blocked and shows error', async () => {
    render(
      <UnlockHarness
        redeemImpl={async () => ({ ok: false, message: '兑换码已使用' })}
      />
    );

    setRedeemCode('USED01');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));

    await waitFor(() => {
      expect(
        screen.getByTestId('composer-quota-redeem-error')
      ).toHaveTextContent('兑换码已使用');
    });
    expect(screen.getByTestId('continue-creation')).toHaveTextContent(
      'blocked'
    );
    expect(screen.queryByTestId('continue-create-cta')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('composer-quota-redemption-code')
    ).toBeInTheDocument();
  });

  it('passes redemptions CAS command shape to onRedeem', async () => {
    const redeem = vi.fn<QuotaBlockingCardProps['onRedeem']>(async () => ({
      ok: true as const,
    }));
    render(<QuotaBlockingCard blocked onRedeem={redeem} />);

    setRedeemCode('CAS-01');
    fireEvent.click(screen.getByTestId('composer-quota-redeem-submit'));

    await waitFor(() => expect(redeem).toHaveBeenCalled());
    const arg = redeem.mock.calls[0]?.[0];
    expect(arg?.command).toEqual({
      action: 'redeem',
      payload: { code: 'CAS-01' },
    });
    expect(arg?.idempotencyKey).toMatch(/^redeem-code-/);
  });
});
