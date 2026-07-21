/**
 * Home tools strip + Pro Studio banner (C3 / #97, D-077 / D-092).
 *
 * Desktop ≤3 / mobile ≤2 ordinary tools.
 * Pro Studio full-width banner → /pro-studio canonical gate only.
 */

import { cn } from '@/lib/utils';

import {
  assertProStudioCanonicalHref,
  openComposerTool,
  projectComposerToolsStrip,
  type ComposerToolsStripInput,
  type ComposerToolsStripView,
  type ComposerToolChipView,
  type ProStudioBannerView,
} from './composer-tools';
import type { ToolHandoff } from './tool-handoff';

export type ComposerToolsStripProps = ComposerToolsStripInput & {
  className?: string;
  /** Optional handoff context from current composer draft. */
  handoffContext?: Omit<ToolHandoff, 'toolEntryId'>;
  onOpenTool?: (href: string, toolEntryId: string) => void;
  onViewAll?: (href: string) => void;
  /** Controlled view override (tests). */
  view?: ComposerToolsStripView;
};

export function ComposerToolsStrip({
  className,
  handoffContext,
  onOpenTool,
  onViewAll,
  view: viewOverride,
  ...input
}: ComposerToolsStripProps) {
  const view = viewOverride ?? projectComposerToolsStrip(input);

  const handleOpen = (toolEntryId: string) => {
    const result = openComposerTool(toolEntryId, handoffContext ?? {});
    if (toolEntryId === 'tool.pro_studio') {
      assertProStudioCanonicalHref(result.href);
    }
    if (onOpenTool) {
      onOpenTool(result.href, toolEntryId);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(result.href);
    }
  };

  return (
    <section
      data-testid="composer-tools-strip"
      data-viewport={view.viewport}
      data-ordinary-cap={view.cap}
      data-ordinary-count={view.ordinary.length}
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">创作工具</h2>
        <a
          data-testid="composer-tools-view-all"
          href={view.viewAllHref}
          className="min-h-12 text-xs font-medium text-primary"
          onClick={(event) => {
            if (!onViewAll) return;
            event.preventDefault();
            onViewAll(view.viewAllHref);
          }}
        >
          {view.viewAllLabel}
        </a>
      </div>

      {view.ordinary.length > 0 ? (
        <ul
          data-testid="composer-ordinary-tools"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {view.ordinary.map((tool) => (
            <li key={tool.id}>
              <OrdinaryToolButton
                tool={tool}
                onOpen={() => handleOpen(tool.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {view.proStudio ? (
        <ProStudioBanner
          banner={view.proStudio}
          onOpen={() => handleOpen(view.proStudio!.id)}
        />
      ) : null}
    </section>
  );
}

function OrdinaryToolButton({
  tool,
  onOpen,
}: {
  tool: ComposerToolChipView;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`composer-tool-chip-${tool.id}`}
      data-locked={tool.locked ? 'true' : 'false'}
      disabled={tool.locked}
      aria-label={
        tool.locked
          ? `${tool.label}。${tool.lockReason ?? '未解锁'}`
          : `${tool.label}。${tool.summary}`
      }
      className={cn(
        'flex min-h-12 w-full flex-col items-start gap-0.5 rounded-2xl border border-input bg-background p-3 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tool.locked ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/40'
      )}
      onClick={() => {
        if (!tool.locked) onOpen();
      }}
    >
      <span className="text-sm font-semibold text-foreground">
        {tool.label}
      </span>
      <span className="text-xs leading-5 text-muted-foreground">
        {tool.locked ? (tool.lockReason ?? '未解锁') : tool.summary}
      </span>
    </button>
  );
}

function ProStudioBanner({
  banner,
  onOpen,
}: {
  banner: ProStudioBannerView;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="composer-pro-studio-banner"
      data-status={banner.status}
      data-href={banner.href}
      aria-label={`${banner.label}。${banner.summary}。${banner.ctaLabel}`}
      className={cn(
        'flex min-h-12 w-full flex-col items-start gap-1 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'hover:bg-primary/10'
      )}
      onClick={onOpen}
    >
      <span className="text-sm font-semibold text-foreground">
        {banner.label}
      </span>
      <span className="text-xs leading-5 text-muted-foreground">
        {banner.status === 'locked'
          ? (banner.lockReason ?? banner.summary)
          : banner.summary}
      </span>
      <span className="mt-1 text-xs font-medium text-primary">
        {banner.ctaLabel}
      </span>
    </button>
  );
}
