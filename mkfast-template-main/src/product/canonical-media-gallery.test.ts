import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPathWithLocale } from '@/lib/urls';
import { CanonicalMediaPreview } from './canonical-media-gallery';
import type { CanonicalMediaProjection } from './canonical-history-model';

function render(
  kind: CanonicalMediaProjection['kind'],
  presentation: 'thumbnail' | 'hero' = 'thumbnail'
) {
  return renderToStaticMarkup(
    createElement(CanonicalMediaPreview, {
      media: {
        assetId: `asset-${kind}`,
        href: `/dashboard/assets/asset-${kind}`,
        kind,
        src: `/api/media/${kind}`,
        title: `${kind} result`,
      },
      presentation,
    })
  );
}

describe('canonical media preview', () => {
  it('renders lazy, non-stretched image thumbnails as dialog triggers', () => {
    const html = render('image');

    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(
      html,
      new RegExp(`href="${getPathWithLocale('/dashboard/assets/asset-image')}"`)
    );
    assert.match(html, /loading="lazy"/);
    assert.match(html, /object-cover/);
    assert.doesNotMatch(html, /objectKey/);
  });

  it('loads video metadata without autoplay and opens playback in lightbox', () => {
    const html = render('video');

    assert.match(
      html,
      new RegExp(`href="${getPathWithLocale('/dashboard/assets/asset-video')}"`)
    );
    assert.match(html, /preload="metadata"/);
    assert.match(html, /playsInline=""/);
    assert.doesNotMatch(html, /autoplay/);
    assert.doesNotMatch(html, /controls/);
  });

  it('reserves hero height so lazy media can enter the viewport and load', () => {
    const html = render('image', 'hero');

    assert.match(html, /min-h-44/);
    assert.match(html, /object-contain/);
  });
});
