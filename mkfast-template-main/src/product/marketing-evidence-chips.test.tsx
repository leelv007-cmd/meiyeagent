import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { MarketingEvidenceChips } from './marketing-evidence-chips';

test('shows the brand-official fallback chip when no personal identity is configured', () => {
  const html = renderToStaticMarkup(
    <MarketingEvidenceChips evidence={{ identityFallback: 'brand_official' }} />
  );

  assert.match(html, /本次使用品牌官方口吻（未配置主理人 IP）/u);
});

test('does not show an identity fallback chip when a registered identity is used', () => {
  const html = renderToStaticMarkup(
    <MarketingEvidenceChips evidence={{ identityFallback: 'none' }} />
  );

  assert.doesNotMatch(html, /品牌官方口吻|未配置主理人 IP/u);
});
