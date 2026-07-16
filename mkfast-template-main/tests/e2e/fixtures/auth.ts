import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_TEST_SECRET, type E2EUser, createE2EUser } from './test-data';

const e2eHeaders = {
  'x-e2e-secret': E2E_TEST_SECRET,
};

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.delete(`${authOrigin()}/api/e2e/users`, {
        headers: e2eHeaders,
      });
      expect(response.status()).toBeLessThan(500);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
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

export async function loginByForm(page: Page, user: E2EUser) {
  const targetOrigin = applicationOrigin();
  await page.goto(`${targetOrigin}/auth/login`);
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  const signInButton = page.getByRole('button', {
    name: /^sign in$|^登录$/i,
  });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(page).toHaveURL(
    (url) => url.origin === targetOrigin && url.pathname === '/dashboard'
  );
}
