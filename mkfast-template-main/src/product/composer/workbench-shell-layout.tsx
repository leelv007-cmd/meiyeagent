/**
 * P1-01 workbench shell layout primitives (#313).
 *
 * - Desktop ≥1240 Active/Delivered: dual column via react-resizable-panels
 *   (event stream | Result Inspector). Home is never a draggable three-column.
 * - Mobile: right column becomes a bottom sheet (Vaul drawer).
 * - Sticky Composer host: Active morph bottom clearance for mobile-nav.
 *
 * Zero new agent runtime. Panels are presentation only.
 */

import { useId } from 'react';

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

import {
  workbenchComposerStickyHostClass,
  workbenchShellMaxWidthClass,
  type WorkbenchWidthMode,
} from './workbench-shell';

export type WorkbenchShellRootProps = {
  widthMode: WorkbenchWidthMode;
  dualColumn: boolean;
  stickyComposer: boolean;
  className?: string;
  children: React.ReactNode;
  'data-testid'?: string;
  'data-shelf-collapsed'?: string;
  'data-viewport'?: string;
};

/**
 * Outer workbench shell. Applies the 800/1240 width contract and layout
 * markers for dual-column / sticky Composer (P1-1 / P1-2 / P1-7).
 */
export function WorkbenchShellRoot({
  widthMode,
  dualColumn,
  stickyComposer,
  className,
  children,
  'data-testid': testId = 'composer-home',
  'data-shelf-collapsed': shelfCollapsed,
  'data-viewport': viewport,
}: WorkbenchShellRootProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6',
        workbenchShellMaxWidthClass(widthMode),
        className
      )}
      data-dual-column={dualColumn ? 'true' : 'false'}
      data-shell-width={widthMode}
      data-sticky-composer={stickyComposer ? 'true' : 'false'}
      data-testid={testId}
      data-shelf-collapsed={shelfCollapsed}
      data-viewport={viewport}
    >
      {children}
    </div>
  );
}

export type WorkbenchDualColumnProps = {
  /** Left: document timeline + sticky Composer cluster. */
  stream: React.ReactNode;
  /** Right: Result Inspector / context. */
  inspector: React.ReactNode;
  className?: string;
};

/**
 * Desktop dual column. Only mount when `isWorkbenchDualColumnEligible` is true.
 * react-resizable-panels is the product path (F11 转正); no three-column home.
 *
 * Sticky Composer (P1-2) must stay page-relative. The library paints
 * `overflow:hidden` on the Group and `overflow:auto` on Panel nodes — either
 * becomes a sticky containing block. Product CSS (heroui-glass.css) forces
 * overflow:visible !important on the dual-column group + stream panel chain;
 * the inspector may still scroll independently.
 */
