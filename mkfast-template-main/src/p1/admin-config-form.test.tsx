import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminConfigForm } from '@/p1/admin-config-form';

function render(configKey: string, value: unknown) {
  return renderToStaticMarkup(
    <AdminConfigForm configKey={configKey} onChange={() => {}} value={value} />
  );
}

test('a compliance default renders as a single switch', () => {
  const html = render('compliance.watermark.default', false);
  assert.match(html, /data-slot="cell-switch"/);
  assert.doesNotMatch(html, /<textarea/);
});

test('a default model id renders as a plain single-line field', () => {
  const html = render('platform.defaultModel.copy', 'deepseek-chat');
  assert.match(html, /value="deepseek-chat"/);
  assert.doesNotMatch(html, /<textarea/);
});

test('plan credits render steppers for period credits and a dial for priority', () => {
  const html = render('plan.credits.trial', {
    concurrencyLimit: 1,
    credits: 100,
    currency: 'HKD',
    monthlyPriceMicros: 0,
    queuePriority: 3,
    storageMb: 512,
    supportLabel: 'standard',
  });
  assert.match(html, /data-slot="number-stepper"/);
  assert.match(html, /data-slot="cell-slider"/);
  assert.match(html, /data-slot="native-select-select"/);
  assert.doesNotMatch(html, /<textarea/);
});

test('add-on offers render as a grid with an add control', () => {
  const html = render('plan.addons', [
    {
      amountMicros: 9_900_000,
      currency: 'CNY',
      id: 'copy-20',
      quantity: 20,
      resource: 'copy',
    },
  ]);
  assert.match(html, /data-slot="data-grid"|<table/);
  assert.match(html, /data-testid="admin-config-plan-addons-value-add"/);
  assert.match(html, /data-slot="cell-select"/);
});

test('note styles render one card per style with platform toggles', () => {
  const html = render('harness.note.styles', {
    styles: [
      {
        id: 'warm',
        name: '温柔种草',
        platforms: ['xiaohongshu'],
        structureTemplate: '开场-痛点-方案-邀约',
        writingGuide: '像跟老顾客聊天一样说话。',
      },
    ],
  });
  assert.match(html, /温柔种草/);
  assert.match(html, /小红书/);
  assert.match(html, /data-testid="admin-config-harness-note-styles-styles-0"/);
  // 平台是三个开关，不是让人写数组。
  assert.match(html, /data-slot="cell-switch"/);
});

/** 两行以上时，每一行的控件必须各有各的 id——否则页面上会出现同名控件。 */
test('每行的字段 id 互不相同', () => {
  const html = render('harness.note.styles', {
    styles: [
      {
        id: 'a',
        name: '甲',
        platforms: ['xiaohongshu'],
        structureTemplate: '一',
        writingGuide: '一',
      },
      {
        id: 'b',
        name: '乙',
        platforms: ['douyin'],
        structureTemplate: '二',
        writingGuide: '二',
      },
    ],
  });
  // `\s` 是必要的：`data-testid="…"` 里也含 `id="…"`。
  const first = html.match(
    /\sid="admin-config-harness-note-styles-styles-0-name"/g
  );
  const second = html.match(
    /\sid="admin-config-harness-note-styles-styles-1-name"/g
  );
  assert.equal(first?.length, 1);
  assert.equal(second?.length, 1);
});

/** 契约要求至少留一个平台，那最后一个就得真的关不掉。 */
test('the last remaining platform toggle is locked, not merely discouraged', () => {
  const single = render('harness.note.styles', {
    styles: [
      {
        id: 'a',
        name: '甲',
        platforms: ['xiaohongshu'],
        structureTemplate: '一',
        writingGuide: '一',
      },
    ],
  });
  assert.match(
    single,
    /data-testid="admin-config-harness-note-styles-styles-0-platforms-xiaohongshu"[^>]*data-disabled/
  );

  const twoPlatforms = render('harness.note.styles', {
    styles: [
      {
        id: 'a',
        name: '甲',
        platforms: ['xiaohongshu', 'douyin'],
        structureTemplate: '一',
        writingGuide: '一',
      },
    ],
  });
  assert.doesNotMatch(
    twoPlatforms,
    /data-testid="admin-config-harness-note-styles-styles-0-platforms-xiaohongshu"[^>]*data-disabled/
  );
});

test('an empty list explains itself instead of showing an empty editor', () => {
  const html = render('plan.addons', []);
  assert.match(html, /还没有内容/);
});
