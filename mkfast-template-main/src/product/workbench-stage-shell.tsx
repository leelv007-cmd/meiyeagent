import type { ReactNode } from 'react';

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
        className={`flex flex-col rounded-lg bg-surface-1 px-4 sm:px-6${
          stage === 'empty' ? '' : ' xl:col-span-2'
        }`}
        data-job-count={jobCount}
        data-workbench-stage={stage}
      >
        {children}
      </article>
      {stage === 'empty' ? rail : null}
    </>
  );
}
