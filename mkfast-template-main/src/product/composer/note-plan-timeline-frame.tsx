/**
 * Multi-page note outline frame on the Composer document timeline (#319).
 *
 * Editable outline uses plain inputs only — rich-text editor stays in the
 * object workspace (C12 / D-171). Image status + per-page regenerate are
 * product-surface controls; generation truth stays on Core / ContentPackage.
 */

import { cn } from '@/lib/utils';

import {
  NOTE_PAGE_IMAGE_STATUS_LABELS,
  type NotePlanTimeline,
  type NotePlanTimelinePage,
  type NotePageImageStatus,
} from './note-plan-timeline';

export type NotePlanTimelineFrameProps = {
  timeline: NotePlanTimeline;
  onEditOutline?: (input: {
    pageId: string;
    title: string;
    body: string;
  }) => void;
  onSaveOutline?: (pageId: string) => void;
  outlineSaveError?: { message: string; pageId: string } | null;
  outlineSavePendingPageId?: string | null;
  onRegeneratePage?: (pageId: string) => void;
  regenerateError?: { message: string; pageId: string } | null;
  /** Delivery-time ContentPackage hydrate failed — page regen is unavailable. */
  hydrationError?: { reason: string; message: string } | null;
  className?: string;
  /** When true, outline fields are read-only (e.g. mid-generation lock). */
  outlineReadOnly?: boolean;
};

function statusTone(status: NotePageImageStatus): string {
  switch (status) {
    case 'ready':
      return 'text-emerald-700 bg-emerald-50';
    case 'generating':
      return 'text-amber-800 bg-amber-50';
    case 'failed':
      return 'text-red-700 bg-red-50';
    default:
      return 'text-muted bg-muted/30';
  }
}

