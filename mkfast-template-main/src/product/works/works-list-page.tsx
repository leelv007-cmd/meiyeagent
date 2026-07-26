/**
 * 作品列表 — T32 / #226.
 *
 * One surface for all four output shapes (D-118): 文案 / 图片 / 图文 / 视频 all
 * land here, filed by what was delivered rather than by which compiler ran.
 * Reads the canonical ContentPackage projection plus the canonical canvas-work
 * projection — no named-legacy projection, no second history ledger (ADR-0011).
 */

import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { IconPhoto, IconSearch } from '@tabler/icons-react';
import type { PublicContentPackage } from '@meiye/contracts';

import { EmptyState, Segment } from '@/components/heroui-pro';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import type { RawCanonicalHistory } from '@/product/canonical-history-model';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

import { WorksMediaGallery } from './works-media-gallery';
import {
  WORK_OUTPUT_SHAPE_LABELS,
  WORK_OUTPUT_SHAPE_ORDER,
  worksListItems,
  worksShapeCounts,
  type WorkListItem,
  type WorkOutputShape,
} from './works-projection';

export const WORKS_TITLE = '作品';
export const WORKS_DESCRIPTION = '你做过的文案、图片、图文和视频都在这里。';

type ShapeFilter = WorkOutputShape | 'all';

export function useWorksProjection() {
  const contentPackages = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
  });
  const history = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  return { contentPackages, history };
}

function WorkCard({ item }: { item: WorkListItem }) {
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
        ) : (
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
              {WORK_OUTPUT_SHAPE_LABELS[item.outputShape]}
            </span>
            <span className="text-muted text-xs">{item.statusLabel}</span>
            {item.revision === null ? null : (
              <span
                className="text-muted ml-auto text-xs"
                data-revision={item.revision}
              >
                第 {item.revision} 版
              </span>
            )}
          </div>
          <h3 className="meiye-type-body line-clamp-2 font-semibold">
            {item.title}
          </h3>
          {item.excerpt ? (
            <p className="text-muted line-clamp-2 text-sm">{item.excerpt}</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function WorksListPage() {
  const { contentPackages, history } = useWorksProjection();
  const [shape, setShape] = useState<ShapeFilter>('all');
  const [query, setQuery] = useState('');

  const source = useMemo(
    () => ({
      canvasWorks: history.data?.canvasWorks ?? [],
      contentPackages: contentPackages.data ?? [],
    }),
    [contentPackages.data, history.data]
  );
  const counts = useMemo(() => worksShapeCounts(source), [source]);
  const items = useMemo(
    () => worksListItems({ ...source, query, shape }),
    [query, shape, source]
  );

  const loading = contentPackages.isLoading || history.isLoading;

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: '工作台', isCurrentPage: false },
          { label: WORKS_TITLE, isCurrentPage: true },
        ]}
      />
      <div
        className="meiye-heroui-glass @container/main flex flex-1 flex-col gap-2"
        data-testid="works-surface"
      >
        <div className="flex flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-6 lg:py-6">
          <div className="meiye-ambient-copy">
            <h1 className="meiye-type-title">{WORKS_TITLE}</h1>
            <p className="meiye-type-aux mt-1">{WORKS_DESCRIPTION}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Segment
              aria-label="作品类型"
              data-testid="works-shape-filter"
              onSelectionChange={(key) => setShape(key as ShapeFilter)}
              selectedKey={shape}
            >
              <Segment.Item data-testid="works-shape-all" id="all">
                全部
              </Segment.Item>
              {WORK_OUTPUT_SHAPE_ORDER.map((candidate) => (
                <Segment.Item
                  data-testid={`works-shape-${candidate}`}
                  id={candidate}
                  key={candidate}
                >
                  {WORK_OUTPUT_SHAPE_LABELS[candidate]}
                  {counts[candidate] > 0 ? ` ${counts[candidate]}` : ''}
                </Segment.Item>
              ))}
            </Segment>

            <label
              className="meiye-glass-piece flex items-center gap-2 rounded-full px-3 py-2 sm:w-64"
              htmlFor="works-search"
            >
              <IconSearch aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only">搜索作品</span>
              <input
                className="w-full bg-transparent text-sm outline-none"
                data-testid="works-search"
                id="works-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜作品标题或正文"
                type="search"
                value={query}
              />
            </label>
          </div>

          {loading ? (
            <p className="text-muted text-sm" data-testid="works-loading">
              正在整理你的作品…
            </p>
          ) : items.length === 0 ? (
            <EmptyState data-testid="works-empty">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <IconPhoto aria-hidden="true" />
                </EmptyState.Media>
                <EmptyState.Title>还没有作品</EmptyState.Title>
                <EmptyState.Description>
                  去创作一条内容，做出来的成品会自动进到这里。
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <a
                  className="meiye-glass-piece inline-flex rounded-full px-4 py-2 text-sm"
                  href={getPathWithLocale('/dashboard')}
                >
                  去创作
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
