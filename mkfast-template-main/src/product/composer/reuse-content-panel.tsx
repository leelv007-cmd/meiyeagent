/**
 * "旧内容换平台" focus panel (C2 / #96, D-083 §6).
 *
 * Cold: source / form (lens) / carrier all have NO defaults.
 * Primary CTA disabled until form + carrier chosen.
 * Does not auto-infer lens from source media or keywords.
 */

import type { CreationLensId } from '@meiye/contracts';
import { cn } from '@/lib/utils';

import { REUSE_INCOMPLETE_CTA, actionLabelForLens } from './launch-card-seeds';
import { COMPOSER_LENS_OPTIONS } from './lens-labels';
import type { ReusePanelSelection } from './recipe-apply';
import { reusePanelReady } from './recipe-apply';

export type ReuseSourceOption = {
  id: string;
  label: string;
  kind?: string;
};

export type ReuseCarrierOption = {
  id: string;
  label: string;
  /** Compatible lens ids; empty = all. */
  lensIds?: CreationLensId[];
};

export type ReuseContentPanelProps = {
  selection: ReusePanelSelection;
  onChange: (next: ReusePanelSelection) => void;
  onConfirm: () => void;
  onCancel: () => void;
  sourceOptions?: ReuseSourceOption[];
  carrierOptions?: ReuseCarrierOption[];
  className?: string;
};

const DEFAULT_CARRIERS: ReuseCarrierOption[] = [
  {
    id: 'xiaohongshu',
    label: '小红书',
    lensIds: ['image_text', 'video', 'copy'],
  },
  { id: 'wechat_moments', label: '朋友圈', lensIds: ['copy', 'image_text'] },
  { id: 'douyin', label: '抖音', lensIds: ['video', 'image_text'] },
];

export function ReuseContentPanel({
  selection,
  onChange,
  onConfirm,
  onCancel,
  sourceOptions = [],
  carrierOptions = DEFAULT_CARRIERS,
  className,
}: ReuseContentPanelProps) {
  const ready = reusePanelReady(selection);
  const primaryLabel =
    ready && selection.lensId
      ? actionLabelForLens(selection.lensId)
      : REUSE_INCOMPLETE_CTA;

  const carriers = carrierOptions.filter((carrier) => {
    if (!selection.lensId) return true;
    if (!carrier.lensIds || carrier.lensIds.length === 0) return true;
    return carrier.lensIds.includes(selection.lensId);
  });

  return (
    <section
      data-testid="composer-reuse-content-panel"
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-input bg-background p-4 shadow-sm',
        className
      )}
    >
      <h2
        id="composer-reuse-panel-title"
        className="text-base font-semibold text-foreground"
      >
        旧内容换平台
      </h2>

      {/* 1. Source */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">选择一条已有内容</legend>
        {sourceOptions.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="composer-reuse-source-empty"
          >
            暂无可用内容，请先从最近创作中选择或上传
          </p>
        ) : (
          <div
            role="listbox"
            aria-label="已有内容"
            className="flex max-h-40 flex-col gap-1 overflow-y-auto"
          >
            {sourceOptions.map((option) => {
              const selected =
                selection.source != null &&
                typeof selection.source === 'object' &&
                'id' in (selection.source as object) &&
                (selection.source as { id: string }).id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`composer-reuse-source-${option.id}`}
                  className={cn(
                    'min-h-12 rounded-xl border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-input bg-background'
                  )}
                  onClick={() =>
                    onChange({
                      ...selection,
                      source: { id: option.id, kind: option.kind },
                    })
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {/* 2. Form (lens) — radiogroup, no default */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">这次要做成什么？</legend>
        <div
          data-testid="composer-reuse-lens-group"
          className="flex flex-wrap gap-2"
        >
          {COMPOSER_LENS_OPTIONS.map((option) => {
            const selected = selection.lensId === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  'relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border px-4 text-sm font-medium',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background'
                )}
              >
                <input
                  type="radio"
                  name="composer-reuse-lens"
                  value={option.id}
                  checked={selected}
                  data-testid={`composer-reuse-lens-${option.id}`}
                  className="absolute inset-0 appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={() =>
                    onChange({
                      ...selection,
                      lensId: option.id,
                      // Changing form clears carrier (no silent keep of incompatible).
                      carrier: null,
                    })
                  }
                />
                <span className="relative pointer-events-none">
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 3. Carrier — no default */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">准备发布到哪里？</legend>
        <div
          data-testid="composer-reuse-carrier-group"
          className="flex flex-wrap gap-2"
        >
          {carriers.map((carrier) => {
            const selected = selection.carrier === carrier.id;
            return (
              <label
                key={carrier.id}
                className={cn(
                  'relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border px-4 text-sm font-medium',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background'
                )}
              >
                <input
                  type="radio"
                  name="composer-reuse-carrier"
                  value={carrier.id}
                  checked={selected}
                  data-testid={`composer-reuse-carrier-${carrier.id}`}
                  className="absolute inset-0 appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={() =>
                    onChange({
                      ...selection,
                      carrier: carrier.id,
                    })
                  }
                />
                <span className="relative pointer-events-none">
                  {carrier.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="composer-reuse-cancel"
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-input px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          data-testid="composer-reuse-confirm"
          disabled={!ready}
          className={cn(
            'inline-flex min-h-12 min-w-12 items-center justify-center rounded-full px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ready
              ? 'bg-primary text-primary-foreground'
              : 'cursor-not-allowed bg-muted text-muted-foreground'
          )}
          onClick={() => {
            if (ready) onConfirm();
          }}
        >
          {primaryLabel}
        </button>
      </div>
    </section>
  );
}

export function emptyReuseSelection(): ReusePanelSelection {
  return { source: null, lensId: null, carrier: null };
}
