/**
 * Task-in experience surface presenters — P2-13 / D5.
 *
 * Presentational only. AgentFrame `memory` family hosts the three slots so the
 * document timeline registry stays the single visual grammar; producers and
 * projections live in `task-experience.ts`.
 */

import { IconChevronDown } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';

import {
  experience_basis_empty,
  experience_basis_open_vault,
  experience_basis_title,
  experience_correction_empty,
  experience_correction_fact_body,
  experience_correction_fact_label,
  experience_correction_task_body,
  experience_correction_task_label,
  experience_correction_title,
  experience_sediment_empty,
  experience_sediment_later,
  experience_sediment_once,
  experience_sediment_open_vault,
  experience_sediment_title,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import type {
  ExperienceBasisProjection,
  ExperienceCorrectionProjection,
  ExperienceSedimentProjection,
} from './task-experience';

function ExperienceFrame({
  children,
  className,
  defaultOpen = true,
  disclosure = false,
  testId,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  /** Disclosure frames only: start expanded when there is something to read. */
  defaultOpen?: boolean;
  /**
   * A frame that explains a rule rather than reporting an event earns its space
   * only when the merchant asks for it — the title stays on the main axis, the
   * explanation folds away behind it. `details`/`summary` keeps that free with
   * the keyboard and announces itself as a disclosure.
   */
  disclosure?: boolean;
  testId: string;
  title: string;
}) {
  const heading = (
    <h2 className="text-foreground text-xs font-medium">{title}</h2>
  );
  return (
    <section
      aria-label={title}
      className={cn('meiye-porcelain rounded-2xl px-4 py-3', className)}
      data-agent-frame="memory"
      data-testid={testId}
    >
      {disclosure ? (
        <details className="group" open={defaultOpen}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 pointer-coarse:min-h-touch-target [&::-webkit-details-marker]:hidden">
            {heading}
            <IconChevronDown
              aria-hidden="true"
              className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mt-2">{children}</div>
        </details>
      ) : (
        <>
          {heading}
          <div className="mt-2">{children}</div>
        </>
      )}
    </section>
  );
}

export function ExperienceBasisSurface({
  projection,
  className,
}: {
  projection: ExperienceBasisProjection;
  className?: string;
}) {
  return (
    <ExperienceFrame
      className={className}
      testId="experience-basis-surface"
      title={experience_basis_title()}
    >
      {projection.state === 'loading' ? (
        <p className="meiye-type-aux" data-testid="experience-basis-loading">
          …
        </p>
      ) : null}
      {projection.state === 'empty' ? (
        <div data-testid="experience-basis-empty">
          <p className="meiye-type-aux">{experience_basis_empty()}</p>
          <Link
            className="text-foreground mt-2 inline-block text-xs font-medium underline underline-offset-4"
            data-testid="experience-basis-open-vault"
            to={Routes.MemoryVault}
          >
            {experience_basis_open_vault()}
          </Link>
        </div>
      ) : null}
      {projection.state === 'ready' ? (
        <ul
          className="flex flex-wrap gap-2"
          data-testid="experience-basis-chips"
        >
          {projection.chips.map((chip) => (
            <li
              className="bg-muted/40 text-foreground rounded-full px-2.5 py-1 text-xs"
              data-testid={`experience-basis-chip-${chip.id}`}
              key={chip.id}
            >
              {chip.label}
            </li>
          ))}
        </ul>
      ) : null}
    </ExperienceFrame>
  );
}

export function ExperienceSedimentSurface({
  projection,
  className,
  onKeepLater,
  onThisTimeOnly,
}: {
  projection: ExperienceSedimentProjection;
  className?: string;
  /** Optional: host confirms a pending item. Absent → vault link only. */
  onKeepLater?: (entryId: string) => void;
  onThisTimeOnly?: (entryId: string) => void;
}) {
  return (
    <ExperienceFrame
      className={className}
      testId="experience-sediment-surface"
      title={experience_sediment_title()}
    >
      {projection.state === 'loading' ? (
        <p className="meiye-type-aux" data-testid="experience-sediment-loading">
          …
        </p>
      ) : null}
      {projection.state === 'empty' ? (
        <div data-testid="experience-sediment-empty">
          <p className="meiye-type-aux">{experience_sediment_empty()}</p>
          <Link
            className="text-foreground mt-2 inline-block text-xs font-medium underline underline-offset-4"
            data-testid="experience-sediment-open-vault"
            to={Routes.MemoryVault}
          >
            {experience_sediment_open_vault()}
          </Link>
        </div>
      ) : null}
      {projection.state === 'ready' ? (
        <ul className="space-y-3" data-testid="experience-sediment-items">
          {projection.items.map((item) => (
            <li
              className="flex flex-col gap-2"
              data-testid={`experience-sediment-item-${item.id}`}
              key={item.id}
            >
              <p className="text-foreground text-sm">{item.label}</p>
              <div className="flex flex-wrap gap-2">
                {onKeepLater ? (
                  <button
                    className="text-foreground rounded-full border px-2.5 py-1 text-xs"
                    data-testid={`experience-sediment-later-${item.id}`}
                    onClick={() => onKeepLater(item.id)}
                    type="button"
                  >
                    {experience_sediment_later()}
                  </button>
                ) : null}
                {onThisTimeOnly ? (
                  <button
                    className="text-muted rounded-full border px-2.5 py-1 text-xs"
                    data-testid={`experience-sediment-once-${item.id}`}
                    onClick={() => onThisTimeOnly(item.id)}
                    type="button"
                  >
                    {experience_sediment_once()}
                  </button>
                ) : null}
                <Link
                  className="text-foreground inline-flex items-center text-xs font-medium underline underline-offset-4"
                  data-testid={`experience-sediment-vault-${item.id}`}
                  to={Routes.MemoryVault}
                >
                  {experience_sediment_open_vault()}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </ExperienceFrame>
  );
}

export function ExperienceCorrectionSurface({
  projection,
  className,
}: {
  projection: ExperienceCorrectionProjection;
  className?: string;
}) {
  const hasCorrection =
    projection.state !== 'empty' && projection.kind !== null;
  return (
    <ExperienceFrame
      className={className}
      // Nothing classified yet means the body is house rules, not news: it
      // folds behind the title until the merchant opens it. A real
      // classification is news, so it arrives already open.
      defaultOpen={hasCorrection}
      disclosure
      testId="experience-correction-surface"
      title={experience_correction_title()}
    >
      {hasCorrection ? (
        <div
          data-correction-kind={projection.kind}
          data-testid="experience-correction-ready"
        >
          <p className="text-foreground text-xs font-medium">
            {projection.kind === 'fact'
              ? experience_correction_fact_label()
              : experience_correction_task_label()}
          </p>
          <p className="text-foreground mt-1 text-sm">{projection.summary}</p>
          <p className="meiye-type-aux mt-1">
            {projection.kind === 'fact'
              ? experience_correction_fact_body()
              : experience_correction_task_body()}
          </p>
        </div>
      ) : (
        <p className="meiye-type-aux" data-testid="experience-correction-empty">
          {experience_correction_empty()}
        </p>
      )}
    </ExperienceFrame>
  );
}
