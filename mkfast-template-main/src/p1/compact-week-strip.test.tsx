import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { p1_week_strip_empty } from '@/locale/paraglide/messages';

import { CompactWeekStrip } from './compact-week-strip';
import type { WeekPointView } from './types';

const emptyPoints: WeekPointView[] = Array.from({ length: 5 }, (_, index) => ({
  contentCount: 0,
  dateLabel: `7/${14 + index}`,
  id: `empty-${index}`,
  status: 'unknown',
  statusLabel: 'None',
  weekday: `Day ${index + 1}`,
}));

test('compact week strip degrades when all five points have no data', () => {
  const html = renderToStaticMarkup(
    createElement(CompactWeekStrip, {
      label: 'This week',
      points: emptyPoints,
    })
  );

  assert.ok(html.includes(p1_week_strip_empty()));
  assert.doesNotMatch(html, /<ol/);
});

test('compact week strip restores the five points when real data exists', () => {
  const points: WeekPointView[] = emptyPoints.map((point, index) =>
    index === 2
      ? {
          ...point,
          contentCount: 1,
          status: 'planned',
          statusLabel: 'Planned',
        }
      : point
  );
  const html = renderToStaticMarkup(
    createElement(CompactWeekStrip, { label: 'This week', points })
  );

  assert.match(html, /<ol/);
  assert.match(html, /Planned/);
  assert.ok(!html.includes(p1_week_strip_empty()));
});
