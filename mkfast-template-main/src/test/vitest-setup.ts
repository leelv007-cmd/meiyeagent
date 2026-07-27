import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom ships no `matchMedia`. HeroUI Pro components read it at module scope
 * (sheet → use-scale-background reads prefers-reduced-motion), so importing the
 * supply barrel throws without this. Reports "no preference" for every query,
 * which is the right default for a headless run.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * jsdom implements no scrolling at all, so `Element.prototype.scrollTo` is
 * missing. `ChatConversation` follows the newest turn through it, and an
 * unhandled TypeError from inside a requestAnimationFrame callback fails the
 * whole run. A no-op is the honest stand-in: jsdom has no viewport to scroll,
 * and the behaviour it stands for belongs to the browser gate.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
});
