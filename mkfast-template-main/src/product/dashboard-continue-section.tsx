/**
 * 段③「继续上次工作」— D-164① / D-126.
 *
 * Unfinished work comes first: a run the merchant abandoned halfway is the one
 * thing on this page she cannot reconstruct from memory, and burying it under
 * finished pieces is how it gets abandoned for good.
 *
 * The section disappears only on a genuinely empty workspace, where 段① is
 * already showing the sample shops and a second empty panel would say nothing.
 * Every other state renders — including the one where the projection failed to
 * load, which says so rather than going quiet. A shop that has done work and a
 * request that did not come back look identical when both render nothing, and
 * only one of those is the truth the merchant can act on.
 *
 * Reuses the workbench projection the recommendation card already reads, on the
 * same query key, so the section costs no extra request.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  CreativeWork,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';

import {
  dashboard_continue_all,
  dashboard_continue_pending,
  dashboard_continue_title,
  dashboard_continue_unfinished,
} from '@/locale/paraglide/messages';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { workbenchHasWork } from './today-recommendation-card';

const UNFINISHED: ReadonlySet<CreativeWork['status']> = new Set([
  'draft',
  'running',
]);

const MAX_ITEMS = 3;

export function isUnfinished(work: CreativeWork) {
  return UNFINISHED.has(work.status);
}

/**
 * Unfinished first, then the rest in projection order. Capped so the section
 * stays a nudge rather than becoming the content list it links to.
 */
export function dashboardContinueItems(
  workbench: CreativeWorkbenchProjection | undefined
): CreativeWork[] {
  if (!workbench) return [];
  const unfinished = workbench.works.filter(isUnfinished);
  const rest = workbench.works.filter((work) => !isUnfinished(work));
  return [...unfinished, ...rest].slice(0, MAX_ITEMS);
}

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
      <section data-testid="dashboard-section-continue">
        <h2 className="meiye-type-aux">{dashboard_continue_title()}</h2>
        <p className="meiye-type-aux mt-1" data-testid="continue-pending">
          {dashboard_continue_pending()}
        </p>
      </section>
    );
  }

  if (!workbenchHasWork(workbench.data)) return null;

  const items = dashboardContinueItems(workbench.data);

  return (
    <section data-testid="dashboard-section-continue">
      <h2 className="meiye-type-aux">{dashboard_continue_title()}</h2>
      <ul className="mt-2 space-y-2">
        {items.map((work) => (
          <li key={work.id}>
            <Link
              className="flex items-center gap-2 text-sm underline underline-offset-4"
              data-testid="continue-item"
              params={{ workId: work.id }}
              to="/dashboard/works/$workId"
            >
              <span className="truncate">{work.intent}</span>
              {isUnfinished(work) ? (
                <span
                  className="meiye-type-aux shrink-0"
                  data-testid="continue-item-unfinished"
                >
                  {dashboard_continue_unfinished()}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        className="meiye-type-aux mt-2 inline-block underline underline-offset-4"
        to="/dashboard/recent"
      >
        {dashboard_continue_all()}
      </Link>
    </section>
  );
}
