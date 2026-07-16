import assert from 'node:assert/strict';
import test from 'node:test';

import { renderAiMarkdown } from './markdown';

test('renders model markdown while escaping raw HTML', async () => {
  const { markup } = await renderAiMarkdown(
    '# 美甲方案\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>'
  );

  assert.match(markup, /<h1/);
  assert.doesNotMatch(markup, /<script|<img|onerror=/i);
});

test('drops unsafe link protocols and preserves ordinary Chinese markdown', async () => {
  const { markup } = await renderAiMarkdown(
    '**亮点**\uff1a清透裸粉\n\n- 通勤\n- 约会\n\n[危险链接](javascript:alert(1))\n\n[官网](https://example.com)'
  );

  assert.match(markup, /<strong>亮点<\/strong>/);
  assert.doesNotMatch(markup, /javascript:/i);
  assert.match(markup, /href="https:\/\/example\.com"/);
});
