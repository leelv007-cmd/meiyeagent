import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('verified OpenCLI gate uses the injected logged-in bridge and keeps paste fallback', async ({
  page,
  request,
}) => {
  const xhsRequests: string[] = [];
  page.on('request', (browserRequest) => {
    if (/xiaohongshu\.com|xhslink\.com/u.test(browserRequest.url())) {
      xhsRequests.push(browserRequest.url());
    }
  });
  await page.addInitScript(() => {
    (
      window as Window & {
        __MEIYE_OPENCLI_BRIDGE__?: {
          schemaVersion: 'meiye-opencli-bridge/v1';
          ready: boolean;
          readXhsNote(input: { noteUrl: string }): Promise<{
            schemaVersion: 'viral-opencli-read/v1';
            noteText: string;
            authorizedAssets: Array<{ id: string; revision: string }>;
          }>;
        };
      }
    ).__MEIYE_OPENCLI_BRIDGE__ = {
      schemaVersion: 'meiye-opencli-bridge/v1',
      ready: true,
      async readXhsNote({ noteUrl }) {
        if (!noteUrl.includes('/explore/fixture-note')) {
          throw new Error('fixture bridge received an unexpected URL');
        }
        return {
          schemaVersion: 'viral-opencli-read/v1',
          noteText: '登录态 fixture 笔记：夏日护理三步走',
          authorizedAssets: [],
        };
      },
    };
  });

  const user = await registerE2EUser(request);
  await loginByForm(page, user);

  await page.getByTestId('suggestion-chip-viral_adapt').click();
  const sourcing = page.getByTestId('viral-adapt-sourcing-card');
  await expect(sourcing).toBeVisible();
  await expect(page.getByTestId('viral-adapt-track-opencli')).toHaveAttribute(
    'data-selected',
    'true'
  );
  await expect(
    page.getByTestId('viral-adapt-opencli-device-status')
  ).toContainText('本机桥已连接');

  const completeUrl =
    'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret';
  await page.getByTestId('viral-adapt-opencli-link').fill(completeUrl);
  await page.getByTestId('viral-adapt-opencli-action').click();
  await expect(
    page.getByTestId('viral-adapt-opencli-read-summary')
  ).toContainText('已读取笔记文字');
  await page.getByTestId('viral-adapt-sourcing-continue').click();
  await expect(
    page.getByTestId('viral-adapt-confirm-source-label')
  ).toContainText('本机登录态读取');
  await page.getByTestId('viral-adapt-confirm-submit').click();

  const intent = page.getByTestId('composer-intent-input');
  await expect(intent).toHaveValue(/本店项目|商家已确认/u);
  await expect(intent).not.toHaveValue(
    /viral_adapt_source|asset-opencli|登录态 fixture 笔记|xsec_token|fixture-secret|xiaohongshu\.com/u
  );
  expect(xhsRequests).toEqual([]);

  await page.getByTestId('suggestion-chip-viral_adapt').click();
  await page.getByTestId('viral-adapt-select-paste').click();
  await page
    .getByTestId('viral-adapt-paste-text')
    .fill('手动粘贴 fixture 笔记');
  await page.getByTestId('viral-adapt-sourcing-continue').click();
  await expect(
    page.getByTestId('viral-adapt-confirm-source-label')
  ).toContainText('粘贴笔记文字');
  expect(xhsRequests).toEqual([]);
});

test('a verified gate with no device bridge fails closed to paste', async ({
  page,
  request,
}) => {
  const xhsRequests: string[] = [];
  page.on('request', (browserRequest) => {
    if (/xiaohongshu\.com|xhslink\.com/u.test(browserRequest.url())) {
      xhsRequests.push(browserRequest.url());
    }
  });

  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.getByTestId('suggestion-chip-viral_adapt').click();

  await expect(page.getByTestId('viral-adapt-track-paste')).toHaveAttribute(
    'data-selected',
    'true'
  );
  await expect(
    page.getByTestId('viral-adapt-opencli-device-status')
  ).toContainText('本机桥未连接');
  await page.getByTestId('viral-adapt-select-opencli').click();
  await expect(page.getByTestId('viral-adapt-track-opencli')).toHaveAttribute(
    'data-selected',
    'true'
  );
  await expect(page.getByTestId('viral-adapt-opencli-action')).toBeDisabled();

  await page.getByTestId('viral-adapt-opencli-fallback').click();
  await expect(page.getByTestId('viral-adapt-paste-text')).toBeEnabled();
  expect(xhsRequests).toEqual([]);
});

test('a local bridge error stays generic and recovers through paste', async ({
  page,
  request,
}) => {
  const xhsRequests: string[] = [];
  page.on('request', (browserRequest) => {
    if (/xiaohongshu\.com|xhslink\.com/u.test(browserRequest.url())) {
      xhsRequests.push(browserRequest.url());
    }
  });
  await page.addInitScript(() => {
    (
      window as Window & {
        __MEIYE_OPENCLI_BRIDGE__?: {
          schemaVersion: 'meiye-opencli-bridge/v1';
          ready: boolean;
          readXhsNote(): Promise<never>;
        };
      }
    ).__MEIYE_OPENCLI_BRIDGE__ = {
      schemaVersion: 'meiye-opencli-bridge/v1',
      ready: true,
      async readXhsNote() {
        throw new Error('fixture upstream included protected input');
      },
    };
  });

  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.getByTestId('suggestion-chip-viral_adapt').click();
  await page
    .getByTestId('viral-adapt-opencli-link')
    .fill(
      'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret'
    );
  await page.getByTestId('viral-adapt-opencli-action').click();

  const error = page.getByRole('alert');
  await expect(error).toContainText('读取失败');
  await expect(error).not.toContainText(
    /xiaohongshu\.com|xsec_token|fixture-secret/u
  );
  await page.getByTestId('viral-adapt-opencli-fallback').click();
  await expect(page.getByTestId('viral-adapt-paste-text')).toBeEnabled();
  expect(xhsRequests).toEqual([]);
});
