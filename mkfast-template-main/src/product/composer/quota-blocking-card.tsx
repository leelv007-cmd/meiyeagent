/**
 * GL-23 quota-exhausted blocking card with inline redemption (C4 / #98).
 *
 * Reuses the redemptions CAS seam via injectable `onRedeem` (host wires
 * commandP1('redemptions', { action: 'redeem', payload: { code } }, key)).
 * Success unlocks continue-creation in place.
 */

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import {
  beginQuotaRedeem,
  buildQuotaRedeemCommand,
  completeQuotaRedeem,
  createQuotaBlockingState,
  isQuotaRedeemCodeValid,
  projectQuotaBlockingView,
  setQuotaRedeemCode,
  showQuotaBlocking,
  type QuotaBlockingState,
  QUOTA_BLOCK_OPEN_PLANS_LABEL,
} from './quota-blocking';

export type QuotaBlockingCardProps = {
  /** When true, card is shown in blocked mode. */
  blocked?: boolean;
  /**
   * Redeem seam — host should call commandP1 redemptions CAS.
   * Return ok:true on success. Tests inject a mock.
   */
  onRedeem: (input: {
    code: string;
    command: ReturnType<typeof buildQuotaRedeemCommand>;
    idempotencyKey: string;
  }) => Promise<{ ok: true } | { ok: false; message?: string }>;
  /** Called after successful redeem so host can refresh entitlements + continue. */
  onUnlocked?: () => void;
  /** Optional plans link href (defaults to settings credits). */
  plansHref?: string;
  className?: string;
};

export function QuotaBlockingCard({
  blocked = true,
  onRedeem,
  onUnlocked,
  plansHref = '/settings/credits',
  className,
}: QuotaBlockingCardProps) {
  const [state, setState] = useState<QuotaBlockingState>(() =>
    blocked ? showQuotaBlocking(createQuotaBlockingState()) : createQuotaBlockingState()
  );
  const pendingKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (blocked && !state.blocked && !state.unlocked) {
      setState((prev) => showQuotaBlocking(prev));
    }
  }, [blocked, state.blocked, state.unlocked]);

  const view = projectQuotaBlockingView(state);

  if (!blocked && !state.blocked && !state.unlocked) {
    return null;
  }

  if (!view.visible) {
    return null;
  }

  const handleRedeem = async () => {
    if (!isQuotaRedeemCodeValid(state.code)) return;

    const pending = beginQuotaRedeem(state);
    setState(pending);

    pendingKey.current ??=
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `redeem-${Date.now()}`;

    const command = buildQuotaRedeemCommand(pending.code);
    try {
      const result = await onRedeem({
        code: pending.code,
        command,
        idempotencyKey: `redeem-code-${pendingKey.current}`,
      });
      const next = completeQuotaRedeem(pending, result);
      setState(next);
      if (result.ok) {
        pendingKey.current = undefined;
        onUnlocked?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setState(completeQuotaRedeem(pending, { ok: false, message }));
    }
  };

  return (
    <div
      className={cn(
        'meiye-porcelain space-y-3 rounded-2xl border border-destructive/20 p-4',
        className
      )}
      data-testid="composer-quota-blocking-card"
      role="alert"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{view.title}</p>
        <p className="text-sm text-muted-foreground">{view.description}</p>
      </div>

      {view.canContinueCreation ? (
        <p
          className="text-sm font-medium text-emerald-700 dark:text-emerald-400"
          data-testid="composer-quota-unlock-success"
        >
          {view.successMessage}
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="composer-quota-redemption-code"
            >
              {view.codeLabel}
            </label>
            <input
              id="composer-quota-redemption-code"
              data-testid="composer-quota-redemption-code"
              autoComplete="off"
              maxLength={64}
              placeholder={view.codePlaceholder}
              value={view.code}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
              onChange={(event) => {
                pendingKey.current = undefined;
                setState((prev) => setQuotaRedeemCode(prev, event.target.value));
              }}
            />
          </div>
          <button
            type="button"
            data-testid="composer-quota-redeem-submit"
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!view.canSubmit || view.status === 'pending'}
            onClick={() => void handleRedeem()}
          >
            {view.status === 'pending' ? '兑换中…' : view.submitLabel}
          </button>
        </div>
      )}

      {view.errorMessage ? (
        <p
          className="text-sm text-destructive"
          data-testid="composer-quota-redeem-error"
        >
          {view.errorMessage}
        </p>
      ) : null}

      {view.canContinueCreation ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="composer-quota-continue-ready"
        >
          已解锁，可继续创作
        </p>
      ) : (
        <a
          className="inline-flex text-sm font-medium underline underline-offset-4"
          href={plansHref}
          data-testid="composer-quota-open-plans"
        >
          {QUOTA_BLOCK_OPEN_PLANS_LABEL}
        </a>
      )}
    </div>
  );
}
