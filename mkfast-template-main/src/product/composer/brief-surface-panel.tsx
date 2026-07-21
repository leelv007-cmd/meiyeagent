/**
 * Compact conditional Brief surface (C4 / #98, D-094).
 *
 * Summary only — does not re-ask Composer fields.
 * Evidence drawer renders only when showEvidenceDrawer is true.
 * Video confirm zone embeds per-second billing when present.
 */

import { cn } from '@/lib/utils';

import type { BriefSurfaceView } from './brief-surface';
import {
  BRIEF_EVIDENCE_TITLE,
  BRIEF_SUMMARY_TITLE,
  BRIEF_TRIGGERS_TITLE,
} from './brief-surface';

export type BriefSurfaceProps = {
  view: BriefSurfaceView;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  className?: string;
};

export function BriefSurface({
  view,
  onConfirm,
  onCancel,
  disabled = false,
  className,
}: BriefSurfaceProps) {
  if (!view.visible) return null;

  return (
    <section
      className={cn(
        'meiye-porcelain flex flex-col gap-4 rounded-2xl border border-border p-4',
        className
      )}
      data-testid="composer-brief-surface"
      aria-label={view.title}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          {view.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          请核对摘要后确认；取消将返回编辑且不丢失已填内容。
        </p>
      </header>

      {view.triggers.length > 0 ? (
        <div
          data-testid="composer-brief-triggers"
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-medium text-foreground">
            {BRIEF_TRIGGERS_TITLE}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {view.triggers.map((trigger) => (
              <li
                key={trigger.code}
                data-testid={`composer-brief-trigger-${trigger.code}`}
                data-trigger-code={trigger.code}
              >
                {trigger.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.summaryRows.length > 0 ? (
        <div
          data-testid="composer-brief-summary"
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-medium text-foreground">
            {BRIEF_SUMMARY_TITLE}
          </h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            {view.summaryRows.map((row) => (
              <div
                key={row.key}
                className="rounded-xl border border-border/60 bg-background/60 px-3 py-2"
                data-testid={`composer-brief-summary-${row.key}`}
              >
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="text-sm text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {view.showEvidenceDrawer ? (
        <aside
          data-testid="composer-brief-evidence-drawer"
          className="flex flex-col gap-2 rounded-xl border border-primary/15 bg-primary/5 p-3"
          aria-label={BRIEF_EVIDENCE_TITLE}
        >
          <h3 className="text-sm font-medium text-foreground">
            {BRIEF_EVIDENCE_TITLE}
          </h3>
          <ul className="flex flex-col gap-2">
            {view.evidenceEntries.map((entry, index) => (
              <li
                key={`${entry.sourceName}-${entry.factKind}-${index}`}
                data-testid="composer-brief-evidence-entry"
                className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-sm"
              >
                <div className="font-medium text-foreground">
                  {entry.sourceName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {entry.sourceType}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {entry.factSummary ?? entry.factKind}
                  {entry.appliedLocation
                    ? ` · 用于：${entry.appliedLocation}`
                    : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {entry.freshness ? (
                    <span>新鲜度：{entry.freshness}</span>
                  ) : null}
                  {entry.rightsStatus ? (
                    <span>权利：{entry.rightsStatus}</span>
                  ) : null}
                  {entry.uncertaintyOrConflict ? (
                    <span className="text-destructive">
                      {entry.uncertaintyOrConflict}
                      {entry.pendingConfirmation ? '（待确认）' : ''}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {view.videoConfirm?.visible ? (
        <fieldset
          data-testid="composer-brief-video-confirm"
          className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
        >
          <legend className="text-sm font-medium text-foreground">
            {view.videoConfirm.title}
          </legend>
          {view.videoConfirm.billingNote ? (
            <p
              className="text-sm font-medium text-foreground"
              data-testid="composer-brief-video-billing-note"
            >
              {view.videoConfirm.billingNote}
            </p>
          ) : null}
          {view.videoConfirm.amountLabel ? (
            <p className="text-sm text-muted-foreground">
              预计额度：{view.videoConfirm.amountLabel}
            </p>
          ) : null}
          {view.videoConfirm.quotedSeconds != null ? (
            <p className="text-xs text-muted-foreground">
              成片时长上限 {view.videoConfirm.quotedSeconds}{' '}
              秒（按生成成片秒数计费）
            </p>
          ) : null}
          <p className="text-sm text-foreground">
            点击“{view.confirmLabel}”即确认本次视频生成费用与时长。
          </p>
        </fieldset>
      ) : null}

      <footer className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button
          type="button"
          data-testid="composer-brief-cancel"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          disabled={disabled}
          onClick={onCancel}
        >
          {view.cancelLabel}
        </button>
        <button
          type="button"
          data-testid="composer-brief-confirm"
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={disabled || !view.canConfirm}
          onClick={onConfirm}
        >
          {view.confirmLabel}
        </button>
      </footer>
    </section>
  );
}
