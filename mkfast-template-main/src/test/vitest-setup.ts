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

afterEach(() => {
  cleanup();
});
