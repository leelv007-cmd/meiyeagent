/**
 * V31-87 — same-content reupload across library and composer.
 *
 * Asset page authorize, then composer inline reupload of the same bytes.
 * Must not 409 IDEMPOTENCY_CONFLICT, and must not insert a second asset.
 * Full-stack run belongs to the master; this file must --list.
 */
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { authorizeLatestLibraryAssetAsCustomerCase } from '../fixtures/library-source';
import { productCommand, productState } from '../fixtures/product';
import { openComposerCapsule } from '../fixtures/ui-journey';

const CASE_PHOTO = await readFile(
  new URL(
    '../../../public/model-previews/image-beauty-preview.png',
    import.meta.url
  )
);

test.describe('V31-87 同内容跨面重传', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('素材页授权后再在 composer 内联重传同图不 409 且不重复建资产', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '文三路 100 号',
        booking: '电话或微信提前一天预约',
        brandVoice: '专业、克制',
        city: '杭州',
        district: '西湖区',
        name: '盘点美发工作室',
        prohibitions: ['不虚构价格'],
        projects: [
          {
            confirmed: true,
            durationMinutes: 90,
            id: 'project-v31-87',
            name: '头皮护理',
            price: 388,
          },
        ],
        regulated: false,
      },
    });

    await page.goto('/dashboard/assets');
    await expect(page.locator('#canonical-asset-upload')).toBeAttached({
      timeout: 60_000,
    });
    await page.locator('#canonical-asset-upload').setInputFiles({
      buffer: CASE_PHOTO,
      mimeType: 'image/png',
      name: 'v31-87-case.png',
    });
    const authorized = await authorizeLatestLibraryAssetAsCustomerCase(page);

    const commandStatuses: number[] = [];
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/product/commands')
      ) {
        commandStatuses.push(response.status());
      }
    });

    await page.goto('/dashboard');
    await openComposerCapsule(page, 'attach');
    const galleryInput = page.locator('#composer-gallery-input');
    await expect(galleryInput).toBeAttached({ timeout: 30_000 });
    await galleryInput.setInputFiles({
      buffer: CASE_PHOTO,
      mimeType: 'image/png',
      name: 'v31-87-case.png',
    });
    const oneClickYes = page.getByRole('button', {
      name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
    });
    await expect(oneClickYes).toBeVisible({ timeout: 30_000 });
    await oneClickYes.click();
    await expect(
      page.getByText(/已保存到素材库|素材信息已确认|Saved to assets/).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/图片上传失败，请重试|Image upload failed/)
    ).toHaveCount(0);

    expect(commandStatuses.some((status) => status === 409)).toBe(false);

    const state = await productState(page);
    const sameObject = state.assets.filter(
      (asset) => asset.objectKey === authorized.objectKey
    );
    expect(sameObject).toHaveLength(1);
    expect(sameObject[0]?.id).toBe(authorized.id);
  });
});
