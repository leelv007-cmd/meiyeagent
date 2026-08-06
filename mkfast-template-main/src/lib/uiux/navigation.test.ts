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
import { memory_page_description } from '../../locale/paraglide/messages';
import { Routes } from '../routes';

test('merchant navigation exposes creation, content, assets, store and memory', () => {
  assert.deepEqual(
    BUSINESS_NAVIGATION.map(({ href, label }) => ({ href, label })),
    [
      { href: '/dashboard', label: '创作' },
      // 内容 keeps its label and its place; the surface underneath it is the
      // reshelled one (T34 / #228). `/dashboard/content` is a redirect shell.
      { href: '/dashboard/works', label: '内容' },
      { href: '/dashboard/assets', label: '素材' },
      { href: '/dashboard/store', label: '门店' },
      // 经验 (nav label; route stays /dashboard/memory). D-164④ first-class
      // destination + P2-13 / D5 rename from 记忆 → 经验.
      { href: '/dashboard/memory', label: '经验' },
    ]
  );
});

test('P2-13 product copy: memory destination merchant label is 经验 / Experience', () => {
  overwriteGetLocale(() => 'zh');
  const memory = BUSINESS_NAVIGATION.find((item) => item.id === 'memory');
  assert.ok(memory);
  assert.equal(memory.label, '经验');
  assert.equal(memory.href, '/dashboard/memory');

  overwriteGetLocale(() => 'en');
  assert.equal(memory.label, 'Experience');

  overwriteGetLocale(() => 'zh');
});

test('P2-13 experience copy makes no unsupported learning-over-time promise', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(
    memory_page_description(),
    '这里是你确认过、之后创作可参考的经验。'
  );
  assert.doesNotMatch(memory_page_description(), /用得越久|越懂/u);

  overwriteGetLocale(() => 'en');
  assert.equal(
    memory_page_description(),
    'Experience you confirmed for future creations.'
  );

  overwriteGetLocale(() => 'zh');
});

test('the retired task inbox has no route constant left to point at', () => {
  assert.equal('TaskInbox' in Routes, false);
});

test('the retired lead ledger has no route constant left to point at', () => {
  assert.equal('LeadLedger' in Routes, false);
  const hrefs = BUSINESS_NAVIGATION.map(({ href }) => String(href));
  assert.equal(
    hrefs.some((href) => href.startsWith('/dashboard/leads')),
    false
  );
});

test('shared navigation labels resolve in the active locale at access time', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(BUSINESS_NAVIGATION[0].label, '创作');
  assert.equal(SETTINGS_SIDEBAR_ITEMS[0].label, '账户');
  assert.equal(ADMIN_SIDEBAR_ITEMS[0].label, '供给运行控制台');
  // D3 / #375: Recipe Studio sidebar entry removed; Templates stays reachable.
  const adminIds = ADMIN_SIDEBAR_ITEMS.map((item) => item.id as string);
  const adminHrefs = ADMIN_SIDEBAR_ITEMS.map((item) => item.href as string);
  assert.equal(adminIds.includes('recipe-studio'), false);
  assert.equal(adminHrefs.includes('/admin/recipe-studio'), false);
  assert.equal('AdminRecipeStudio' in Routes, false);
  assert.ok(
    ADMIN_SIDEBAR_ITEMS.some(
      (item) =>
        item.href === Routes.AdminTemplates && item.id === 'templates'
    )
  );
  assert.ok(
    ADMIN_SIDEBAR_ITEMS.some(
      (item) => item.href === Routes.AdminSkills && item.label === 'Skills'
    )
  );
  // Spec G / #388 remounts.
  assert.ok(
    ADMIN_SIDEBAR_ITEMS.some(
      (item) =>
        item.id === 'refund-review' && item.href === Routes.AdminRefundReview
    )
  );
  assert.ok(
    ADMIN_SIDEBAR_ITEMS.some(
      (item) =>
        item.id === 'sensitive-words' &&
        item.href === Routes.AdminSensitiveWords
    )
  );

  overwriteGetLocale(() => 'en');
  assert.equal(BUSINESS_NAVIGATION[0].label, 'Create');
  assert.equal(BUSINESS_SIDEBAR_ITEMS[0].label, 'Create');
  assert.equal(SETTINGS_SIDEBAR_ITEMS[0].label, 'Account');
  assert.equal(ADMIN_SIDEBAR_ITEMS[0].label, 'Supply operations console');

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
    '/settings/account?section=credits'
  );
  assert.equal(
    resolveLegacyRedirect('/settings/billing'),
    '/settings/account?section=credits'
  );
  assert.equal(
    resolveLegacyRedirect('/settings/payment'),
    '/settings/account?section=credits'
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
  // T34 / #228 — 旧内容库与旧任务页整批下线，两条旧地址显式跳转新面。
  assert.equal(resolveLegacyRedirect('/dashboard/content'), '/dashboard/works');
  assert.equal(resolveLegacyRedirect('/dashboard/tasks'), '/dashboard');
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
    '/dashboard/works/content%3A42?focus=publish'
  );
  // 任务 no longer has a page to return to (T34 / #228).
  assert.equal(
    resolveTrustedReturnAnchor({
      action: 'publish',
      objectId: 'task-1',
      objectType: 'task',
    }),
    undefined
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
