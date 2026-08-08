/**
 * 执行确认卡的渲染件 — D-164③.
 *
 * Split from `execution-confirm-card.ts` under the same rule `brief-surface.ts`
 * / `brief-surface-panel.tsx` already follows: a `.ts` and a `.tsx` with one
 * basename resolve ambiguously.
 *
 * Two actions and nothing else. Every parameter is text: there is no control
 * on this card, because a card you can change settings from is a settings form
 * that appears at submit time, which is what D-159③ rules out. The read-only
 * guarantee is enforced in the props type next door, so this file cannot
 * quietly grow a picker without failing the build.
 *
 * The cost line is the same sentence the passive quota row shows before
 * submitting — one run must not be described two ways on one screen — and it is
 * counts, never money (D1, D-109「供应细节不可见」).
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ExecutionConfirmCardProps } from './execution-confirm-card';

export function ExecutionConfirmCard({
  busy = false,
  className,
  confirmLabel,
  cost,
  onConfirm,
  onReject,
  params,
  rejectLabel,
  staleNotice = null,
  title,
  visible,
}: ExecutionConfirmCardProps) {
  if (!visible) return null;

  // 缺额 disables the way through but leaves the card up: taking it away would
  // remove the explanation of why the run cannot start.
  const confirmDisabled = busy || cost.short || Boolean(staleNotice);

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4',
        'bg-background',
        className
      )}
      data-busy={busy ? 'true' : 'false'}
      data-testid="execution-confirm-card"
    >
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>

      <dl
        className="flex flex-col gap-2"
        data-testid="execution-confirm-params"
      >
        {params.map((row) => (
          <div className="flex flex-col gap-0.5" key={row.key}>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="meiye-type-aux">{row.label}</dt>
              <dd
                className="text-sm text-foreground"
                data-testid={`execution-confirm-param-${row.key}`}
              >
                {row.value}
              </dd>
            </div>
            {row.hint ? (
              // D-164③「用商家语言解释技术参数」. Absent when no honest
              // explanation exists — an invented one is worse than none.
              <p
                className="meiye-type-aux"
                data-testid={`execution-confirm-hint-${row.key}`}
              >
                {row.hint}
              </p>
            ) : null}
          </div>
        ))}
      </dl>

      {cost.notice ? (
        <p
          className="text-sm text-foreground"
          data-testid="execution-confirm-cost"
        >
          {cost.notice}
        </p>
      ) : null}
      {cost.heldNotice ? (
        <p
          className="text-sm text-foreground"
          data-testid="execution-confirm-held"
        >
          {cost.heldNotice}
        </p>
      ) : null}
      {cost.balanceNotice ? (
        <p
          className="meiye-type-aux"
          data-testid="execution-confirm-balance"
        >
          {cost.balanceNotice}
        </p>
      ) : null}
      {cost.refundNotice ? (
        <p
          className="meiye-type-aux"
          data-testid="execution-confirm-refund"
        >
          {cost.refundNotice}
        </p>
      ) : null}
      {cost.rightsNotice ? (
        <p
          className="meiye-type-aux"
          data-testid="execution-confirm-rights"
        >
          {cost.rightsNotice}
        </p>
      ) : null}
      {cost.factNotice ? (
        <p className="meiye-type-aux" data-testid="execution-confirm-facts">
          {cost.factNotice}
        </p>
      ) : null}
      {cost.billingNote ? (
        <p
          className="meiye-type-aux"
          data-testid="execution-confirm-billing-note"
        >
          {cost.billingNote}
        </p>
      ) : null}
      {cost.shortNotice ? (
        <p
          className="text-sm text-destructive"
          data-testid="execution-confirm-short"
          role="alert"
        >
          {cost.shortNotice}
        </p>
      ) : null}
      {staleNotice ? (
        <p
          className="text-sm text-destructive"
          data-testid="execution-confirm-stale"
          role="alert"
        >
          {staleNotice}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {/* 拒绝 is never disabled by 缺额 or a stale quote — the merchant can
            always back out of a card she cannot go forward from. */}
        <Button
          className="min-h-12"
          data-testid="execution-confirm-reject"
          disabled={busy}
          onClick={onReject}
          type="button"
          variant="outline"
        >
          {rejectLabel}
        </Button>
        <Button
          className="min-h-12"
          data-testid="execution-confirm-accept"
          disabled={confirmDisabled}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
