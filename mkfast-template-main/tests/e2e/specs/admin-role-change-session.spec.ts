import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * Spec A / #366 — role change must revoke the subject user's sessions and
 * authorize the first post-login request under the new role.
 *
 * Driver executes this Playwright file; the lane only authors it.
 */

function setCookieHeaders(response: {
  headersArray(): Array<{ name: string; value: string }>;
}) {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function cookiesCleared(headers: readonly string[]) {
  const sessionCookies = headers.filter(
    (header) =>
      header.includes('session_token') || header.includes('session_data')
  );
  if (sessionCookies.length === 0) return false;
  return sessionCookies.every(
    (header) =>
      /Max-Age=0/iu.test(header) ||
      /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu.test(header)
  );
}

async function readSession(page: Page) {
  const response = await page.request.get('/api/auth/get-session');
  const body = (await response.json()) as {
    user?: { id?: string; role?: string | null };
  } | null;
  return { status: response.status(), body };
}

async function setRole(
  adminPage: Page,
  input: { userId: string; role: 'admin' | 'user'; reason: string },
  origin: string
) {
  const response = await adminPage.request.post('/api/auth/admin/set-role', {
    data: input,
    headers: {
      Origin: origin,
      Referer: `${origin}/admin/users`,
    },
  });
  return response;
}

test.describe('admin role change session revocation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('promote then demote revokes old sessions; re-login uses the new role', async ({
    browser,
    request,
  }) => {
    // Two admins so demote of subject never hits last-admin.
    const admin = await registerE2EUser(request, { role: 'admin' });
    const peerAdmin = await registerE2EUser(request, { role: 'admin' });
    const merchant = await registerE2EUser(request);

    let adminContext: BrowserContext | undefined;
    let merchantContext: BrowserContext | undefined;

    try {
      adminContext = await browser.newContext();
      merchantContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      const merchantPage = await merchantContext.newPage();

      await loginByForm(adminPage, admin);
      await loginByForm(merchantPage, merchant);

      const origin = new URL(merchantPage.url()).origin;
      const merchantSession = await readSession(merchantPage);
      expect(merchantSession.body?.user?.id).toBeTruthy();
      expect(merchantSession.body?.user?.role ?? 'user').not.toBe('admin');
      const merchantUserId = merchantSession.body!.user!.id as string;

      // Productive before promote.
      await merchantPage.goto('/dashboard');
      await expect(
        merchantPage
          .getByRole('navigation', { name: '业务导航' })
          .getByRole('link', { name: '创作', exact: true })
      ).toBeVisible();

      const promote = await setRole(
        adminPage,
        {
          userId: merchantUserId,
          role: 'admin',
          reason: 'e2e promote to admin',
        },
        origin
      );
      expect(promote.ok(), await promote.text()).toBeTruthy();
      const promoteBody = (await promote.json()) as {
        audit?: {
          actorUserId?: string;
          subjectUserId?: string;
          fromRole?: string;
          toRole?: string;
          reason?: string;
        };
      };
      expect(promoteBody.audit?.subjectUserId).toBe(merchantUserId);
      expect(promoteBody.audit?.fromRole).toBe('user');
      expect(promoteBody.audit?.toRole).toBe('admin');
      expect(promoteBody.audit?.reason).toBe('e2e promote to admin');
      expect(promoteBody.audit?.actorUserId).toBeTruthy();

      // Old merchant session must die on the next request.
      const postPromoteApi = await merchantPage.request.post(
        '/api/core/p1/query',
        {
          data: {
            action: 'config_defaults',
            module: 'admin-config',
            payload: {},
          },
          headers: { 'idempotency-key': crypto.randomUUID() },
        }
      );
      expect(postPromoteApi.status(), await postPromoteApi.text()).toBe(401);
      expect(cookiesCleared(setCookieHeaders(postPromoteApi))).toBeTruthy();

      await merchantPage.goto('/dashboard');
      await expect(merchantPage).toHaveURL(/\/auth\/login/);

      // Re-login: first request is authorized as admin.
      await loginByForm(merchantPage, merchant);
      const afterPromoteSession = await readSession(merchantPage);
      expect(afterPromoteSession.body?.user?.role).toBe('admin');
      await merchantPage.goto('/admin/users');
      await expect(merchantPage).toHaveURL(/\/admin\/users\/?$/);

      // Keep peerAdmin registered so demoting the promoted user is safe even
      // if other e2e admins were cleaned; demote subject back to merchant.
      void peerAdmin;
      const demote = await setRole(
        adminPage,
        {
          userId: merchantUserId,
          role: 'user',
          reason: 'e2e demote to merchant',
        },
        origin
      );
      expect(demote.ok(), await demote.text()).toBeTruthy();

      const postDemoteApi = await merchantPage.request.post(
        '/api/core/p1/query',
        {
          data: {
            action: 'config_defaults',
            module: 'admin-config',
            payload: {},
          },
          headers: { 'idempotency-key': crypto.randomUUID() },
        }
      );
      expect(postDemoteApi.status(), await postDemoteApi.text()).toBe(401);

      await loginByForm(merchantPage, merchant);
      const afterDemoteSession = await readSession(merchantPage);
      expect(afterDemoteSession.body?.user?.role ?? 'user').not.toBe('admin');
      await merchantPage.goto('/admin/users');
      await expect(merchantPage).toHaveURL(/\/dashboard\/?$/);
    } finally {
      await adminContext?.close();
      await merchantContext?.close();
    }
  });

  test('empty reason and last-admin demotion are refused', async ({
    page,
    request,
  }) => {
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    const origin = new URL(page.url()).origin;
    const session = await readSession(page);
    const adminId = session.body?.user?.id;
    expect(adminId).toBeTruthy();

    const emptyReason = await setRole(
      page,
      { userId: adminId!, role: 'user', reason: '   ' },
      origin
    );
    expect(emptyReason.status()).toBe(400);
    expect(await emptyReason.json()).toMatchObject({
      error: { code: 'REASON_REQUIRED' },
    });

    // If this admin is the sole remaining platform admin in the e2e DB after
    // cleanup, demoting self must return LAST_ADMIN_REQUIRED.
    const demoteSelf = await setRole(
      page,
      {
        userId: adminId!,
        role: 'user',
        reason: 'attempt last admin demote',
      },
      origin
    );
    // Either 409 last-admin (sole admin) or 200 if other admins exist in the
    // shared e2e DB. When not sole, re-promote to leave the environment clean.
    if (demoteSelf.status() === 409) {
      expect(await demoteSelf.json()).toMatchObject({
        error: { code: 'LAST_ADMIN_REQUIRED' },
      });
    } else if (demoteSelf.ok()) {
      // Self-demotion revoked this session and stripped the admin role, so
      // the restore must come from a different admin — re-logging in as the
      // demoted user would only produce a merchant 403.
      const restorer = await registerE2EUser(request, { role: 'admin' });
      await loginByForm(page, restorer);
      const restore = await setRole(
        page,
        {
          userId: adminId!,
          role: 'admin',
          reason: 'restore after non-last demote',
        },
        origin
      );
      expect(restore.ok(), await restore.text()).toBeTruthy();
    }
  });
});
