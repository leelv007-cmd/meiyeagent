/**
 * 失败/partial 申报卡 — W03 / P0-2 (D-096 / D-116 / D-122).
 *
 * Before this card a failed run rendered as nothing: the transcript stopped and
 * a generic toast said 「操作未完成，请检查当前状态后重试」, while the Chinese
 * failure copy Core had already written died in the transport layer. The card is
 * the other half of that fix — it states 白话原因, 下一步动作 and the 额度 outcome,
 * and every failure ends with at least one way forward.
 *
 * Nothing here re-words Core: `message` and `nextStep` arrive on the terminal
 * frame. The browser owns presentation and the recovery entries only, which is
 * what keeps one merchant-language contract instead of two.
 */

import type { MerchantRecoveryAction, MerchantReport } from '@meiye/contracts';

import { cn } from '@/lib/utils';

export type ComposerRecoveryInput = {
  action: MerchantRecoveryAction;
  report: MerchantReport;
};

const ACTION_LABELS: Record<MerchantRecoveryAction, string> = {
  retry: '再生成一次',
  adjust_intent: '改一下要求',
  switch_form: '换种形式',
  review_partial: '看看已完成的部分',
};

const KIND_TITLES: Record<MerchantReport['kind'], string> = {
  failure: '这次没有做成',
  partial: '做好了一部分',
};

export type ComposerReportCardProps = {
  report: MerchantReport;
  onRecover: (input: ComposerRecoveryInput) => void;
  /** Hidden when the run never reserved anything to give back. */
  className?: string;
};

export function ComposerReportCard({
  report,
  onRecover,
  className,
}: ComposerReportCardProps) {
  return (
    <section
      aria-live="polite"
      className={cn('meiye-porcelain rounded-2xl p-4', className)}
      data-category={report.category}
      data-report-kind={report.kind}
      data-testid="composer-report-card"
    >
      <p
        className="text-foreground text-sm font-medium"
        data-testid="composer-report-title"
      >
        {KIND_TITLES[report.kind]}
      </p>
      <p
        className="text-foreground/80 mt-1.5 text-sm leading-relaxed"
        data-testid="composer-report-reason"
      >
        {report.message}
      </p>
      <p
        className="text-foreground/80 mt-1.5 text-sm leading-relaxed"
        data-testid="composer-report-next-step"
      >
        {report.nextStep}
      </p>
      {report.quotaRefunded ? (
        // 额度退还可见: the merchant is told the reservation came back rather
        // than being left to compare two numbers on the composer.
        <p
          className="text-muted mt-2 text-xs"
          data-testid="composer-report-quota"
        >
          这次没有扣你的额度，已经退回。
        </p>
      ) : null}
      <div
        className="mt-3 flex flex-wrap gap-2"
        data-testid="composer-report-actions"
      >
        {report.actions.map((action) => (
          <button
            className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
            data-testid={`composer-report-action-${action}`}
            key={action}
            onClick={() => onRecover({ action, report })}
            type="button"
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </section>
  );
}
