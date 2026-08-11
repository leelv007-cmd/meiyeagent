/**
 * Resize-reactive viewport width for workbench dual-column (P1-1 / #313).
 *
 * `override` is the ComposerHome `viewportWidth` test prop — when set, live
 * resize is ignored so interaction fixtures stay deterministic.
 */

import { useEffect, useState } from 'react';

import { WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX } from './workbench-shell';

const SSR_FALLBACK_WIDTH = WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX;

function readWindowWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : SSR_FALLBACK_WIDTH;
}

/**
 * Live viewport width. Subscribes to resize so dual-column eligibility flips
 * without an unrelated re-render.
 */
export function useWorkbenchViewportWidth(override?: number): number {
  const [liveWidth, setLiveWidth] = useState(readWindowWidth);

  useEffect(() => {
    if (override != null) {
      setLiveWidth(override);
      return;
    }
    if (typeof window === 'undefined') return;

    const sync = () => setLiveWidth(window.innerWidth);
    window.addEventListener('resize', sync);
    sync();
    return () => {
      window.removeEventListener('resize', sync);
    };
  }, [override]);

  return override ?? liveWidth;
}
