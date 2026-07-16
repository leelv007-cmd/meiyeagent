import { expect, test } from '@playwright/test';
import type { ApiEnvelope, ProductState } from '@meiye/contracts';
import postgres from 'postgres';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productCommand } from '../fixtures/product';

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('stores and authorizes a real workspace asset through R2 and Core', async ({
  browser,
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  const member = await registerE2EUser(request);
  const sql = postgres(
    process.env.DATABASE_URL ?? 'postgres://meiye:meiye@127.0.0.1:54329/meiye',
    { max: 1 }
  );
  try {
    await loginByForm(page, user);
    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天预约',
        brandVoice: '专业、克制、像熟客推荐',
        city: '杭州',
        district: '拱墅区',
        name: 'E2E 美业门店',
        prohibitions: ['不虚构价格'],
        projects: [
          {
            confirmed: true,
            durationMinutes: 90,
            id: 'project-asset-upload',
            name: '透亮猫眼',
            price: 299,
          },
        ],
        regulated: false,
      },
    });
    await page.goto('/dashboard/assets');
    await page.locator('input[type="file"]').last().setInputFiles({
      name: 'real-store-fixture.png',
      mimeType: 'image/png',
      buffer: PNG_FIXTURE,
    });

    await page.getByRole('link', { name: '确认这张素材能否用于宣传' }).click();
    await expect(page).toHaveURL(/\/dashboard\/assets\/asset-/);
    const authorize = page.getByRole('button', {
      name: /确认公开营销授权/,
    });
    await expect(authorize).toBeDisabled();
    await page
      .getByLabel('授权凭证编号或存档位置')
      .fill('e2e-owner-consent-archive-001');
    await expect(authorize).toBeEnabled();
    await authorize.click();
    await expect(page.getByText('公开营销可用')).toBeVisible();

    const objectKey = await page.evaluate(async () => {
      const response = await fetch('/api/core/product/state');
      const payload = (await response.json()) as ApiEnvelope<ProductState>;
      if ('error' in payload) throw new Error(payload.error.message);
      return payload.data.assets.at(-1)?.objectKey;
    });
    expect(objectKey).toMatch(
      /^ws_.+\/assets\/.+\/[^/]*real-store-fixture\.png$/
    );

    const downloadStatus = await page.evaluate(async (key) => {
      const response = await fetch(
        `/api/storage/file?key=${encodeURIComponent(key)}`
      );
      return response.status;
    }, objectKey ?? '');
    expect(downloadStatus).toBe(200);

    const [ownerWorkspace] = await sql<
      Array<{ userId: string; workspaceId: string }>
    >`
      SELECT u.id AS "userId", wm.workspace_id AS "workspaceId"
      FROM "user" u
      INNER JOIN workspace_memberships wm ON wm.user_id = u.id
      WHERE u.email = ${user.email}
      ORDER BY wm.created_at, wm.workspace_id
      LIMIT 1
    `;
    const [memberWorkspace] = await sql<
      Array<{ userId: string; workspaceId: string }>
    >`
      SELECT u.id AS "userId", wm.workspace_id AS "workspaceId"
      FROM "user" u
      INNER JOIN workspace_memberships wm ON wm.user_id = u.id
      WHERE u.email = ${member.email}
      ORDER BY wm.created_at, wm.workspace_id
      LIMIT 1
    `;
    expect(ownerWorkspace).toBeTruthy();
    expect(memberWorkspace).toBeTruthy();

    await sql`
      INSERT INTO user_files (
        id, user_id, filename, original_name, content_type, size, r2_key,
        is_public, created_at, updated_at
      ) VALUES (
        'trigger-workspace-proof', ${memberWorkspace?.userId}, 'proof.png',
        'proof.png', 'image/png', 1, 'trigger-workspace-proof.png', false,
        NOW(), NOW()
      )
    `;
    const [triggerRecord] = await sql<Array<{ workspaceId: string }>>`
      SELECT workspace_id AS "workspaceId"
      FROM user_files
      WHERE id = 'trigger-workspace-proof'
    `;
    expect(triggerRecord?.workspaceId).toBe(memberWorkspace?.workspaceId);

    const [fileRecord] = await sql<Array<{ workspaceId: string }>>`
      SELECT workspace_id AS "workspaceId"
      FROM user_files
      WHERE r2_key = ${objectKey ?? ''}
    `;
    expect(fileRecord?.workspaceId).toBe(ownerWorkspace?.workspaceId);

    await sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (${ownerWorkspace?.workspaceId}, ${memberWorkspace?.userId}, 'operator')
      ON CONFLICT DO NOTHING
    `;

    const memberPage = await browser.newPage();
    try {
      await loginByForm(memberPage, member);
      const sharedWorkspaceStatus = await memberPage.evaluate(async (key) => {
        const response = await fetch(
          `/api/storage/file?key=${encodeURIComponent(key)}`
        );
        return response.status;
      }, objectKey ?? '');
      expect(sharedWorkspaceStatus).toBe(200);
    } finally {
      await memberPage.close();
    }

    await sql`
      UPDATE user_files
      SET workspace_id = ${memberWorkspace?.workspaceId}
      WHERE r2_key = ${objectKey ?? ''}
    `;
    const crossWorkspaceStatus = await page.evaluate(async (key) => {
      const response = await fetch(
        `/api/storage/file?key=${encodeURIComponent(key)}`
      );
      return response.status;
    }, objectKey ?? '');
    expect(crossWorkspaceStatus).toBe(403);
  } finally {
    await sql.end();
    await cleanupE2EUsers(request);
  }
});
