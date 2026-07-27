/**
 * 作品列表 — T32 / #226.
 *
 * One surface for all four output shapes (D-118): 文案 / 图片 / 图文 / 视频 all
 * land here, filed by what was delivered rather than by which compiler ran.
 * Reads the canonical ContentPackage projection plus the canonical canvas-work
 * projection — no named-legacy projection, no second history ledger (ADR-0011).
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { IconPhoto, IconSearch } from '@tabler/icons-react';

import { EmptyState, Segment } from '@/components/heroui-pro';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { getLocale } from '@/lib/locale';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';

import { translateWorksSystemText, worksCopy } from './works-copy';
import { WorksMediaGallery } from './works-media-gallery';
import { useWorksProjection } from './works-queries';
import {
  WORK_OUTPUT_SHAPE_ORDER,
  worksListItems,
  worksShapeCounts,
  type WorkListItem,
  type WorkOutputShape,
} from './works-projection';

type ShapeFilter = WorkOutputShape | 'all';

function WorkCard({ item }: { item: WorkListItem }) {
  const locale = getLocale();
  const copy = worksCopy(locale);
  return (
    <li>
      <Link
        className="meiye-porcelain group flex h-full flex-col overflow-hidden rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
        data-output-shape={item.outputShape}
        data-testid="works-card"
        data-work-id={item.detailId}
        params={{ workId: item.detailId }}
        to="/dashboard/works/$workId"
      >
        {item.media.length > 0 ? (
          <WorksMediaGallery cover media={item.media} />
        ) : item.outputShape === 'copy' ? null : (
          // 文案 delivered no media on purpose; an empty photo frame there would
          // read as a picture that failed to load. Every other shape has one.
          <div
            aria-hidden="true"
            className="bg-muted text-muted-foreground flex aspect-5/4 items-center justify-center"
          >
            <IconPhoto className="size-10 opacity-40" />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span
              className="meiye-glass-piece rounded-full px-2.5 py-0.5 text-xs"
              data-testid="works-card-shape"
            >
              {copy.shapes[item.outputShape]}
            </span>
            <span className="text-muted-foreground text-xs">
              {translateWorksSystemText(locale, item.statusLabel)}
            </span>
            {item.revision === null ? null : (
              <span
                className="text-muted-foreground ml-auto text-xs"
                data-revision={item.revision}
              >
                {copy.revision(item.revision)}
              </span>
            )}
          </div>
          <h3
            className="meiye-type-body line-clamp-2 font-semibold"
            data-i18n-pass-through="content-title"
          >
            {item.title}
          </h3>
          {item.excerpt ? (
            <p
              className={`text-muted-foreground text-sm ${
                item.outputShape === 'copy' ? 'line-clamp-6' : 'line-clamp-2'
              }`}
              data-i18n-pass-through="content-excerpt"
            >
              {translateWorksSystemText(locale, item.excerpt)}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function WorksListPage() {
  const copy = worksCopy(getLocale());
  const { failed, loading, source } = useWorksProjection();
  const [shape, setShape] = useState<ShapeFilter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => worksShapeCounts(source), [source]);
  const items = useMemo(
    () => worksListItems({ ...source, query, shape }),
    [query, shape, source]
  );

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: copy.dashboard, isCurrentPage: false },
          { label: copy.title, isCurrentPage: true },
        ]}
      />
      <div
        className="meiye-heroui-glass @container/main flex flex-1 flex-col gap-2"
        data-testid="works-surface"
      >
        <div className="flex flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-6 lg:py-6">
          <div className="meiye-ambient-copy">
            <h1 className="meiye-type-title" data-testid="works-ambient-title">
              {copy.title}
            </h1>
            <p className="meiye-type-aux mt-1" data-testid="works-ambient-aux">
              {copy.description}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/*
              The vendored Segment paints its unselected labels with
              `color: var(--muted)`. HeroUI means `--muted` as a foreground, but
              inside .meiye-product-shell that token is the muted *background*
              (--tint-hover, 4% ink) and the labels all but disappear — the same
              trap that made this surface's own text unreadable, arriving this
              time through a dropped-in component. D-130 is explicit that a
              component library's output is held to the contrast rule too, so
              the token is mapped back onto the ink gradient here, over a glass
              base per 玻璃有边法则. It takes --ink-90, not the lowest body step:
              the piece-tier glass is 8% white in dark, so the ambient photo
              still carries the backdrop and --ink-60 measured 4.14:1 there.
              Selection stays legible through the indicator pill. Per-site on
              purpose: the shared-layer fix is OI-48.
            */}
            <div
              className="meiye-glass-piece inline-flex rounded-full p-0.5"
              style={{ '--muted': 'var(--ink-90)' } as CSSProperties}
            >
              <Segment
                aria-label={copy.shapeFilter}
                data-testid="works-shape-filter"
                onSelectionChange={(key) => setShape(key as ShapeFilter)}
                selectedKey={shape}
              >
                <Segment.Item data-testid="works-shape-all" id="all">
                  {copy.all}
                </Segment.Item>
                {WORK_OUTPUT_SHAPE_ORDER.map((candidate) => (
                  <Segment.Item
                    data-testid={`works-shape-${candidate}`}
                    id={candidate}
                    key={candidate}
                  >
                    {copy.shapes[candidate]}
                    {counts[candidate] > 0 ? ` ${counts[candidate]}` : ''}
                  </Segment.Item>
                ))}
              </Segment>
            </div>

            <label
              className="meiye-glass-piece flex items-center gap-2 rounded-full px-3 py-2 sm:w-64"
              htmlFor="works-search"
            >
              <IconSearch aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                className="w-full bg-transparent text-sm outline-none"
                data-testid="works-search"
                id="works-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                type="search"
                value={query}
              />
            </label>
          </div>

          {loading ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="works-loading"
            >
              {copy.loading}
            </p>
          ) : failed ? (
            // A failed read must never read as 「你还没有内容」.
            <p
              className="meiye-porcelain rounded-2xl p-4 text-sm"
              data-testid="works-unavailable"
              role="alert"
            >
              {copy.unavailable}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              className="meiye-porcelain rounded-2xl"
              data-testid="works-empty"
            >
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <IconPhoto aria-hidden="true" />
                </EmptyState.Media>
                <EmptyState.Title data-testid="works-empty-title">
                  {copy.emptyTitle}
                </EmptyState.Title>
                <EmptyState.Description data-testid="works-empty-description">
                  {copy.emptyDescription}
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <a
                  className="meiye-glass-piece inline-flex rounded-full px-4 py-2 text-sm"
                  data-testid="works-empty-cta"
                  href={getPathWithLocale('/dashboard')}
                >
                  {copy.emptyAction}
                </a>
              </EmptyState.Content>
            </EmptyState>
          ) : (
            <ol
              className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3')}
              data-testid="works-list"
            >
              {items.map((item) => (
                <WorkCard item={item} key={`${item.kind}:${item.detailId}`} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
