import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./integration-settings.tsx', import.meta.url),
  'utf8'
);

const messages = Object.fromEntries(
  ['en', 'zh'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(
        new URL(
          `../../project.inlang/messages/${locale}.json`,
          import.meta.url
        ),
        'utf8'
      )
    ) as Record<string, string>,
  ])
);

/**
 * Granting a public platform the right to publish on the merchant's behalf is
 * a consequential act. The create form used to arrive with all four Douyin
 * capabilities — 发布 / 数据观测 / POI 锚点 / 小程序锚点 — already switched on,
 * so 「发布」 was granted by默认 rather than by decision.
 */
test('new connections request nothing until the merchant switches it on', () => {
  assert.match(source, /capabilities:\s*\[\],/u);
  assert.doesNotMatch(
    source,
    /capabilities:\s*\w+\.capabilities\.map\(\s*\(capability\)\s*=>\s*capability\.id\s*\),/u
  );
  assert.doesNotMatch(source, /scopes:\s*\w+\.capabilities\s*\n?\s*\.map\(/u);
});

/**
 * The scope list is the platform's vocabulary (`publish, observe,
 * publish.poi, publish.mini_program`). It is compiled from the switches now,
 * never typed by a nail-salon owner.
 */
test('the raw scope string is not a merchant-editable field', () => {
  assert.doesNotMatch(source, /id="integration-scopes"/u);
  assert.doesNotMatch(source, /integration_scopes_placeholder/u);
});

/**
 * PRODUCT.md 反面参照「后台代码与技术术语暴露给商家」and D-102「三个权限帽子
 * 不投影成商家要理解的组织产品」, checked on the strings the connections page
 * actually renders.
 */
test('connection copy carries no capability-tier codes, RBAC hats or protocol names', () => {
  const keys = Object.keys(messages.zh!).filter((key) =>
    key.startsWith('integration_')
  );
  for (const key of keys) {
    const zh = messages.zh![key] ?? '';
    assert.doesNotMatch(zh, /\bL[0-9]\b/u, key);
    assert.doesNotMatch(zh, /工作区(?:管理员|负责人)/u, key);
    assert.doesNotMatch(zh, /\bOAuth\b|\bMCP\b|\bUAT\b/u, key);
  }
});
