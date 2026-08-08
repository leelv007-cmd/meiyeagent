/**
 * Compact Plan commit strip (V31-10 / V3.1 §5.4).
 * Unifies Brief/quote/confirm status into one bar: status chips + two actions.
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { resolveControlledSurface } from '../controlled-surface-registry';
import type { CommitStripAction, CommitStripView } from './commit-strip-model';

export type CommitStripProps = {
  view: CommitStripView;
  onAction?: (action: CommitStripAction) => void;
  busy?: boolean;
  className?: string;
};

export function CommitStrip({
  view,
  onAction,
  busy = false,
  className,
}: CommitStripProps) {
  if (!view.visible) return null;

  const gate = resolveControlledSurface({
    surface: 'commit_strip',
    props: {
      statusLine: view.statusLine,
      startDisabled: view.startDisabled,
      startDisabledReason: view.startDisabledReason,
      readiness: view.readiness,
    },
  });
  if (!gate.ok) return null;

  return (
    <div
      className={cn(
        'border-border bg-background/90 sticky bottom-0 flex flex-col gap-2 rounded-xl border px-3 py-2.5 shadow-sm backdrop-blur',
        className
      )}
      data-readiness={view.readiness ?? 'unknown'}
      data-start-disabled={view.startDisabled ? 'true' : 'false'}
      data-surface="commit_strip"
      data-testid="agent-commit-strip"
    >
      <p
        className="text-foreground text-xs leading-relaxed sm:text-sm"
        data-testid="agent-commit-strip-status"
      >
        {view.statusLine || '方案就绪后显示费用与权利状态'}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {view.actions.map((action) => {
          const isStart = action.id === 'start';
          const disabled = busy || (isStart && view.startDisabled);
          return (
            <Button
              data-action={action.id}
              data-testid={`agent-commit-strip-${action.id}`}
              disabled={disabled}
              key={action.id}
              onClick={() => onAction?.(action.id)}
              size="sm"
              type="button"
              variant={isStart ? 'default' : 'secondary'}
            >
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
