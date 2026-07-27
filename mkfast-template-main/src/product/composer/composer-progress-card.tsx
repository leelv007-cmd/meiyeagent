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
 *
 * The rail itself is HeroUI Pro `ChainOfThought` (U03): the hand-rolled
 * `<ol>` + dot markers were that component's step list with different class
 * names. It stays **expanded by default** — a disclosure that hides the
 * delivery statement would contradict D-116 — but a merchant who has read it
 * may now fold it away, which the hand-rolled list could not offer.
 */

import { ChainOfThought, ChatLoader } from '@/components/heroui-pro';
import { composer_progress_card_title } from '@/locale/paraglide/messages';
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
    <ChainOfThought
      aria-label={composer_progress_card_title()}
      // aria-live so a merchant using a screen reader hears the run move on;
      // polite because announcements must never interrupt what they are typing.
      aria-live="polite"
      // `.meiye-progress-rail` is the app-side adaptation of the unit (see
      // heroui-glass.css): upstream styles these labels as a foldable reasoning
      // trace, D-116 makes them a delivery statement.
      className={cn(
        'meiye-porcelain meiye-progress-rail rounded-2xl p-4',
        className
      )}
      data-running={running ? 'true' : 'false'}
      data-testid="composer-progress-card"
      defaultExpanded
      isStreaming={running}
    >
      <ChainOfThought.Trigger>
        {composer_progress_card_title()}
      </ChainOfThought.Trigger>
      <ChainOfThought.Content>
        <ChainOfThought.Steps>
          {stages.map((stage, index) => {
            const live = running && index === lastIndex;
            return (
              <ChainOfThought.Step
                key={stage.id}
                label={
                  <span
                    // 白话进度 is an output surface D-116 expects the merchant
                    // to read, so past stages stay legible rather than dropping
                    // to footnote grey; only the emphasis differs from the live
                    // one. The colour itself comes from `.meiye-progress-rail`,
                    // because the unit's own label colour is unlayered and a
                    // utility class here would lose to it.
                    className="text-xs"
                    data-live={live ? 'true' : 'false'}
                    data-stage={stage.stage}
                    // Kept from the pre-card stage line: the D-114 container
                    // spec and its journey assertions address announcements by
                    // this id.
                    data-testid="composer-stage-line"
                  >
                    {stage.message}
                  </span>
                }
              >
                {live ? (
                  <span
                    aria-hidden="true"
                    className="flex h-3 w-3 items-center justify-center"
                  >
                    <ChatLoader.Dots />
                  </span>
                ) : null}
              </ChainOfThought.Step>
            );
          })}
        </ChainOfThought.Steps>
      </ChainOfThought.Content>
    </ChainOfThought>
  );
}