function NotePlanPageRow({
  page,
  onEditOutline,
  onSaveOutline,
  onRegeneratePage,
  outlineSaveError,
  outlineSavePendingPageId,
  regenerateError,
  outlineReadOnly,
}: {
  page: NotePlanTimelinePage;
  onEditOutline?: NotePlanTimelineFrameProps['onEditOutline'];
  onSaveOutline?: NotePlanTimelineFrameProps['onSaveOutline'];
  onRegeneratePage?: NotePlanTimelineFrameProps['onRegeneratePage'];
  outlineSaveError?: NotePlanTimelineFrameProps['outlineSaveError'];
  outlineSavePendingPageId?: string | null;
  regenerateError?: NotePlanTimelineFrameProps['regenerateError'];
  outlineReadOnly?: boolean;
}) {
  const savePending = outlineSavePendingPageId === page.pageId;
  const editable = Boolean(onEditOutline) && !outlineReadOnly && !savePending;
  const pageOutlineError =
    outlineSaveError?.pageId === page.pageId ? outlineSaveError : null;
  const pageRegenerateError =
    regenerateError?.pageId === page.pageId ? regenerateError : null;
  return (
    <li
      className="meiye-glass-piece rounded-xl p-3"
      data-image-status={page.imageStatus}
      data-outline-dirty={page.outlineDirty ? 'true' : 'false'}
      data-page-id={page.pageId}
      data-page-role={page.pageRole}
      data-testid="note-plan-page-row"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="text-foreground text-xs font-medium"
          data-testid="note-plan-page-order"
        >
          第 {page.order} 页
        </span>
        <span className="text-muted text-xs" data-testid="note-plan-page-role">
          {page.pageRole}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            statusTone(page.imageStatus)
          )}
          data-testid="note-plan-page-image-status"
        >
          {NOTE_PAGE_IMAGE_STATUS_LABELS[page.imageStatus]}
        </span>
      </div>

      <label
        className="text-muted mb-1 block text-xs"
        htmlFor={`${page.pageId}-title`}
      >
        大纲标题
      </label>
      <input
        className="border-border bg-background text-foreground mb-2 w-full rounded-lg border px-2 py-1.5 text-sm"
        data-testid="note-plan-page-title-input"
        disabled={!editable}
        id={`${page.pageId}-title`}
        onChange={(event) =>
          onEditOutline?.({
            pageId: page.pageId,
            title: event.target.value,
            body: page.body,
          })
        }
        value={page.title}
      />

      <label
        className="text-muted mb-1 block text-xs"
        htmlFor={`${page.pageId}-body`}
      >
        大纲正文
      </label>
      <textarea
        className="border-border bg-background text-foreground mb-2 w-full rounded-lg border px-2 py-1.5 text-sm leading-relaxed"
        data-testid="note-plan-page-body-input"
        disabled={!editable}
        id={`${page.pageId}-body`}
        onChange={(event) =>
          onEditOutline?.({
            pageId: page.pageId,
            title: page.title,
            body: event.target.value,
          })
        }
        rows={3}
        value={page.body}
      />

      {page.outlineDirty && onSaveOutline ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            className="meiye-glass-piece rounded-full px-3 py-1 text-xs disabled:opacity-50"
            data-testid="note-plan-page-save-outline"
            disabled={savePending}
            onClick={() => onSaveOutline(page.pageId)}
            type="button"
          >
            {savePending
              ? '保存中…'
              : pageOutlineError
                ? '重试保存大纲'
                : '保存大纲'}
          </button>
          {pageOutlineError ? (
            <p className="text-xs text-destructive" role="alert">
              {pageOutlineError.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {onRegeneratePage ? (
        <button
          className="meiye-glass-piece rounded-full px-3 py-1 text-xs disabled:opacity-50"
          data-testid="note-plan-page-regenerate"
          disabled={
            page.imageStatus === 'generating' || page.regenerateRequested
          }
          onClick={() => onRegeneratePage(page.pageId)}
          type="button"
        >
          {page.regenerateRequested || page.imageStatus === 'generating'
            ? page.imageStatus === 'generating'
              ? '重生中…'
              : '等待确认…'
            : '重新生成此页配图'}
        </button>
      ) : null}
      {pageRegenerateError ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {pageRegenerateError.message}
        </p>
      ) : null}
    </li>
  );
}

export function NotePlanTimelineFrame({
  timeline,
  onEditOutline,
  onSaveOutline,
  onRegeneratePage,
  outlineSaveError,
  outlineSavePendingPageId,
  regenerateError,
  hydrationError,
  className,
  outlineReadOnly,
}: NotePlanTimelineFrameProps) {
  return (
    <section
      className={cn('meiye-porcelain rounded-2xl p-4', className)}
      data-page-count={timeline.pages.length}
      data-testid="note-plan-timeline-frame"
      data-theme-anchor={timeline.themeAnchor}
    >
      <header className="mb-3">
        <h3 className="text-foreground text-sm font-medium">多页图文大纲</h3>
        <p
          className="text-muted mt-1 text-xs leading-relaxed"
          data-testid="note-plan-theme-anchor"
        >
          {timeline.themeAnchor}
          {timeline.styleName ? ` · ${timeline.styleName}` : ''}
        </p>
        {hydrationError ? (
          <p
            className="mt-2 text-xs text-destructive"
            data-reason={hydrationError.reason}
            data-testid="note-plan-hydration-error"
            role="alert"
          >
            {hydrationError.message}
          </p>
        ) : null}
      </header>
      <ol className="flex flex-col gap-3" data-testid="note-plan-page-list">
        {timeline.pages.map((page) => (
          <NotePlanPageRow
            key={page.pageId}
            onEditOutline={onEditOutline}
            onSaveOutline={onSaveOutline}
            onRegeneratePage={onRegeneratePage}
            outlineSaveError={outlineSaveError}
            outlineSavePendingPageId={outlineSavePendingPageId}
            regenerateError={regenerateError}
            outlineReadOnly={outlineReadOnly}
            page={page}
          />
        ))}
      </ol>
    </section>
  );
}
