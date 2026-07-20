import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

test('product chrome consumes the floating glass and ambient shell tokens', () => {
  const styles = readSource('src/styles.css');

  assert.match(
    styles,
    /--ambient-image:\s*url\("\/seed\/store\/store-artist-working\.webp"\)/u
  );
  assert.match(
    styles,
    /\.meiye-product-shell\[data-shell-mode="product"\]\[data-slot="sidebar-wrapper"\]::before\s*\{[\s\S]*?height:\s*max\(100svh, 720px\)/u
  );
  assert.match(
    styles,
    /\[data-slot="sidebar-container"\]\s*\{[\s\S]*?padding:\s*12px/u
  );
  assert.match(
    styles,
    /\[data-slot="sidebar-inner"\]\s*\{[\s\S]*?backdrop-filter:\s*blur\(64px\)[\s\S]*?border-radius:\s*24px/u
  );
  assert.match(
    styles,
    /\.meiye-product-shell \[data-slot="sidebar-container"\][\s\S]*?pointer-events:\s*none/u
  );
  assert.match(
    styles,
    /\.meiye-product-shell \[data-slot="sidebar-inner"\],[\s\S]*?pointer-events:\s*auto/u
  );
});

test('workbench top-level states keep ambient copy readable and entry cards thematic', () => {
  const styles = readSource('src/styles.css');
  const workbench = readSource('src/product/unified-creation-workbench.tsx');
  const dashboardLayout = readSource(
    'src/components/layout/dashboard-layout.tsx'
  );
  const recommendation = readSource(
    'src/product/today-recommendation-card.tsx'
  );
  const creationEntry = readSource('src/product/creation-entry.tsx');
  const button = readSource('src/components/ui/button.tsx');

  assert.match(
    workbench,
    /heroVisible[\s\S]*?<h1[^>]*text-white[\s\S]*?workbench_greeting/u
  );
  assert.match(
    workbench,
    /recordVisible[\s\S]*?<Button[\s\S]*?variant="outline"[\s\S]*?workbench_new_creation/u
  );
  assert.match(button, /outline:\s*"bg-surface-2/u);
  assert.match(
    workbench,
    /className="meiye-ambient-copy"[\s\S]*?meiye-type-title[\s\S]*?meiye-type-aux/u
  );
  assert.match(
    dashboardLayout,
    /className="meiye-ambient-copy"[\s\S]*?meiye-type-title[\s\S]*?meiye-type-aux/u
  );
  assert.match(
    styles,
    /\.meiye-ambient-copy[\s\S]*?\.meiye-type-title[\s\S]*?color:\s*var\(--ambient-text\)[\s\S]*?\.meiye-ambient-copy[\s\S]*?\.meiye-type-aux[\s\S]*?color:\s*var\(--ambient-text\)/u
  );
  assert.match(recommendation, /meiye-entry-card/u);
  assert.match(creationEntry, /meiye-entry-card/u);
  assert.match(
    styles,
    /\.light \.meiye-product-shell\[data-shell-mode="product"\][\s\S]*?\.meiye-entry-card\s*\{[\s\S]*?background:\s*var\(--paper\)\s*!important;[\s\S]*?color:\s*var\(--ink-90\)/u
  );
  assert.match(
    styles,
    /\.dark \.meiye-product-shell\s*\{[\s\S]*?--paper:\s*oklch\(0\.21 0 0\)/u
  );
});

test('merchant header exposes a localized non-subscriber pricing entry', () => {
  const header = readSource('src/components/layout/dashboard-header.tsx');
  const styles = readSource('src/styles.css');
  const zh = readSource('project.inlang/messages/zh.json');
  const en = readSource('project.inlang/messages/en.json');

  assert.match(header, /useCurrentPlan/u);
  assert.match(header, /useCurrentPlan\(!isAdmin\)/u);
  assert.match(header, /currentPlan\.isSuccess/u);
  assert.match(header, /!currentPlan\.data\?\.currentPlan\?\.isLifetime/u);
  assert.match(header, /!currentPlan\.data\?\.subscription/u);
  assert.match(header, /Routes\.Pricing/u);
  assert.match(header, /shell_product_subscription_upgrade/u);
  assert.match(header, /IconSparkles/u);
  assert.match(
    styles,
    /\.meiye-product-shell \.meiye-topbar-capsule\s*\{[\s\S]*?padding:\s*4px 8px 4px 12px/u
  );
  assert.match(
    styles,
    /\.light \.meiye-product-shell\[data-shell-mode="product"\][\s\S]*?\.meiye-product-subscription-entry\s*\{[\s\S]*?background:\s*var\(--paper\)[\s\S]*?color:\s*var\(--ink-90\)/u
  );
  assert.match(
    zh,
    /"shell_product_subscription_upgrade":\s*"订阅 \/ 升级本产品套餐"/u
  );
  assert.match(
    en,
    /"shell_product_subscription_upgrade":\s*"Subscribe \/ upgrade product plan"/u
  );
});

test('current plan query stays warm across product route navigation', () => {
  const paymentHook = readSource('src/hooks/use-payment.ts');

  assert.match(paymentHook, /staleTime:\s*5 \* 60 \* 1000/u);
  assert.match(paymentHook, /refetchOnWindowFocus:\s*false/u);
});

test('delivery attention copy localizes the revision in both locales', () => {
  const zh = JSON.parse(readSource('project.inlang/messages/zh.json'));
  const en = JSON.parse(readSource('project.inlang/messages/en.json'));

  assert.equal(
    zh.legacy_projection_delivery_needs_attention,
    '成品需处理 · 第 {revision} 版'
  );
  assert.equal(
    en.legacy_projection_delivery_needs_attention,
    'Deliverable needs attention · revision {revision}'
  );
});

test('theme menu offers an actual dark choice and product chrome styles it', () => {
  const modeSwitcher = readSource('src/components/theme/mode-switcher.tsx');
  const themeProvider = readSource('src/components/theme/theme-provider.tsx');
  const styles = readSource('src/styles.css');

  assert.match(modeSwitcher, /setTheme\('dark'\)/u);
  assert.match(themeProvider, /root\.classList\.remove\('light', 'dark'\)/u);
  assert.match(themeProvider, /root\.classList\.add\(targetTheme\)/u);
  assert.match(
    styles,
    /\.dark \.meiye-product-shell\s*\{[\s\S]*?--glass-edge:/u
  );
  assert.match(styles, /\.meiye-topbar-capsule[\s\S]*?\[data-slot="badge"\]/u);
});
