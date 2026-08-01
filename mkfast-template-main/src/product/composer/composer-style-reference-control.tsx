/**
 * P2-11 / #323 — Composer @素材 style-reference control.
 *
 * Marks an attached asset as a style reference so the independent seven-dim
 * analysis step runs. Does not scrape; only toggles ids the merchant uploaded.
 */

import { cn } from '@/lib/utils';

import {
  STYLE_ANALYSIS_MENTION_HINT,
  STYLE_ANALYSIS_MENTION_LABEL,
  projectStyleAnalysisEntry,
  type StyleAnalysisEntryState,
} from './style-analysis-entry';

export type ComposerStyleReferenceControlProps = {
  assetId: string;
  selected: boolean;
  onToggle: (assetId: string) => void;
  className?: string;
};

export function ComposerStyleReferenceControl({
  assetId,
  selected,
  onToggle,
  className,
}: ComposerStyleReferenceControlProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border/60 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`composer-style-reference-${assetId}`}
      onClick={() => onToggle(assetId)}
      title={STYLE_ANALYSIS_MENTION_HINT}
      type="button"
    >
      {selected ? `已选·${STYLE_ANALYSIS_MENTION_LABEL}` : `@素材 · ${STYLE_ANALYSIS_MENTION_LABEL}`}
    </button>
  );
}

export type ComposerStyleAnalysisStageNoticeProps = {
  state: StyleAnalysisEntryState;
  className?: string;
};

/** Timeline / draft notice when style analysis will run. */
export function ComposerStyleAnalysisStageNotice({
  state,
  className,
}: ComposerStyleAnalysisStageNoticeProps) {
  if (!state.willAnalyze || !state.stageMessage) return null;
  return (
    <p
      className={cn('text-muted text-xs leading-relaxed', className)}
      data-stage-id={state.stageId ?? undefined}
      data-testid="composer-style-analysis-stage"
    >
      {state.stageMessage}
    </p>
  );
}

export function buildStyleAnalysisStageFromAssets(input: {
  attachedAssetIds: readonly string[];
  styleReferenceAssetIds: readonly string[];
}): StyleAnalysisEntryState {
  return projectStyleAnalysisEntry(input);
}
