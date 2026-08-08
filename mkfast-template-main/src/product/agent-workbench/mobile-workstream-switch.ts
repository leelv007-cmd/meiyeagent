/**
 * Mobile 过程 / 作品 pane switch (V3.1 §4.3 foundation, V31-04).
 * Pure model — host owns DOM.
 */

export type WorkstreamMobilePane = 'process' | 'works';

export const WORKSTREAM_MOBILE_PANE_LABELS: Record<
  WorkstreamMobilePane,
  string
> = {
  process: '过程',
  works: '作品',
};

export type MobileWorkstreamLayout = {
  showSwitch: boolean;
  activePane: WorkstreamMobilePane;
  showProcess: boolean;
  showWorks: boolean;
};

/**
 * Desktop always shows process column (+ dual inspector when eligible).
 * Mobile shows a capsule switch; default = process.
 */
export function resolveMobileWorkstreamLayout(input: {
  viewport: 'mobile' | 'desktop';
  pane: WorkstreamMobilePane;
}): MobileWorkstreamLayout {
  if (input.viewport === 'desktop') {
    return {
      showSwitch: false,
      activePane: 'process',
      showProcess: true,
      showWorks: true,
    };
  }
  const pane = input.pane;
  return {
    showSwitch: true,
    activePane: pane,
    showProcess: pane === 'process',
    showWorks: pane === 'works',
  };
}

export function toggleMobileWorkstreamPane(
  pane: WorkstreamMobilePane
): WorkstreamMobilePane {
  return pane === 'process' ? 'works' : 'process';
}
