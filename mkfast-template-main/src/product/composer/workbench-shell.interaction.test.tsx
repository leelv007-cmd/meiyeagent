/**
 * RTL: P1-01 workbench shell dual column + sticky host + resize-reactive width.
 *
 * Proves host-level layout contracts without mounting the full ComposerHome
 * dependency graph (product state, harness, quotes). ComposerHome static + unit
 * gates still own wiring; this suite owns the dual-column overflow and
 * viewport-width flip that unit tests cannot see.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  isWorkbenchComposerSticky,
  isWorkbenchDualColumnEligible,
  resolveWorkbenchWidthMode,
  workbenchShellMaxWidthClass,
} from './workbench-shell';
import {
  WorkbenchCreateLayout,
  WorkbenchInspectorPanel,
  WorkbenchShellRoot,
  WorkbenchStickyComposerHost,
} from './workbench-shell-layout';
import { useWorkbenchViewportWidth } from './use-workbench-viewport-width';

/**
 * react-resizable-panels reads ResizeObserver from defaultView; jsdom lacks it.
 * Same stub as resizable-panels-upgrade.interaction.test.tsx.
 */
beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ShellProbe({
  phase,
  width,
}: {
  phase: 'idle' | 'running' | 'delivered';
  width: number;
}) {
  const dualColumn = isWorkbenchDualColumnEligible(phase, width);
  const stickyComposer = isWorkbenchComposerSticky(phase);
  const widthMode = resolveWorkbenchWidthMode({ dualColumn });
  return (
    <WorkbenchShellRoot
      dualColumn={dualColumn}
      stickyComposer={stickyComposer}
      widthMode={widthMode}
      data-testid="composer-home"
    >
      <WorkbenchCreateLayout
        dualColumn={dualColumn}
        inspector={<WorkbenchInspectorPanel summary="摘要" workId="work-1" />}
        stream={
          <>
            <div data-testid="probe-timeline">timeline</div>
            <WorkbenchStickyComposerHost sticky={stickyComposer}>
              <button data-testid="composer-submit" type="button">
                发送
              </button>
              <p data-testid="composer-quote-line">本次用量已确认</p>
            </WorkbenchStickyComposerHost>
          </>
        }
      />
    </WorkbenchShellRoot>
  );
}

function ViewportWidthProbe({ override }: { override?: number }) {
  const width = useWorkbenchViewportWidth(override);
  const dual = isWorkbenchDualColumnEligible('running', width);
  return (
    <div
      data-dual-column={dual ? 'true' : 'false'}
      data-testid="viewport-width-probe"
      data-width={String(width)}
    />
  );
}

