import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@/api/workspace-access', () => ({
  getWorkspaceAccess: async () => ({ id: 'workspace-a', role: 'owner' }),
}));

import { IntegrationSettings } from './integration-settings';
import { type useIntegrationSettings } from './use-integration-settings';

function renderSettings() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['workspace', 'access'], { role: 'owner' });
  const settings = {
    audit: [],
    busy: false,
    connections: [],
    error: undefined,
    executeCommand: async () => undefined,
    feishuProducts: {},
    loading: false,
    refresh: async () => undefined,
    refreshing: false,
  } as ReturnType<typeof useIntegrationSettings>;

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntegrationSettings settings={settings} />
    </QueryClientProvider>
  );
}

/**
 * Granting a public platform the right to publish on the merchant's behalf is
 * a consequential act. The create form used to arrive with all four Douyin
 * capabilities — 发布 / 数据观测 / POI 锚点 / 小程序锚点 — already switched on,
 * so 「发布」 was granted by默认 rather than by decision.
 */
test('new connections request nothing until the merchant switches it on', () => {
  const html = renderSettings();
  expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/u);
  expect(html).not.toMatch(/role="switch"[^>]*aria-checked="true"/u);
});

/**
 * The scope list is the platform's vocabulary (`publish, observe,
 * publish.poi, publish.mini_program`). It is compiled from the switches now,
 * never typed by a nail-salon owner.
 */
test('the raw scope string is not a merchant-editable field', () => {
  const html = renderSettings();
  expect(html).not.toMatch(/id="integration-scopes"/u);
});

/**
 * PRODUCT.md 反面参照「后台代码与技术术语暴露给商家」and D-102「三个权限帽子
 * 不投影成商家要理解的组织产品」, checked on the strings the connections page
 * actually renders.
 */
test('connection copy carries no capability-tier codes, RBAC hats or protocol names', () => {
  const html = renderSettings();
  expect(html).not.toMatch(/\bL[0-9]\b/u);
  expect(html).not.toMatch(/工作区(?:管理员|负责人)/u);
  expect(html).not.toMatch(/\bOAuth\b|\bMCP\b|\bUAT\b/u);
});
