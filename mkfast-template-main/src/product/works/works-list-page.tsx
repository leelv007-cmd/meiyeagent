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
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';

import { WorksMediaGallery } from './works-media-gallery';
import {
  WORKS_DESCRIPTION,
  WORKS_TITLE,
  useWorksProjection,
} from './works-queries';
import {
  WORK_OUTPUT_SHAPE_LABELS,
  WORK_OUTPUT_SHAPE_ORDER,
  worksListItems,
  worksShapeCounts,
  type WorkListItem,
  type WorkOutputShape,
} from './works-projection';

type ShapeFilter = WorkOutputShape | 'all';

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
              {WORK_OUTPUT_SHAPE_LABELS[item.outputShape]}
            </span>
            <span className="text-muted-foreground text-xs">
              {item.statusLabel}
            </span>
            {item.revision === null ? null : (
              <span
                className="text-muted-foreground ml-auto text-xs"
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
            <p
              className={`text-muted-foreground text-sm ${
                item.outputShape === 'copy' ? 'line-clamp-6' : 'line-clamp-2'
              }`}
            >
              {item.excerpt}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function WorksListPage() {
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
            <h1 className="meiye-type-title" data-testid="works-ambient-title">
              {WORKS_TITLE}
            </h1>
            <p className="meiye-type-aux mt-1" data-testid="works-ambient-aux">
              {WORKS_DESCRIPTION}
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
                aria-label="内容类型"
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
            </div>

            <label
              className="meiye-glass-piece flex items-center gap-2 rounded-full px-3 py-2 sm:w-64"
              htmlFor="works-search"
            >
              <IconSearch aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only">搜索内容</span>
              <input
                className="w-full bg-transparent text-sm outline-none"
                data-testid="works-search"
                id="works-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜内容标题或正文"
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
              正在整理你的内容…
            </p>
          ) : failed ? (
            // A failed read must never read as 「你还没有内容」.
            <p
              className="meiye-porcelain rounded-2xl p-4 text-sm"
              data-testid="works-unavailable"
              role="alert"
            >
              内容暂时没能取回来，刷新一下再看。
            </p>
          ) : items.length === 0 ? (
            /*
              OI-73. 一级导航「内容」 lands here, so this empty state is the
              first screen a cold-start merchant sees — and its three lines were
              floating straight on the shell's 门店橱窗 photo. Both faults were
              measured, not guessed: the title takes --foreground (ink) and came
              back 2.27:1 on the photo (light/desktop, drifting with whatever
              the image is bright or dark under), while the description and the
              call to action take --muted — the vendored empty-state.css uses it
              as a foreground, but inside .meiye-product-shell that token is the
              muted *background* (--tint-hover, 4% ink / 6% white), measuring
              1.02–1.18:1, i.e. the whole line is invisible. That second trap is
              the one T32 already wrote up for the Segment above.

              The fix stays inside DESIGN.md's existing vocabulary rather than
              inventing a new one: the empty state sits on a porcelain base
              (实体内容区一律白瓷, and the Don't list is explicit that text is
              never laid straight on media without a scrim), matching its
              works-unavailable sibling; --muted maps back to --ink-60, the
              lowest body step. --default is deliberately left alone — the
              vendored CSS only uses it as the icon medallion's background, the
              token bridge already gives it a background value, and pointing it
              at a foreground would turn that medallion into a dark blob.
              Per-site stops here: the shared-layer --muted fix is OI-48.
            */
            <EmptyState
              className="meiye-porcelain rounded-2xl"
              data-testid="works-empty"
              style={{ '--muted': 'var(--ink-60)' } as CSSProperties}
            >
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <IconPhoto aria-hidden="true" />
                </EmptyState.Media>
                <EmptyState.Title data-testid="works-empty-title">
                  还没有内容
                </EmptyState.Title>
                <EmptyState.Description data-testid="works-empty-description">
                  去创作一条内容，做出来的成品会自动进到这里。
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <a
                  className="meiye-glass-piece inline-flex rounded-full px-4 py-2 text-sm"
                  data-testid="works-empty-cta"
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
