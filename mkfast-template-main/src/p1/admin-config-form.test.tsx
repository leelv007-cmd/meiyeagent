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
  assert.match(html, /data-slot="switch"/);
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
  assert.match(html, /data-slot="slider"/);
  assert.match(html, /data-slot="select-trigger"/);
  assert.doesNotMatch(html, /<textarea/);
  // No heroui cell-editor residue.
  assert.doesNotMatch(html, /data-slot="cell-switch"|data-slot="cell-select"|data-slot="cell-slider"|data-slot="native-select/);
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
  assert.match(html, /data-slot="data-grid"|data-slot="table"/);
  assert.match(html, /data-testid="admin-config-plan-addons-value-add"/);
  assert.match(html, /data-slot="select-trigger"/);
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
  // Platforms are switches, not a free-form array input.
  assert.match(html, /data-slot="switch"/);
});

/** Each row must own distinct control ids — shared ids break label targeting. */
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
  // `\s` is required: `data-testid="…"` also contains `id="…"`.
  const first = html.match(
    /\sid="admin-config-harness-note-styles-styles-0-name"/g
  );
  const second = html.match(
    /\sid="admin-config-harness-note-styles-styles-1-name"/g
  );
  assert.equal(first?.length, 1);
  assert.equal(second?.length, 1);
});

/** Contract minItems locks the last remaining platform toggle. */
test('the last remaining platform toggle is locked, not merely discouraged', () => {
  const switchOpenTag = (html: string, testId: string) => {
    // Base UI may emit data-disabled before data-testid; match the whole open tag.
    const match = html.match(
      new RegExp(`<span(?=[^>]*data-testid="${testId}")[^>]*>`, 'u')
    );
    return match?.[0] ?? '';
  };
  const xhsId =
    'admin-config-harness-note-styles-styles-0-platforms-xiaohongshu';

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
  assert.match(switchOpenTag(single, xhsId), /\bdata-disabled\b/);

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
  // Class names contain "data-disabled:" variants; require the attribute form.
  assert.doesNotMatch(
    switchOpenTag(twoPlatforms, xhsId),
    /\bdata-disabled(?:=""|=true|\s|>)/
  );
});

test('an empty list explains itself instead of showing an empty editor', () => {
  const html = render('plan.addons', []);
  assert.match(html, /还没有内容/);
});

test('controlled config form source does not import heroui', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const source = readFileSync(
    resolve(process.cwd(), 'src/p1/admin-config-form.tsx'),
    'utf8'
  );
  assert.doesNotMatch(source, /@heroui\/react|@\/components\/heroui-pro/);
});
