/**
 * Post-apply inline tip + undo (C2 / #96, D-083 §4).
 *
 * Single polite live announcement on apply; no announcements while typing.
 */

import { cn } from '@/lib/utils';

import { UNDO_LABEL } from './launch-card-seeds';
import type { MissingInputFocus, RecipeApplySession } from './recipe-apply';

export type RecipeApplyTipProps = {
  session: RecipeApplySession;
  onUndo: () => void;
  className?: string;
};

export function RecipeApplyTip({
  session,
  onUndo,
  className,
}: RecipeApplyTipProps) {
  if (session.phase !== 'applied' || !session.tip) {
    return (
      <ApplyLiveRegion announcement={session.announcement} />
    );
  }

  return (
    <>
      <div
        data-testid="composer-recipe-apply-tip"
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-2xl bg-muted/80 px-3 py-2 text-sm',
          className
        )}
      >
        <span data-testid="composer-recipe-apply-tip-text">{session.tip}</span>
        {session.canUndo ? (
          <button
            type="button"
            data-testid="composer-recipe-apply-undo"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full px-3 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onUndo}
          >
            {session.undoLabel || UNDO_LABEL}
          </button>
        ) : null}
      </div>
      <ApplyLiveRegion announcement={session.announcement} />
      {session.focusMissing ? (
        <MissingInputHint missing={session.focusMissing} />
      ) : null}
    </>
  );
}

function ApplyLiveRegion({
  announcement,
}: {
  announcement: string | null;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="composer-recipe-apply-live"
      className="sr-only"
    >
      {announcement ?? ''}
    </div>
  );
}

function MissingInputHint({ missing }: { missing: MissingInputFocus }) {
  return (
    <p
      data-testid="composer-recipe-missing-input"
      data-focus-slot={missing.slot}
      className="text-xs text-muted-foreground"
    >
      请补充：{missing.slot}
    </p>
  );
}
