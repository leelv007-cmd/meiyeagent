import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContentPackageResults } from './content-package-results';

test('renders six low-friction chips, three honest sources, the ladder, and weekly actions', () => {
  const html = renderToStaticMarkup(
    <ContentPackageResults
      onRecord={() => undefined}
      onReviewAction={() => undefined}
      packageId="package-a"
      results={{
        ladder: [
          { id: 'published', reached: true },
          { id: 'attention', reached: true },
          { id: 'consultation', reached: true },
          { id: 'appointment_or_purchase', reached: true },
          { id: 'redeemed_or_visited', reached: true },
        ],
        signals: {
          inferred: [
            {
              actorId: 'system:temporal-association',
              id: 'inferred-signal-a',
              kind: 'store_visit',
              note: '仅时间与内容关联，不代表由该内容导致。',
              occurredAt: '2026-07-18T08:00:00.000Z',
              source: 'inferred_temporal',
            },
          ],
          merchant: [
            {
              actorId: 'owner-a',
              id: 'merchant-signal-a',
              kind: 'store_visit',
              occurredAt: '2026-07-18T08:00:00.000Z',
              source: 'merchant_recorded',
            },
          ],
          verified: [],
        },
      }}
      weeklyReview={{
        nextExperiments: [
          {
            actions: ['continue_series', 'change_cta', 'stop_series'],
            nextTest: 'repeat_or_change_cta',
            packageId: 'package-a',
          },
        ],
        observed: [
          {
            packageId: 'package-a',
            signal: {
              actorId: 'owner-a',
              id: 'weekly-signal-a',
              kind: 'store_visit',
              occurredAt: '2026-07-18T08:00:00.000Z',
              source: 'merchant_recorded',
            },
          },
        ],
        published: [
          {
            event: {
              actorId: 'owner-a',
              id: 'weekly-published-a',
              occurredAt: '2026-07-18T07:00:00.000Z',
              platform: 'douyin',
              source: 'native',
              status: 'published',
              type: 'manual_publish_result',
              variantVersionId: 'douyin-v1',
            },
            packageId: 'package-a',
          },
        ],
      }}
    />
  );

  for (const label of ['私信', '加微', '预约', '买券', '核销', '到店']) {
    assert.match(html, new RegExp(`>${label}<`, 'u'));
  }
  assert.match(html, /已验证信号/u);
  assert.match(html, /人工记录不会被标成已验证/u);
  assert.match(html, /门店记录信号/u);
  assert.match(html, /推断相关性/u);
  assert.match(html, /不代表由该内容导致/u);
  assert.match(html, /结果阶梯/u);
  assert.match(html, /本周三问/u);
  assert.match(html, /抖音.*2026-07-18/u);
  assert.match(html, /每次只验证一个变量/u);
  assert.match(html, /续做这一系列/u);
  assert.match(html, /换 CTA/u);
  assert.match(html, /停止这一系列/u);
  assert.doesNotMatch(html, /转化率|因果|lead_signal_capture_rate/u);
});
