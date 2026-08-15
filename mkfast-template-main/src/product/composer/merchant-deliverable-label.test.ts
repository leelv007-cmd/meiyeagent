import assert from 'node:assert/strict';
import test from 'node:test';

import { composerDeliverableKindIds } from '@meiye/contracts';

import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import {
  MERCHANT_DELIVERABLE_KIND_IDS,
  merchantDeliverableLabel,
} from './merchant-deliverable-label';

test('maps every known Brief deliverable kind to merchant language', () => {
  overwriteGetLocale(() => 'zh');

  const expected: Record<string, string> = {
    copy: '文案',
    copy_document: '文案',
    text: '文案',
    image: '图片',
    image_set: '图片',
    poster: '图片',
    media: '图片',
    note: '图文',
    image_text: '图文',
    image_text_package: '图文',
    video: '视频',
    video_package: '视频',
  };

  for (const kind of MERCHANT_DELIVERABLE_KIND_IDS) {
    assert.equal(
      merchantDeliverableLabel(kind),
      expected[kind],
      `unmapped kind: ${kind}`
    );
  }

  for (const kind of composerDeliverableKindIds) {
    assert.notEqual(merchantDeliverableLabel(kind), kind);
  }
});

test('image follows the image_text lens as 图文, otherwise 图片', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(merchantDeliverableLabel('image', 'image_text'), '图文');
  assert.equal(merchantDeliverableLabel('image', 'copy'), '图片');
  assert.equal(merchantDeliverableLabel('image_set', 'image_text'), '图文');
  assert.equal(merchantDeliverableLabel('note', 'copy'), '图文');
});

test('unknown values stay as-is, including English leftovers', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(merchantDeliverableLabel('storyboard_v2'), 'storyboard_v2');
  assert.equal(merchantDeliverableLabel('IMAGE'), '图片');
  assert.equal(merchantDeliverableLabel(''), '');
  assert.equal(merchantDeliverableLabel('  video  '), '视频');
});

test('renders the active locale', () => {
  overwriteGetLocale(() => 'en');
  assert.equal(merchantDeliverableLabel('copy_document'), 'Copy');
  assert.equal(merchantDeliverableLabel('image'), 'Image');
  assert.equal(merchantDeliverableLabel('video_package'), 'Video');
  overwriteGetLocale(() => 'zh');
  assert.equal(merchantDeliverableLabel('copy_document'), '文案');
});
