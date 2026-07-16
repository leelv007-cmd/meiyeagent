import { test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  localizedPath,
  setTheme,
  type LocaleMode,
  type ThemeMode,
} from '../fixtures/page-health';

const protectedPages = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/dashboard/tasks', name: 'task inbox' },
  { path: '/dashboard/assets', name: 'asset library' },
  { path: '/admin/models', name: 'admin model supply' },
  { path: '/admin/templates', name: 'admin templates' },
  { path: '/admin/integrations', name: 'admin integrations' },
  { path: '/admin/plans', name: 'admin plans' },
  { path: '/admin/users', name: 'admin users' },
  { path: '/admin/audit', name: 'admin audit' },
  { path: '/settings/account', name: 'account settings' },
  { path: '/settings/models', name: 'model settings' },
  { path: '/settings/connections', name: 'connection settings' },
] as const;

const smokeMatrix: Array<{ locale: LocaleMode; theme: ThemeMode }> = [
  { locale: 'en', theme: 'dark' },
  { locale: 'en', theme: 'light' },
  { locale: 'zh', theme: 'dark' },
  { locale: 'zh', theme: 'light' },
];

test.describe('protected page smoke coverage', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  for (const { locale, theme } of smokeMatrix) {
    test(`renders all protected pages in ${locale}/${theme}`, async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, { role: 'admin' });
      await setTheme(page, theme);
      const monitor = installPageHealthMonitor(page);

      await loginByForm(page, user);

      for (const protectedPage of protectedPages) {
        await test.step(protectedPage.name, async () => {
          await expectHealthyPage(
            page,
            monitor,
            localizedPath(protectedPage.path, locale),
            { theme }
          );
        });
      }
    });
  }
});
