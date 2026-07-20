import assert from 'node:assert/strict';
import test from 'node:test';
import type { HotTopicOpportunityCard } from '@meiye/contracts';
import { renderToStaticMarkup } from 'react-dom/server';

import { HotTopicOpportunityCardView } from './hot-topic-opportunity-card';

const opportunity = {
  opportunityId: 'opportunity-1',
  status: 'active',
  source: 'https://example.com/city-hair-color',
  sourceType: 'user_link',
  capturedAt: '2026-07-18T08:00:00.000Z',
  expiresAt: '2026-07-19T08:00:00.000Z',
  platforms: ['xiaohongshu'],
  region: '上海静安',
  targetAudience: '准备换夏季发色的同城顾客',
  matchedStoreReferences: ['store_fact:service-1:2', 'asset:hair-color-1'],
  relevanceExplanation: '门店本周主推低损伤染发，并有已授权案例素材。',
  reusableMechanism: '借“夏季显白发色”问题结构，给出本店原创选择建议。',
  expectedAction: '私信预约发质判断。',
  evergreenFallback: '转为常青发色选择指南。',
  protectedExpressionCopied: false,
} satisfies HotTopicOpportunityCard;

test('renders the complete active opportunity card on the result detail surface', () => {
  const html = renderToStaticMarkup(
    <HotTopicOpportunityCardView opportunity={opportunity} />
  );

  assert.match(html, /热点机会卡/u);
  assert.match(html, /进行中/u);
  assert.match(html, /2026-07-18 08:00/u);
  assert.match(html, /2026-07-19 08:00/u);
  assert.match(html, /小红书/u);
  assert.match(html, /上海静安/u);
  assert.match(html, /准备换夏季发色的同城顾客/u);
  assert.match(html, /门店本周主推低损伤染发/u);
  assert.match(html, /建议角度/u);
  assert.match(html, /夏季显白发色/u);
  assert.match(html, /私信预约发质判断/u);
  assert.match(html, /转为常青发色选择指南/u);
  assert.match(html, /本店服务信息/u);
  assert.match(html, /本店素材/u);
  assert.doesNotMatch(html, /store_fact:service-1:2/u);
  assert.doesNotMatch(html, /asset:hair-color-1/u);
  assert.doesNotMatch(html, /opportunity-1/u);
});

test('renders no opportunity section when the package has no opportunity data', () => {
  assert.equal(renderToStaticMarkup(<HotTopicOpportunityCardView />), '');
});

test('renders a compact opportunity summary for the dashboard hero', () => {
  const html = renderToStaticMarkup(
    <HotTopicOpportunityCardView
      opportunity={opportunity}
      presentation="compact"
    />
  );

  assert.match(html, /热点机会卡/u);
  assert.match(html, /门店本周主推低损伤染发/u);
  assert.match(html, /私信预约发质判断/u);
  assert.match(html, /2026-07-19 08:00/u);
  assert.match(html, /data-presentation="compact"/u);
  assert.doesNotMatch(html, /采集时间/u);
});

test('replaces an internal workspace region with the store service scope', () => {
  const html = renderToStaticMarkup(
    <HotTopicOpportunityCardView
      opportunity={{ ...opportunity, region: 'ws_6xkZiR2OhL9K' }}
    />
  );

  assert.match(html, /本店服务范围/u);
  assert.doesNotMatch(html, /ws_6xkZiR2OhL9K/u);
});

test('requires both internal-token boundaries before hiding merchant text', () => {
  const html = renderToStaticMarkup(
    <HotTopicOpportunityCardView
      opportunity={{
        ...opportunity,
        matchedStoreReferences: [
          'store_fact:service-1:2（低损伤染发）',
          '门店说明 asset:hair-color-1',
        ],
        region: 'ws_6xkZiR2OhL9K 服务周边 3 公里',
      }}
    />
  );

  assert.match(html, /store_fact:service-1:2（低损伤染发）/u);
  assert.match(html, /门店说明 asset:hair-color-1/u);
  assert.match(html, /ws_6xkZiR2OhL9K 服务周边 3 公里/u);
});
