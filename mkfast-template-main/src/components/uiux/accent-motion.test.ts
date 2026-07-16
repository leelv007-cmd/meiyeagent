import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GenerationAccent } from './generation-accent';
import { PublishCelebration } from './publish-celebration';

test('generation accent keeps an immediate accessible status fallback', () => {
  const fallback = renderToStaticMarkup(
    createElement(GenerationAccent, { label: '正在生成图片' })
  );

  assert.match(fallback, /^<output/);
  assert.match(fallback, /正在生成图片/);
  assert.equal(typeof GenerationAccent, 'function');
});

test('publish celebration keeps completion text when motion is unavailable', () => {
  const fallback = renderToStaticMarkup(
    createElement(PublishCelebration, { label: '已发布' })
  );

  assert.match(fallback, /^<output/);
  assert.match(fallback, /已发布/);
  assert.equal(typeof PublishCelebration, 'function');
});
