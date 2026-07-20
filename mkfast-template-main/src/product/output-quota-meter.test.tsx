import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OutputQuotaMeter } from './output-quota-meter';

test('renders the same available and total output buckets as account usage', () => {
  const html = renderToStaticMarkup(
    <OutputQuotaMeter
      projection={{
        plan: { tier: 'starter' },
        usage: {
          audio: {
            allowance: 0,
            available: 0,
            committed: 0,
            released: 0,
            reserved: 0,
          },
          copy: {
            allowance: 30,
            available: 21,
            committed: 9,
            released: 0,
            reserved: 0,
          },
          image: {
            allowance: 0,
            available: 0,
            committed: 0,
            released: 0,
            reserved: 0,
          },
          video: {
            allowance: 0,
            available: 0,
            committed: 0,
            released: 0,
            reserved: 0,
          },
        },
      }}
    />
  );

  assert.match(html, /文案条数[^<]*可用 21\/总量 30/u);
  assert.match(html, /图片张数[^<]*可用 0\/总量 0/u);
  assert.match(html, /视频条数[^<]*可用 0\/总量 0/u);
  assert.doesNotMatch(html, /剩余内容|剩余视频|发布包|存储/u);
});