describe('P1-01 workbench shell host layout', () => {
  it('mounts dual column + sticky host under Active at ≥1240 (P1-1 / P1-2)', () => {
    render(<ShellProbe phase="running" width={1240} />);

    const home = screen.getByTestId('composer-home');
    expect(home).toHaveAttribute('data-dual-column', 'true');
    expect(home).toHaveAttribute('data-sticky-composer', 'true');
    expect(home).toHaveAttribute('data-shell-width', 'media');
    expect(home.className).toContain(workbenchShellMaxWidthClass('media'));

    expect(screen.getByTestId('workbench-dual-column')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-stream-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('workbench-result-inspector')
    ).toBeInTheDocument();

    const sticky = screen.getByTestId('workbench-sticky-composer-host');
    expect(sticky).toHaveAttribute('data-sticky', 'true');
    expect(sticky.className).toMatch(/sticky/);
    expect(sticky.className).toMatch(/bg-background\/95/);
    expect(screen.getByTestId('composer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('composer-quote-line')).toBeInTheDocument();
  });

  it('keeps dual-column group + stream panel overflow visible (P1-2 residual)', () => {
    render(<ShellProbe phase="delivered" width={1400} />);

    const dual = screen.getByTestId('workbench-dual-column');
    expect(dual).toHaveAttribute('data-overflow', 'visible');
    expect(dual.className).toMatch(/meiye-workbench-dual-column/);
    expect(dual.className).toMatch(/overflow-visible/);

    // Group does not always forward data-testid; locate via slot + product class.
    const group = dual.querySelector(
      '[data-slot="resizable-panel-group"].meiye-workbench-dual-column-group'
    );
    expect(group).not.toBeNull();
    expect((group as HTMLElement).className).toMatch(
      /meiye-workbench-dual-column-group/
    );
    // User style prop after library default — Group must not keep overflow:hidden
    // as the sticky containing block.
    expect((group as HTMLElement).style.overflow).toBe('visible');

    const streamPanel = screen.getByTestId('workbench-stream-panel');
    expect(streamPanel).toHaveAttribute('data-overflow', 'visible');
    expect(streamPanel.className).toMatch(/meiye-workbench-stream-panel/);
    // Parent Panel is in the overflow-visible chain via CSS :has().
    expect(streamPanel.closest('[data-slot="resizable-panel"]')).not.toBeNull();
    // Sticky host remains a descendant of the dual column (still left column).
    expect(
      dual.querySelector('[data-testid="workbench-sticky-composer-host"]')
    ).not.toBeNull();
  });

  it('Idle at wide viewport stays single-column conversation width (P1-7)', () => {
    render(<ShellProbe phase="idle" width={1600} />);
    const home = screen.getByTestId('composer-home');
    expect(home).toHaveAttribute('data-dual-column', 'false');
    expect(home).toHaveAttribute('data-sticky-composer', 'false');
    expect(home).toHaveAttribute('data-shell-width', 'conversation');
    expect(home.className).toContain(
      workbenchShellMaxWidthClass('conversation')
    );
    expect(screen.queryByTestId('workbench-dual-column')).toBeNull();
    expect(screen.getByTestId('workbench-stream-cluster')).toBeInTheDocument();
    expect(
      screen.getByTestId('workbench-sticky-composer-host')
    ).toHaveAttribute('data-sticky', 'false');
  });

  it('Active below 1240 does not mount dual column (P1-1 negative)', () => {
    render(<ShellProbe phase="running" width={1239} />);
    expect(screen.getByTestId('composer-home')).toHaveAttribute(
      'data-dual-column',
      'false'
    );
    expect(screen.queryByTestId('workbench-dual-column')).toBeNull();
    // Sticky still engages in Active even without dual column (P1-2).
    expect(
      screen.getByTestId('workbench-sticky-composer-host')
    ).toHaveAttribute('data-sticky', 'true');
  });
});

describe('useWorkbenchViewportWidth (P1-1 live flip)', () => {
  it('respects the test override without listening to window width', () => {
    render(<ViewportWidthProbe override={900} />);
    const probe = screen.getByTestId('viewport-width-probe');
    expect(probe).toHaveAttribute('data-width', '900');
    expect(probe).toHaveAttribute('data-dual-column', 'false');
  });

  it('flips dual-column eligibility when the viewport crosses 1240', () => {
    let width = 1000;
    const listeners = new Set<() => void>();
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: width >= 1240 && query.includes('1240'),
          media: query,
          addEventListener: (_: string, cb: EventListener) => {
            listeners.add(cb as () => void);
          },
          removeEventListener: (_: string, cb: EventListener) => {
            listeners.delete(cb as () => void);
          },
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
          onchange: null,
        }) as unknown as MediaQueryList
    );

    render(<ViewportWidthProbe />);
    expect(screen.getByTestId('viewport-width-probe')).toHaveAttribute(
      'data-dual-column',
      'false'
    );

    act(() => {
      width = 1300;
      vi.stubGlobal('innerWidth', width);
      for (const cb of listeners) cb();
    });

    expect(screen.getByTestId('viewport-width-probe')).toHaveAttribute(
      'data-width',
      '1300'
    );
    expect(screen.getByTestId('viewport-width-probe')).toHaveAttribute(
      'data-dual-column',
      'true'
    );
  });
});