export function WorkbenchDualColumn({
  stream,
  inspector,
  className,
}: WorkbenchDualColumnProps) {
  return (
    <div
      className={cn(
        'meiye-workbench-dual-column w-full overflow-visible',
        className
      )}
      data-overflow="visible"
      data-testid="workbench-dual-column"
    >
      <ResizablePanelGroup
        className="meiye-workbench-dual-column-group w-full items-start overflow-visible"
        orientation="horizontal"
        // User style is applied after the library default so Group does not
        // keep overflow:hidden as the sticky containing block (P1-2 residual).
        style={{ overflow: 'visible' }}
      >
        <ResizablePanel
          className="meiye-workbench-stream-panel min-w-0"
          defaultSize={62}
          minSize={40}
        >
          <div
            className="meiye-workbench-stream-panel flex min-w-0 flex-col gap-6 overflow-visible pr-2"
            data-overflow="visible"
            data-testid="workbench-stream-panel"
          >
            {stream}
          </div>
        </ResizablePanel>
        <ResizableHandle
          className="bg-border"
          data-testid="workbench-column-handle"
          withHandle
        />
        <ResizablePanel className="min-w-0" defaultSize={38} minSize={24}>
          <div
            className="flex min-h-0 min-w-0 flex-col pl-2"
            data-testid="workbench-inspector-panel"
          >
            {inspector}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export type WorkbenchCreateLayoutProps = {
  dualColumn: boolean;
  stream: React.ReactNode;
  inspector: React.ReactNode;
};

/**
 * Single mount point for the create axis: dual column when eligible, else the
 * stream alone (mobile / Idle / narrow desktop).
 */
export function WorkbenchCreateLayout({
  dualColumn,
  stream,
  inspector,
}: WorkbenchCreateLayoutProps) {
  if (!dualColumn) {
    return (
      <div
        className="flex flex-col gap-6"
        data-testid="workbench-stream-cluster"
      >
        {stream}
      </div>
    );
  }
  return <WorkbenchDualColumn inspector={inspector} stream={stream} />;
}

export type WorkbenchStickyComposerHostProps = {
  sticky: boolean;
  children: React.ReactNode;
  className?: string;
};

/** Sticky morph host for ComposerPromptBar (and adjacent quote/cost lines). */
export function WorkbenchStickyComposerHost({
  sticky,
  children,
  className,
}: WorkbenchStickyComposerHostProps) {
  return (
    <div
      className={cn(workbenchComposerStickyHostClass(sticky), className)}
      data-sticky={sticky ? 'true' : 'false'}
      data-testid="workbench-sticky-composer-host"
    >
      {children}
    </div>
  );
}

export type WorkbenchInspectorPanelProps = {
  /** Optional delivery summary when a run has finished. */
  title?: string;
  summary?: string | null;
  workId?: string | null;
  onOpenFullWorkspace?: () => void;
  className?: string;
  emptyLabel?: string;
};

/**
 * Minimal Result Inspector / context face for P1-01.
 * Full object workspace remains Result Center; this is the dual-column right
 * rail + mobile sheet content.
 */
export function WorkbenchInspectorPanel({
  title = '上下文',
  summary,
  workId,
  onOpenFullWorkspace,
  className,
  emptyLabel = '成品与依据会显示在这里',
}: WorkbenchInspectorPanelProps) {
  return (
    <aside
      aria-label={title}
      className={cn(
        'meiye-porcelain flex h-full min-h-[12rem] flex-col gap-3 rounded-2xl p-4',
        className
      )}
      data-testid="workbench-result-inspector"
      data-has-work={workId ? 'true' : 'false'}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-medium">{title}</h2>
        {workId && onOpenFullWorkspace ? (
          <button
            className="text-muted hover:text-foreground text-xs font-medium underline-offset-4 hover:underline"
            data-testid="workbench-inspector-open-full"
            onClick={onOpenFullWorkspace}
            type="button"
          >
            打开对象工作区
          </button>
        ) : null}
      </header>
      {summary ? (
        <p
          className="text-foreground text-sm leading-relaxed"
          data-testid="workbench-inspector-summary"
        >
          {summary}
        </p>
      ) : (
        <p
          className="text-muted text-sm"
          data-testid="workbench-inspector-empty"
        >
          {emptyLabel}
        </p>
      )}
      {workId ? (
        <p
          className="text-muted mt-auto text-xs"
          data-testid="workbench-inspector-work-id"
        >
          {workId}
        </p>
      ) : null}
    </aside>
  );
}

export type WorkbenchInspectorSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
};

/**
 * Mobile equivalent of the dual-column right rail (P1-1 mobile path).
 * Uses Vaul drawer — already a product dependency; no second sheet stack.
 */
export function WorkbenchInspectorSheet({
  open,
  onOpenChange,
  children,
  title = '上下文',
}: WorkbenchInspectorSheetProps) {
  const titleId = useId();
  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent
        className="meiye-product-shell max-h-[85vh]"
        data-testid="workbench-inspector-sheet"
      >
        <DrawerHeader className="flex flex-row items-center justify-between gap-2">
          <DrawerTitle id={titleId}>{title}</DrawerTitle>
          <DrawerClose
            className="min-h-12 min-w-12 rounded-lg px-3 text-sm text-muted-foreground"
            data-testid="workbench-inspector-sheet-close"
          >
            关闭
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
