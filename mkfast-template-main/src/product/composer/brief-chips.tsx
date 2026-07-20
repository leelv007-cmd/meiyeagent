/**
 * T1 brief chips re-hang for new Composer (C2 / #96).
 *
 * Keeps core auto-confirm seam (autoConfirming status).
 * Kills the expand-four-card path — chips stay compact; no expanded
 * four-field card grid in this surface.
 */

import type { CreativeBrief, CreativeBriefFieldId } from '@meiye/contracts';
import { cn } from '@/lib/utils';

const FIELD_LABELS: Record<CreativeBriefFieldId, string> = {
  intent: '意图',
  scene: '场景',
  tone: '语气',
  audience: '受众',
};

const FIELD_ORDER: CreativeBriefFieldId[] = [
  'intent',
  'scene',
  'tone',
  'audience',
];

export type ComposerBriefChip = {
  field: CreativeBriefFieldId;
  label: string;
  value: string;
};

/** Confirmed field values only — never fall back to unconfirmed drafts. */
export function projectComposerBriefChips(
  brief: CreativeBrief | undefined
): ComposerBriefChip[] {
  if (!brief?.confirmedAt) return [];
  return FIELD_ORDER.flatMap((field) => {
    const value = brief.fields[field]?.current?.trim();
    if (!value) return [];
    return [{ field, label: FIELD_LABELS[field], value }];
  });
}

export type ComposerBriefChipsProps = {
  brief?: CreativeBrief;
  /** Core auto-confirm in flight — non-blocking status, no expand. */
  autoConfirming?: boolean;
  className?: string;
};

/**
 * Compact "本次将使用" chips for Composer.
 * Intentionally has NO expand-to-four-cards control.
 */
export function ComposerBriefChips({
  brief,
  autoConfirming = false,
  className,
}: ComposerBriefChipsProps) {
  const confirmed = Boolean(brief?.confirmedAt);
  const chips = projectComposerBriefChips(brief);

  if (autoConfirming && !confirmed) {
    return (
      <section
        aria-busy="true"
        aria-label="创作说明"
        data-testid="composer-brief-auto-confirming"
        className={cn('space-y-2', className)}
      >
        <p className="text-sm text-muted-foreground">正在确认创作说明…</p>
      </section>
    );
  }

  if (!confirmed || chips.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="创作说明"
      data-testid="composer-brief-chips"
      className={cn('space-y-2', className)}
    >
      <p className="text-sm font-medium">本次将使用</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip.field}
            data-brief-chip={chip.field}
            data-testid={`composer-brief-chip-${chip.field}`}
            className="max-w-full rounded-full border border-divider bg-surface-1 px-3 py-1.5 text-left text-xs"
          >
            <span className="font-medium text-muted-foreground">
              {chip.label}
            </span>
            <span className="ml-1.5 text-foreground">
              {chip.value.length > 28
                ? `${chip.value.slice(0, 28)}…`
                : chip.value}
            </span>
          </span>
        ))}
      </div>
      {/*
        Expand-four-card path intentionally omitted (T1 re-hang / D-074).
        Full brief editing lives outside this compact Composer surface.
      */}
    </section>
  );
}
