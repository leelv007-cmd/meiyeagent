import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CANVAS_TEMPLATE_NAME,
  DEFAULT_CANVAS_WORK_NAME,
  officialCanvasTemplateName,
  officialCanvasWorkName,
} from '@meiye/contracts';
import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { canvasName } from './canvas-name';

test('neutral canvas names localize only at the render boundary', () => {
  overwriteGetLocale(() => 'en');
  try {
    assert.equal(canvasName(DEFAULT_CANVAS_WORK_NAME), 'Blank visual post');
    assert.equal(
      canvasName(DEFAULT_CANVAS_TEMPLATE_NAME),
      'Blank visual post template'
    );
    assert.equal(canvasName('Merchant summer menu'), 'Merchant summer menu');
    assert.equal(
      canvasName(officialCanvasWorkName('price_card')),
      'Price card work'
    );
    assert.equal(
      canvasName(officialCanvasTemplateName('price_card')),
      'Price card work template'
    );
  } finally {
    overwriteGetLocale(() => 'zh');
  }

  assert.equal(canvasName(DEFAULT_CANVAS_WORK_NAME), '空白图文作品');
  assert.equal(canvasName(DEFAULT_CANVAS_TEMPLATE_NAME), '空白图文作品模板');
  assert.equal(
    canvasName(officialCanvasTemplateName('price_card')),
    '价格卡作品模板'
  );
});

test('legacy blank defaults follow the current locale without rewriting user content', () => {
  overwriteGetLocale(() => 'en');
  try {
    assert.equal(canvasName('空白图文作品'), 'Blank visual post');
    assert.equal(canvasName('My best work'), 'My best work');
    assert.equal(canvasName('Design template'), 'Design template');
    assert.equal(canvasName('我的作品'), '我的作品');
    assert.equal(canvasName('设计模板'), '设计模板');
  } finally {
    overwriteGetLocale(() => 'zh');
  }

  assert.equal(canvasName('Blank visual post'), '空白图文作品');
  assert.equal(canvasName('My best work'), 'My best work');
  assert.equal(canvasName('Design template'), 'Design template');
  assert.equal(canvasName('我的作品'), '我的作品');
  assert.equal(canvasName('设计模板'), '设计模板');
});
