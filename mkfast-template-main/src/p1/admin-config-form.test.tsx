import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminConfigForm } from '@/p1/admin-config-form';
import { defaultAdminConfigValue } from '@/p1/admin-config-field-model';
import { ADMIN_CONFIG_KEYS } from '@/p1/admin-config-view-model';

function render(configKey: string, value: unknown) {
  return renderToStaticMarkup(
    <AdminConfigForm configKey={configKey} onChange={() => {}} value={value} />
  );
}

/**
 * U05 的硬门在这里有一条镜像断言：后台任何一个配置项都不该再出现
 * 「自己拼一段 JSON」的输入框。长文字段（写作要点）允许多行输入，
 * 但它渲染的是散文，不是 `font-mono` 的结构文本。
 */
test('no admin config key falls back to a hand-typed JSON editor', () => {
  for (const key of ADMIN_CONFIG_KEYS) {
    const html = render(key, defaultAdminConfigValue(key));
    assert.ok(
      html.includes(`admin-config-form-${key}`),
      `${key} rendered no form`
    );
    assert.doesNotMatch(
      html,
      /font-mono/,
      `${key} still renders a code-shaped editor`
    );
  }
});

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

test('plan allowances render steppers for counts and a dial for priority', () => {
  const html = render('plan.allowances.trial', {
    allowance: { audio: 0, copy: 20, image: 10, video: 5 },
    concurrencyLimit: 1,
    expireDays: 7,
    queuePriority: 3,
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

test('an empty list explains itself instead of showing an empty editor', () => {
  const html = render('plan.addons', []);
  assert.match(html, /还没有内容/);
});
