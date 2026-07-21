/**
 * RecipePatchPreview conflict surface (C2 / #96, D-083).
 *
 * Desktop: inline panel. Mobile host may wrap in a single bottom sheet.
 * Lists come from actual RecipePatchPreview diffs — never fixed copy.
 * Two CTAs from A2: primary (套用并更新设置 / 切换到{对口}并套用) + 取消.
 */

import type {
  RecipePatchFieldDiff,
  RecipePatchPreview,
} from '@meiye/contracts';
import { cn } from '@/lib/utils';

import { CTA_CANCEL } from './launch-card-seeds';
import { COMPOSER_LENS_LABELS } from './lens-labels';

export type RecipePatchPreviewSurfaceProps = {
  preview: RecipePatchPreview;
  recipeTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
};

function groupByAction(preview: RecipePatchPreview): {
  preserve: RecipePatchFieldDiff[];
  stash: RecipePatchFieldDiff[];
  change: RecipePatchFieldDiff[];
} {
  const preserve: RecipePatchFieldDiff[] = [];
  const stash: RecipePatchFieldDiff[] = [];
  const change: RecipePatchFieldDiff[] = [];
  for (const entry of preview.conflicts) {
    if (entry.action === 'preserve') preserve.push(entry);
    else if (entry.action === 'stash') stash.push(entry);
    else change.push(entry);
  }
  return { preserve, stash, change };
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'userText':
      return '你输入的内容';
    case 'sources':
      return '已添加的来源和上传素材';
    case 'lensId':
      return '创作类型';
    case 'recipeRevisionId':
      return '模板';
    case 'delivery':
      return '输出';
    case 'modelPolicy':
      return '模型';
    case 'confirmedQuoteRef':
      return '已确认报价';
    default:
      if (field.startsWith('settings.')) {
        return `设置 · ${field.slice('settings.'.length)}`;
      }
      return field;
  }
}

function formatLens(value: unknown): string {
  if (value === 'copy' || value === 'image_text' || value === 'video') {
    return COMPOSER_LENS_LABELS[value];
  }
  if (value == null) return '未选择';
  return String(value);
}

function formatValue(field: string, value: unknown): string {
  if (field === 'lensId') return formatLens(value);
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('deliverableKind' in obj || 'aspectRatio' in obj || 'quantity' in obj) {
      const parts: string[] = [];
      if (obj.quantity != null) parts.push(`${obj.quantity}`);
      if (obj.aspectRatio) parts.push(String(obj.aspectRatio));
      if (obj.deliverableKind) parts.push(String(obj.deliverableKind));
      if (obj.durationSeconds != null) parts.push(`${obj.durationSeconds} 秒`);
      if (obj.platform) parts.push(String(obj.platform));
      return parts.join(' · ') || '—';
    }
    if ('mode' in obj) {
      return obj.mode === 'fixed'
        ? `指定模型${obj.catalogModelId ? ` · ${obj.catalogModelId}` : ''}`
        : '自动模型';
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

export function RecipePatchPreviewSurface({
  preview,
  recipeTitle,
  onConfirm,
  onCancel,
  className,
}: RecipePatchPreviewSurfaceProps) {
  const groups = groupByAction(preview);
  const lensLabel = COMPOSER_LENS_LABELS[preview.lensId];
  const heading =
    preview.conflictKind === 'cross_lens'
      ? `切换到${lensLabel}并套用“${recipeTitle}”？`
      : `套用“${recipeTitle}”并更新设置？`;

  const primaryLabel =
    preview.primaryCtaLabel ??
    (preview.conflictKind === 'cross_lens'
      ? `切换到${lensLabel}并套用`
      : '套用并更新设置');
  const cancelLabel = preview.cancelCtaLabel ?? CTA_CANCEL;

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="composer-patch-preview-title"
      data-testid="composer-recipe-patch-preview"
      data-conflict-kind={preview.conflictKind}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-input bg-background p-4 shadow-sm',
        className
      )}
    >
      <h2
        id="composer-patch-preview-title"
        className="text-base font-semibold text-foreground"
      >
        {heading}
      </h2>

      {groups.preserve.length > 0 ? (
        <DiffGroup
          title="保留"
          testId="composer-patch-preserve"
          entries={groups.preserve}
          mode="preserve"
        />
      ) : null}

      {groups.stash.length > 0 ? (
        <DiffGroup
          title="暂存"
          testId="composer-patch-stash"
          entries={groups.stash}
          mode="stash"
        />
      ) : null}

      {groups.change.length > 0 ? (
        <DiffGroup
          title="改变"
          testId="composer-patch-change"
          entries={groups.change}
          mode="change"
        />
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="composer-patch-cancel"
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-input px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          data-testid="composer-patch-confirm"
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onConfirm}
        >
          {primaryLabel}
        </button>
      </div>
    </section>
  );
}

function DiffGroup({
  title,
  testId,
  entries,
  mode,
}: {
  title: string;
  testId: string;
  entries: RecipePatchFieldDiff[];
  mode: 'preserve' | 'stash' | 'change';
}) {
  return (
    <div data-testid={testId} className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1 text-sm text-foreground">
        {entries.map((entry) => (
          <li key={`${mode}-${entry.field}`} data-field={entry.field}>
            {mode === 'change' && entry.from !== undefined ? (
              <>
                · {fieldLabel(entry.field)}：
                {formatValue(entry.field, entry.from)} →{' '}
                {formatValue(entry.field, entry.to)}
              </>
            ) : (
              <>· {fieldLabel(entry.field)}</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
