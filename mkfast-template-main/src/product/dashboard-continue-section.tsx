/**
 * 段③ Activity Shelf（完整版）— D-164① / D6 / P1-3 (#318).
 *
 * Was plain underline links; now ≤3 horizontal object cards:
 * thumbnail / status / next action, generous whitespace. Needs-attention first.
 * Empty workspace stays silent (段① already shows samples). Load failure
 * stays honest instead of looking like a cold start.
 *
 * Reuses the workbench projection the recommendation card already reads.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  IconArrowRight,
  IconFileText,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-react';
import type { CreativeWorkbenchProjection } from '@meiye/contracts';
import { useState } from 'react';

import {
  activity_shelf_action_aria,
  dashboard_continue_all,
  dashboard_continue_pending,
  dashboard_continue_title,
  dashboard_continue_unfinished,
} from '@/locale/paraglide/messages';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { cn } from '@/lib/utils';
import {
  projectActivityShelfCards,
  type ActivityShelfCard,
  type ActivityShelfThumb,
  type ActivityShelfThumbKind,
} from './activity-shelf';
import { workbenchHasWork } from './today-recommendation-card';

// Re-export pure helpers so existing tests keep their import path.
export {
  ACTIVITY_SHELF_MAX_CARDS,
  dashboardContinueItems,
  isUnfinished,
  needsAttention,
  projectActivityShelfCards,
} from './activity-shelf';

export function DashboardContinueSection() {
  const workbench = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: false,
  });

  // Nothing is known yet — say nothing rather than guess which state this is.
  if (workbench.isLoading) return null;

  if (workbench.isError) {
    return (
      <section
        data-activity-shelf="error"
        data-testid="dashboard-section-continue"
      >
        <h2 className="meiye-type-aux">{dashboard_continue_title()}</h2>
        <p className="meiye-type-aux mt-1" data-testid="continue-pending">
          {dashboard_continue_pending()}
        </p>
      </section>
    );
  }

  if (!workbenchHasWork(workbench.data)) return null;

  const cards = projectActivityShelfCards(workbench.data);

  return (
    <section
      className="space-y-4"
      data-activity-shelf="ready"
      data-shelf-card-count={cards.length}
      data-testid="dashboard-section-continue"
    >
      <h2 className="meiye-type-aux">{dashboard_continue_title()}</h2>
      {/*
        Horizontal shelf with generous whitespace (D6 / prototype). Cards stay
        compact object faces — never a dense vertical link list.
      */}
      <ul
        className="flex gap-4 overflow-x-auto pb-1"
        data-testid="activity-shelf"
      >
        {cards.map((card) => (
          <li key={card.workId} className="shrink-0">
            <ActivityShelfObjectCard card={card} />
          </li>
        ))}
      </ul>
      <Link
        className="meiye-type-aux inline-block underline underline-offset-4"
        to="/dashboard/recent"
      >
        {dashboard_continue_all()}
      </Link>
    </section>
  );
}

function ActivityShelfObjectCard({ card }: { card: ActivityShelfCard }) {
  // Accessible name keeps full intent so recorded journeys can resolve
  // getByRole('link', { name: intent }) and completed cards stay distinct.
  const actionAria = activity_shelf_action_aria({
    action: card.nextActionLabel,
    title: card.intent,
  });

  return (
    <article
      className={cn(
        'meiye-porcelain flex h-full w-[13.5rem] flex-col gap-3 rounded-2xl border border-border/60 p-4',
        'sm:w-[15rem]'
      )}
      data-status={card.status}
      data-testid="activity-shelf-card"
    >
      <ActivityShelfThumbFace thumb={card.thumb} title={card.title} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">
          {card.title}
        </p>
        <p
          className="meiye-type-aux text-muted-foreground"
          data-testid="activity-shelf-status"
          data-status-kind={card.status}
        >
          {card.statusLabel}
          {card.unfinished ? (
            <span className="sr-only" data-testid="continue-item-unfinished">
              {dashboard_continue_unfinished()}
            </span>
          ) : null}
        </p>
      </div>
      <Link
        aria-label={actionAria}
        className="inline-flex min-h-touch-target items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
        data-next-action={card.nextActionLabel}
        data-testid="continue-item"
        params={{ workId: card.workId }}
        to="/dashboard/works/$workId"
      >
        <span aria-hidden="true">{card.nextActionLabel}</span>
        <IconArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
      </Link>
    </article>
  );
}

function ActivityShelfThumbFace({
  thumb,
  title,
}: {
  thumb: ActivityShelfThumb;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const showMedia = Boolean(thumb.src) && !failed;

  if (showMedia && thumb.src && thumb.kind === 'video') {
    return (
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted"
        data-testid="activity-shelf-thumb"
        data-thumb-kind="video"
      >
        {/* Decorative preview — title is already in the card body. */}
        <video
          className="pointer-events-none size-full object-cover"
          muted
          onError={() => setFailed(true)}
          playsInline
          preload="metadata"
          src={thumb.src}
          tabIndex={-1}
        />
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-background/90 p-1">
          <IconVideo aria-hidden="true" className="size-3.5" />
        </span>
      </div>
    );
  }

  if (showMedia && thumb.src && thumb.kind === 'image') {
    return (
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted"
        data-testid="activity-shelf-thumb"
        data-thumb-kind="image"
      >
        <img
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
          src={thumb.src}
        />
      </div>
    );
  }

  return (
    <ActivityShelfIconThumb
      kind={failed ? 'unknown' : thumb.kind}
      title={title}
    />
  );
}

function ActivityShelfIconThumb({
  kind,
  title,
}: {
  kind: ActivityShelfThumbKind;
  title: string;
}) {
  const Icon =
    kind === 'video' ? IconVideo : kind === 'text' ? IconFileText : IconPhoto;

  return (
    <div
      aria-hidden="true"
      className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-muted text-muted-foreground"
      data-testid="activity-shelf-thumb"
      data-thumb-kind={kind}
      title={title}
    >
      <Icon className="size-7 opacity-70" />
    </div>
  );
}
