import type { ReactNode } from 'react';

/**
 * Fixed page frame + corner notches, ported from the SaaS template
 * layout. Classes live in landing.css under `.meiye-landing`.
 */

const CORNER_PATH =
  'M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z';

const CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

export function SiteFrame(): ReactNode {
  return (
    <>
      <div className="site-frame site-frame--top" aria-hidden="true" />
      <div className="site-frame site-frame--bottom" aria-hidden="true" />
      <div className="site-frame site-frame--left" aria-hidden="true" />
      <div className="site-frame site-frame--right" aria-hidden="true" />

      {CORNERS.map((corner) => (
        <svg
          key={corner}
          className={`site-corner site-corner--${corner}`}
          width="50"
          height="50"
          viewBox="0 0 50 50"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d={CORNER_PATH} fill="currentColor" />
        </svg>
      ))}
    </>
  );
}
