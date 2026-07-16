import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type WorkbenchStage = 'empty' | 'running' | 'result';

export function WorkbenchStageShell({
  articleLabel,
  children,
  jobCount,
  rail,
  stage,
}: {
  articleLabel: string;
  children: ReactNode;
  jobCount: number;
  rail: ReactNode;
  stage: WorkbenchStage;
}) {
  return (
    <>
      <article
        aria-label={articleLabel}
        className={cn(
          'flex min-w-0 flex-col gap-4',
          stage === 'empty' ? '' : 'xl:col-span-2'
        )}
        data-job-count={jobCount}
        data-workbench-stage={stage}
      >
        {children}
      </article>
      {stage === 'empty' ? rail : null}
    </>
  );
}

/** Sticky gravity for the media / generation primary surface. */
export function WorkbenchPrimarySurface({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        'space-y-4',
        sticky && 'xl:sticky xl:top-4 xl:z-10',
        className
      )}
      data-workbench-primary=""
    >
      {children}
    </div>
  );
}

/** Compact progress / work summary strip — not a full RecordSection. */
export function WorkbenchStatusStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'meiye-porcelain flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3',
        className
      )}
      data-workbench-status-strip=""
    >
      {children}
    </div>
  );
}

/** Composer axis surface — sole primary action column when empty. */
export function WorkbenchComposerAxis({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        'space-y-4',
        sticky &&
          'xl:sticky xl:bottom-4 xl:z-[9] xl:rounded-[2rem] xl:bg-[var(--canvas)]/90 xl:py-2 xl:backdrop-blur-sm',
        className
      )}
      data-workbench-composer-axis=""
    >
      {children}
    </div>
  );
}
