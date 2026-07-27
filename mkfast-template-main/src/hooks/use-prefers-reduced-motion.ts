import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

/**
 * `prefers-reduced-motion: reduce`, as a React value.
 *
 * `src/styles.css` already flattens CSS animations and transitions inside the
 * product shell, but two kinds of motion escape a stylesheet and need this
 * hook instead:
 *
 * - scrolling requested in JavaScript (`scrollTo({ behavior: 'smooth' })`
 *   ignores the `scroll-behavior` property);
 * - motion a component runs from JS (Motion / Streamdown reveal animations).
 *
 * Server render answers `false` — matching the media query needs a window —
 * and the first client commit corrects it, so nothing animates on the server
 * and nothing keeps animating for a merchant who asked it to stop.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
