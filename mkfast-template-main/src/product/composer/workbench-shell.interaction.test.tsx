/**
 * RTL: P1-01 workbench shell dual column + sticky host + resize-reactive width.
 *
 * Proves host-level layout contracts without mounting the full ComposerHome
 * dependency graph (product state, harness, quotes). ComposerHome static + unit
 * gates still own wiring; this suite owns the dual-column overflow and
 * viewport-width flip that unit tests cannot see.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ComposerSessionPhase } from './composer-session';
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
  WorkbenchStickyComposerClearance,
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
  phase: ComposerSessionPhase;
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
            <WorkbenchStickyComposerClearance sticky={stickyComposer} />
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

describe('L3-5 Result Inspector phase faces', () => {
  it('shows delivered summary card + primary workspace gate', () => {
    render(
      <WorkbenchInspectorPanel
        onOpenFullWorkspace={() => {}}
        phase="delivered"
        platformLabel="小红书"
        summary="周末预约文案已就绪"
        workId="work-1"
      />
    );
    const panel = screen.getByTestId('workbench-result-inspector');
    expect(panel).toHaveAttribute('data-inspector-phase', 'delivered');
    expect(screen.getByTestId('workbench-inspector-delivered')).toBeTruthy();
    expect(screen.getByTestId('workbench-inspector-summary')).toHaveTextContent(
      '周末预约文案已就绪'
    );
    expect(
      screen.getByTestId('workbench-inspector-platform')
    ).toHaveTextContent('小红书');
    expect(
      screen.getByTestId('workbench-inspector-open-full')
    ).toHaveTextContent('进入对象工作区');
  });

  it('shows running stage + progress', () => {
    render(
      <WorkbenchInspectorPanel
        phase="running"
        progressLabel="创作进行中"
        stageLabel="正在读你的门店资料"
      />
    );
    expect(screen.getByTestId('workbench-inspector-running')).toBeTruthy();
    expect(screen.getByTestId('workbench-inspector-stage')).toHaveTextContent(
      '正在读你的门店资料'
    );
    expect(
      screen.getByTestId('workbench-inspector-progress')
    ).toHaveTextContent('创作进行中');
  });

  it('keeps honest empty idle state', () => {
    render(<WorkbenchInspectorPanel phase="idle" />);
    expect(screen.getByTestId('workbench-inspector-empty')).toBeTruthy();
    expect(screen.queryByTestId('workbench-inspector-delivered')).toBeNull();
    expect(screen.queryByTestId('workbench-inspector-running')).toBeNull();
  });

  it('failed session shows a terminal face, not 正在提交', () => {
    render(<WorkbenchInspectorPanel phase="failed" progressLabel="正在提交" />);
    const panel = screen.getByTestId('workbench-result-inspector');
    expect(panel).toHaveAttribute('data-inspector-phase', 'failed');
    expect(screen.getByTestId('workbench-inspector-failed')).toBeTruthy();
    expect(screen.queryByTestId('workbench-inspector-running')).toBeNull();
    expect(panel).not.toHaveTextContent('正在提交');
    expect(panel).not.toHaveTextContent('进行中');
  });
});

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
    // Spacer above sticky so delivery cards can scroll clear of the scrim.
    expect(
      screen.getByTestId('workbench-sticky-composer-clearance')
    ).toBeInTheDocument();
    expect(screen.getByTestId('composer-submit')).toBeInTheDocument();
    expect(screen.getByTestId('composer-quote-line')).toBeInTheDocument();
  });

  it('Delivered keeps dual column but unsticks Composer so 成品卡 is clickable', () => {
    render(<ShellProbe phase="delivered" width={1240} />);
    const home = screen.getByTestId('composer-home');
    expect(home).toHaveAttribute('data-dual-column', 'true');
    expect(home).toHaveAttribute('data-sticky-composer', 'false');
    expect(
      screen.getByTestId('workbench-sticky-composer-host')
    ).toHaveAttribute('data-sticky', 'false');
    expect(
      screen.queryByTestId('workbench-sticky-composer-clearance')
    ).toBeNull();
  });

  it('keeps the Composer sticky while Active waits for a merchant answer', () => {
    render(<ShellProbe phase="awaiting_answer" width={1240} />);

    expect(screen.getByTestId('composer-home')).toHaveAttribute(
      'data-sticky-composer',
      'true'
    );
    expect(
      screen.getByTestId('workbench-sticky-composer-host')
    ).toHaveAttribute('data-sticky', 'true');
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
    vi.stubGlobal('innerWidth', width);

    render(<ViewportWidthProbe />);
    expect(screen.getByTestId('viewport-width-probe')).toHaveAttribute(
      'data-dual-column',
      'false'
    );

    act(() => {
      width = 1300;
      vi.stubGlobal('innerWidth', width);
      window.dispatchEvent(new Event('resize'));
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

/**
 * V31-96: both WorkbenchCreateLayout branches must keep `stream` at the same
 * position under the same ancestor chain. When they do not, React unmounts the
 * whole Composer subtree on every phase crossing.
 *
 * A testid assertion cannot witness this — the node is re-created carrying the
 * same testid, so every existing assertion in this file passes either way.
 * Local state is the only witness: it survives a re-render and cannot survive
 * an unmount.
 */
function StreamStateWitness() {
  const [pressed, setPressed] = useState(0);
  return (
    <button
      data-testid="stream-state-witness"
      onClick={() => setPressed((count) => count + 1)}
      type="button"
    >
      {String(pressed)}
    </button>
  );
}

function StreamIdentityProbe({ dualColumn }: { dualColumn: boolean }) {
  return (
    <WorkbenchShellRoot
      dualColumn={dualColumn}
      stickyComposer
      widthMode={resolveWorkbenchWidthMode({ dualColumn })}
      data-testid="composer-home"
    >
      <WorkbenchCreateLayout
        dualColumn={dualColumn}
        inspector={<WorkbenchInspectorPanel summary="摘要" workId="work-1" />}
        stream={<StreamStateWitness />}
      />
    </WorkbenchShellRoot>
  );
}

describe('WorkbenchCreateLayout keeps stream mounted across the flip (V31-96)', () => {
  it('preserves stream subtree state when dualColumn flips false → true', () => {
    const { rerender } = render(<StreamIdentityProbe dualColumn={false} />);
    fireEvent.click(screen.getByTestId('stream-state-witness'));
    expect(screen.getByTestId('stream-state-witness')).toHaveTextContent('1');

    rerender(<StreamIdentityProbe dualColumn />);

    expect(screen.getByTestId('composer-home')).toHaveAttribute(
      'data-dual-column',
      'true'
    );
    expect(screen.getByTestId('stream-state-witness')).toHaveTextContent('1');
  });

  it('preserves stream subtree state when dualColumn flips true → false', () => {
    const { rerender } = render(<StreamIdentityProbe dualColumn />);
    fireEvent.click(screen.getByTestId('stream-state-witness'));
    fireEvent.click(screen.getByTestId('stream-state-witness'));
    expect(screen.getByTestId('stream-state-witness')).toHaveTextContent('2');

    rerender(<StreamIdentityProbe dualColumn={false} />);

    expect(screen.getByTestId('composer-home')).toHaveAttribute(
      'data-dual-column',
      'false'
    );
    expect(screen.getByTestId('stream-state-witness')).toHaveTextContent('2');
  });
});
