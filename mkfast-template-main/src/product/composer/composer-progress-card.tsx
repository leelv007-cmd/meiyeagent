/**
 * 进度宣告卡 — the first of the three outbound seam messages (T31 / #225).
 *
 * D-116 makes the five-stage 白话进度 an first-class output surface, not a log:
 * the merchant is meant to read a delivery statement from a collaborator, so
 * the announcements are grouped into one card that says where the run is, with
 * the newest line carrying the run's current state.
 *
 * The frames come from the existing `workflow.progress` channel (ADR-0007,
 * consumed by product/use-workflow-event-stream) — this card never opens a
 * second stream, and it never rewrites what core said: core owns the wording
 * (harness/merchant-delivery-language.ts) and this is its projection.
 */

import { ChatLoader } from '@/components/heroui-pro';
import { cn } from '@/lib/utils';

import type { ComposerStageTurn } from './composer-session';

export type ComposerProgressCardProps = {
  /** Ordered stage announcements, oldest first. */
  stages: ComposerStageTurn[];
  /** Whether the run is still moving — drives the live marker on the last row. */
  running: boolean;
  className?: string;
};

export function ComposerProgressCard({
  stages,
  running,
  className,
}: ComposerProgressCardProps) {
  if (stages.length === 0) return null;
  const lastIndex = stages.length - 1;

  return (
    <section
      aria-label="创作进度"
      // aria-live so a merchant using a screen reader hears the run move on;
      // polite because announcements must never interrupt what they are typing.
      aria-live="polite"
      className={cn('meiye-porcelain rounded-2xl p-4', className)}
      data-running={running ? 'true' : 'false'}
      data-testid="composer-progress-card"
    >
      <ol className="flex flex-col gap-2">
        {stages.map((stage, index) => {
          const live = running && index === lastIndex;
          return (
            <li className="flex items-start gap-2" key={stage.id}>
              <span
                aria-hidden="true"
                className="mt-1.5 flex h-3 w-3 shrink-0 items-center justify-center"
              >
                {live ? (
                  <ChatLoader.Dots />
                ) : (
                  <span className="bg-foreground/25 h-1.5 w-1.5 rounded-full" />
                )}
              </span>
              <p
                className={cn(
                  'text-xs',
                  live ? 'text-foreground' : 'text-muted'
                )}
                data-stage={stage.stage}
                // Kept from the pre-card stage line: the D-114 container spec
                // and its journey assertions address announcements by this id.
                data-testid="composer-stage-line"
              >
                {stage.message}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
