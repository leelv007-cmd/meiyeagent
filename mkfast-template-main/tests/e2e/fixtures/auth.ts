import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_TEST_SECRET, type E2EUser, createE2EUser } from './test-data';

const e2eHeaders = {
  'x-e2e-secret': E2E_TEST_SECRET,
};
const E2E_CLEANUP_TIMEOUT_MS = 15_000;

function applicationOrigin() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return process.env.PLAYWRIGHT_BASE_URL;
  }
  if (process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true') {
    return `http://localhost:${
      process.env.PLAYWRIGHT_CANDIDATE_PORT ?? '3010'
    }`;
  }
  return `http://localhost:${process.env.PORT ?? '3000'}`;
}

function authOrigin() {
  return process.env.PLAYWRIGHT_AUTH_BASE_URL ?? applicationOrigin();
}

export async function cleanupE2EUsers(request: APIRequestContext) {
  let lastError: unknown;
  const deadline = Date.now() + E2E_CLEANUP_TIMEOUT_MS;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.delete(`${authOrigin()}/api/e2e/users`, {
        headers: e2eHeaders,
        timeout: Math.max(1, deadline - Date.now()),
      });
      expect(response.status()).toBeLessThan(500);
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = Math.min(100, deadline - Date.now());
      if (attempt >= 2 || retryDelay <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw lastError;
}

export async function registerE2EUser(
  request: APIRequestContext,
  overrides: Partial<E2EUser> = {}
) {
  const user = createE2EUser(overrides);
  const origin = authOrigin();
  const response = await request.post(`${origin}/api/auth/sign-up/email`, {
    headers: {
      Origin: origin,
      Referer: `${origin}/auth/register`,
    },
    data: {
      email: user.email,
      password: user.password,
      name: user.name,
      callbackURL: '/dashboard',
    },
  });

  expect(response.ok(), await response.text()).toBeTruthy();

  await updateE2EUser(request, {
    email: user.email,
    emailVerified: true,
    role: user.role ?? 'user',
  });

  return user;
}

export async function updateE2EUser(
  request: APIRequestContext,
  data: {
    email: string;
    emailVerified?: boolean;
    role?: 'admin' | 'user' | null;
  }
) {
  const response = await request.patch(`${authOrigin()}/api/e2e/users`, {
    headers: e2eHeaders,
    data,
  });

  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function ageE2EUserSessions(
  request: APIRequestContext,
  email: string,
  createdAt: string
) {
  const response = await request.patch(`${authOrigin()}/api/e2e/users`, {
    headers: e2eHeaders,
    data: { email, sessionCreatedAt: createdAt },
  });

  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function loginByForm(page: Page, user: E2EUser) {
  const targetOrigin = applicationOrigin();
  await page.goto(`${targetOrigin}/auth/login`);
  await expect(
    page.locator('form[data-auth-login-hydrated="true"]')
  ).toBeVisible({ timeout: 30_000 });
  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  await expect(emailInput).toBeVisible({ timeout: 30_000 });
  await expect(passwordInput).toBeVisible({ timeout: 30_000 });
  await emailInput.fill(user.email);
  await passwordInput.fill(user.password);
  const signInButton = page.getByRole('button', {
    name: /^sign in$|^登录$/i,
  });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(page).toHaveURL(
    (url) => url.origin === targetOrigin && url.pathname === '/dashboard',
    { timeout: 30_000 }
  );
  // URL can land while `/dashboard` still shows DashboardPending
  // ("正在打开内容簿"). Greeting is the first node of the real workbench.
  await expect(page.getByTestId('dashboard-greeting')).toBeVisible({
    timeout: 60_000,
  });
}

export async function signOut(page: Page) {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return { body: await result.text(), ok: result.ok };
  });
  expect(response.ok, response.body).toBeTruthy();
}
