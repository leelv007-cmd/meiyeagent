import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WarmEmptyState } from './warm-empty-state';

test('warm empty state renders its required action and optional description', () => {
  const html = renderToStaticMarkup(
    createElement(WarmEmptyState, {
      action: createElement('button', { type: 'button' }, 'Start creating'),
      description: 'Your progress will gather here.',
      media: createElement('svg'),
      title: 'Start with your first creation',
    })
  );

  assert.match(html, /<section[^>]+aria-labelledby="([^"]+)"/);
  assert.match(html, /data-slot="empty-description"/);
  assert.match(html, /<button type="button">Start creating<\/button>/);
});

test('warm empty state omits the optional description and keeps its action', () => {
  const html = renderToStaticMarkup(
    createElement(WarmEmptyState, {
      action: createElement('a', { href: '/dashboard' }, 'Open dashboard'),
      media: createElement('svg'),
      title: 'Nothing here yet',
    })
  );

  assert.doesNotMatch(html, /data-slot="empty-description"/);
  assert.match(html, /<a href="\/dashboard">Open dashboard<\/a>/);
});
