import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_NAVIGATION,
  resolveAdminP1Redirect,
  resolveLegacyRedirect,
  resolveTrustedReturnAnchor,
} from './navigation';
import {
  ADMIN_SIDEBAR_ITEMS,
  BUSINESS_SIDEBAR_ITEMS,
  SETTINGS_SIDEBAR_ITEMS,
} from '../../config/sidebar-config';
import { overwriteGetLocale } from '../../locale/paraglide/runtime';
import { Routes } from '../routes';

test('merchant navigation exposes only creation, content, assets, and store', () => {
  assert.deepEqual(
    BUSINESS_NAVIGATION.map(({ href, label }) => ({ href, label })),
    [
      { href: '/dashboard', label: '创作' },
      { href: '/dashboard/content', label: '内容' },
      { href: '/dashboard/assets', label: '素材' },
      { href: '/dashboard/store', label: '门店' },
    ]
  );
});

test('tasks and leads keep stable secondary routes after leaving navigation', () => {
  assert.equal(Routes.TaskInbox, '/dashboard/tasks');
  assert.equal(Routes.LeadLedger, '/dashboard/leads');
  const firstLevelHrefs = BUSINESS_NAVIGATION.map(({ href }) => String(href));
  assert.equal(firstLevelHrefs.includes(Routes.TaskInbox), false);
  assert.equal(firstLevelHrefs.includes(Routes.LeadLedger), false);
});

test('shared navigation labels resolve in the active locale at access time', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(BUSINESS_NAVIGATION[0].label, '创作');
  assert.equal(SETTINGS_SIDEBAR_ITEMS[0].label, '账户');
  assert.equal(ADMIN_SIDEBAR_ITEMS[0].label, '模型供应');

  overwriteGetLocale(() => 'en');
  assert.equal(BUSINESS_NAVIGATION[0].label, 'Create');
  assert.equal(BUSINESS_SIDEBAR_ITEMS[0].label, 'Create');
  assert.equal(SETTINGS_SIDEBAR_ITEMS[0].label, 'Account');
  assert.equal(ADMIN_SIDEBAR_ITEMS[0].label, 'Model supply');

  overwriteGetLocale(() => 'zh');
});

test('legacy locations redirect only through the frozen internal table', () => {
  assert.equal(
    resolveLegacyRedirect('/settings/profile'),
    '/settings/account?section=profile'
  );
  assert.equal(resolveLegacyRedirect('/settings/files'), '/dashboard/assets');
  assert.equal(
    resolveLegacyRedirect('/settings/credits'),
    '/settings/account?section=usage'
  );
  assert.equal(
    resolveLegacyRedirect('/dashboard/store?tab=assets'),
    '/dashboard/assets'
  );
  assert.equal(resolveLegacyRedirect('/admin/p1?tab=models'), '/admin/models');
  assert.equal(resolveAdminP1Redirect('templates'), '/admin/templates');
  assert.equal(resolveAdminP1Redirect('integrations'), '/admin/integrations');
  assert.equal(resolveAdminP1Redirect('unknown'), '/admin/models');
  assert.equal(resolveLegacyRedirect('/dashboard#new-content'), '/dashboard');
  assert.equal(resolveLegacyRedirect('https://evil.example/steal'), undefined);
  assert.equal(resolveLegacyRedirect('/not-legacy'), undefined);
});

test('trusted return anchors are typed object locations rather than open URLs', () => {
  assert.equal(
    resolveTrustedReturnAnchor({
      action: 'model',
      objectId: 'work-123',
      objectType: 'work',
    }),
    '/dashboard/works/work-123?focus=model'
  );
  assert.equal(
    resolveTrustedReturnAnchor({
      action: 'publish',
      objectId: 'content:42',
      objectType: 'content',
    }),
    '/dashboard/content/content%3A42?focus=publish'
  );
  assert.equal(
    resolveTrustedReturnAnchor({
      action: 'model',
      objectId: 'https://evil.example',
      objectType: 'work',
    }),
    undefined
  );
  assert.equal(
    resolveTrustedReturnAnchor({
      action: 'unknown',
      objectId: 'work-123',
      objectType: 'work',
    }),
    undefined
  );
});
