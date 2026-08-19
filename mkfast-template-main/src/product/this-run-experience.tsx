/**
 * MEM-02 / R-P1-07: stable Artifact/Work entry for this-run experience.
 *
 * Binds the MemoryInjectionReceipt to an exact task. No task → honest empty.
 * Never queries a guessed workspace-latest task.
 */
import {
  this_run_experience_empty,
  this_run_experience_title,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';

import { MemoryInjectionReceiptPanel } from '@/product/memory-injection-receipt';

export function ThisRunExperienceEntry({
  taskId,
  className,
}: {
  taskId: string | null;
  className?: string;
}) {
  const boundTaskId = taskId?.trim() || null;
  return (
    <section
      className={cn('meiye-porcelain rounded-2xl p-4', className)}
      data-task-id={boundTaskId ?? ''}
      data-testid="this-run-experience"
    >
      <h2 className="text-foreground text-xs font-medium">
        {this_run_experience_title()}
      </h2>
      {boundTaskId ? (
        <div className="mt-2" data-testid="this-run-experience-receipt">
          <MemoryInjectionReceiptPanel taskId={boundTaskId} />
        </div>
      ) : (
        <p
          className="meiye-type-aux mt-2"
          data-testid="this-run-experience-empty"
        >
          {this_run_experience_empty()}
        </p>
      )}
    </section>
  );
}
