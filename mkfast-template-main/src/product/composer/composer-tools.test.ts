/**
 * Home tools strip caps + Pro Studio banner (C3 / #97, D-078 / D-092).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDINARY_TOOL_CAP,
  assertProStudioCanonicalHref,
  listOrdinaryHomeTools,
  openComposerTool,
  projectComposerToolsStrip,
  projectProStudioBanner,
} from './composer-tools';
import type { ComposerToolEntrySeed } from './tool-entry-seeds';
import { COMPOSER_TOOL_ENTRY_SEEDS } from './tool-entry-seeds';

test('desktop ordinary cap is 3, mobile is 2', () => {
  assert.equal(ORDINARY_TOOL_CAP.desktop, 3);
  assert.equal(ORDINARY_TOOL_CAP.mobile, 2);

  const desktop = listOrdinaryHomeTools({ viewport: 'desktop' });
  const mobile = listOrdinaryHomeTools({ viewport: 'mobile' });
  assert.ok(desktop.length <= 3);
  assert.ok(mobile.length <= 2);
  assert.equal(mobile.length, 0);
  assert.equal(desktop.length, 0);
  // Pro Studio never appears in ordinary slots.
  assert.ok(desktop.every((t) => t.id !== 'tool.pro_studio'));
  assert.ok(mobile.every((t) => t.id !== 'tool.pro_studio'));
});

test('first-ship ordinary tools stay hidden until their full execution chain is verified', () => {
  const strip = projectComposerToolsStrip({ viewport: 'desktop' });
  assert.deepEqual(strip.ordinary, []);
  assert.ok(strip.proStudio);
});

test('Pro Studio projects as full-width banner to canonical gate', () => {
  const active = projectProStudioBanner({
    viewport: 'desktop',
    proStudioStatus: 'active',
  });
  assert.ok(active);
  assert.equal(active!.href, '/pro-studio');
  assert.equal(active!.status, 'active');
  assert.equal(active!.ctaLabel, '进入专业工作区');
  assertProStudioCanonicalHref(active!.href);

  const locked = projectProStudioBanner({
    viewport: 'mobile',
    proStudioStatus: 'locked',
    proStudioLockReason: '需要 Owner 购买',
  });
  assert.ok(locked);
  assert.equal(locked!.status, 'locked');
  assert.equal(locked!.lockReason, '需要 Owner 购买');
  assert.equal(locked!.href, '/pro-studio');
});

test('capability-unpublished tools are hidden and not counted', () => {
  const tools: ComposerToolEntrySeed[] = COMPOSER_TOOL_ENTRY_SEEDS.map((t) =>
    t.id === 'tool.subtitle_erase'
      ? { ...t, capabilityPublished: false }
      : { ...t }
  );
  const strip = projectComposerToolsStrip({
    viewport: 'desktop',
    tools,
  });
  assert.ok(strip.ordinary.every((t) => t.id !== 'tool.subtitle_erase'));
  assert.ok(strip.ordinary.length <= 3);
});

test('capability gate false hides tool even if seed published', () => {
  const strip = projectComposerToolsStrip({
    viewport: 'desktop',
    capabilityGateOpen: { 'tool.batch_bg_remove': false },
  });
  assert.ok(strip.ordinary.every((t) => t.id !== 'tool.batch_bg_remove'));
});

test('view-all tools href targets catalog tools tab', () => {
  const strip = projectComposerToolsStrip({
    viewport: 'mobile',
    returnKey: 'rk-1',
  });
  assert.ok(strip.viewAllHref.includes('/dashboard/catalog'));
  assert.ok(strip.viewAllHref.includes('tab=tools'));
  assert.ok(strip.viewAllHref.includes('returnKey=rk-1'));
});

test('openComposerTool Pro Studio rejects canvas deep-link shape', () => {
  const result = openComposerTool('tool.pro_studio');
  assert.throws(
    () => assertProStudioCanonicalHref('/canvas/session/abc'),
    /canonical gate/
  );
  assertProStudioCanonicalHref(result.href);
});
