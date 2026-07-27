import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

/**
 * S7 / U07 换壳后的槽位口径：HeroUI Pro Sidebar 把 shadcn 的
 * wrapper→gap→container→inner 四层塌成 provider→aside 两层，inset 改叫 main。
 * 氛围层仍在 styles.css（它压的是自家内容，不与 vendored 表撞名），侧栏本体搬到
 * heroui-glass.css（无 layer，才压得过 `.sidebar` / `.sidebar--floating`）。
 */
test('product chrome consumes the floating glass and ambient shell tokens', () => {
  const styles = readSource('src/styles.css');
  const glass = readSource('src/components/heroui-pro/heroui-glass.css');

  assert.match(
    styles,
    /--ambient-image:\s*url\("\/seed\/store\/store-artist-working\.webp"\)/u
  );
  assert.match(
    styles,
    /\.meiye-product-shell\[data-shell-mode="product"\]\[data-slot="sidebar-provider"\]::before\s*\{[\s\S]*?height:\s*max\(100svh, 720px\)/u
  );
  assert.match(
    glass,
    /\.meiye-product-shell \[data-slot="sidebar"\]\s*\{[\s\S]*?backdrop-filter:\s*blur\(var\(--meiye-blur-shell\)\)[\s\S]*?border-radius:\s*24px[\s\S]*?margin:\s*12px/u
  );
  assert.match(
    glass,
    /\.meiye-product-shell \[data-slot="sidebar"\]\s*\{[\s\S]*?--sidebar-width-collapsed:\s*74px/u
  );
  // 药丸导航行是本产品自己的 <Link>，不是 Pro 的 role="row" 菜单行。
  assert.match(
    styles,
    /\.meiye-product-shell \.meiye-sidebar-nav-item\s*\{[\s\S]*?border-radius:\s*999px/u
  );
  assert.match(
    styles,
    /\.meiye-product-shell \[data-slot="sidebar"\]\s*\{\s*z-index:\s*var\(--layer-sidebar\)/u
  );
});

test('Composer and Result Center keep the product shell contract', () => {
  const styles = readSource('src/styles.css');
  const composer = readSource('src/product/composer/composer-home.tsx');
  const resultCenter = readSource('src/product/results/result-center-page.tsx');
  const dashboardLayout = readSource(
    'src/components/layout/dashboard-layout.tsx'
  );
  const recommendation = readSource(
    'src/product/today-recommendation-card.tsx'
  );
  const button = readSource('src/components/ui/button.tsx');

  assert.match(composer, /data-testid="composer-home"/u);
  assert.match(resultCenter, /data-testid="result-center-shell"/u);
  assert.match(button, /outline:\s*"bg-surface-2/u);
  assert.match(
    dashboardLayout,
    /className="meiye-ambient-copy"[\s\S]*?meiye-type-title[\s\S]*?meiye-type-aux/u
  );
  assert.match(
    styles,
    /\.meiye-ambient-copy[\s\S]*?\.meiye-type-title[\s\S]*?color:\s*var\(--ambient-text\)[\s\S]*?\.meiye-ambient-copy[\s\S]*?\.meiye-type-aux[\s\S]*?color:\s*var\(--ambient-text\)/u
  );
  assert.match(recommendation, /meiye-entry-card/u);
  assert.match(composer, /meiye-entry-card/u);
  assert.match(
    styles,
    /\.light \.meiye-product-shell\[data-shell-mode="product"\][\s\S]*?\.meiye-entry-card\s*\{[\s\S]*?background:\s*var\(--paper\)\s*!important;[\s\S]*?color:\s*var\(--ink-90\)/u
  );
  assert.match(
    styles,
    /\.dark \.meiye-product-shell\s*\{[\s\S]*?--paper:\s*oklch\(0\.21 0 0\)/u
  );
});

test('HeroUI empty-state foreground mapping is owned by the shared product layer', () => {
  const glass = readSource('src/components/heroui-pro/heroui-glass.css');
  const works = readSource('src/product/works/works-list-page.tsx');

  assert.match(
    glass,
    /\.meiye-product-shell \[data-slot="empty-state"\]\s*\{[\s\S]*?--muted:\s*var\(--ink-60\)/u
  );
  assert.doesNotMatch(
    works,
    /style=\{\{\s*'--muted':\s*'var\(--ink-60\)'\s*\}\s*as CSSProperties\}/u
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

test('mobile product portals inherit the product theme and clear the bottom navigation', () => {
  const sidebarLayout = readSource('src/components/layout/sidebar-layout.tsx');
  const composerSheet = readSource(
    'src/product/composer/composer-bottom-sheet-ui.tsx'
  );
  const imageAdjust = readSource(
    'src/product/results/image-adjust-confirmation.tsx'
  );
  const dialog = readSource('src/components/ui/dialog.tsx');
  const select = readSource('src/components/ui/select.tsx');
  const toaster = readSource('src/components/shared/toaster.tsx');

  assert.match(
    sidebarLayout,
    /document\.body\.classList\.add\('meiye-product-shell'\)/u
  );
  assert.match(
    sidebarLayout,
    /pb-\[calc\(5\.25rem\+env\(safe-area-inset-bottom\)\)\]/u
  );
  assert.match(composerSheet, /data-product-modal="composer-bottom-sheet"/u);
  assert.match(composerSheet, /className=\{cn\(\s*'meiye-product-shell/u);
  assert.match(composerSheet, /aria-modal="true"/u);
  assert.match(composerSheet, /finalFocus=/u);
  assert.match(imageAdjust, /data-product-modal="image-adjust-confirmation"/u);
  assert.match(imageAdjust, /meiye-product-shell/u);
  assert.match(imageAdjust, /finalFocus=/u);
  // Shared Dialog primitive always exposes a single aria-modal surface.
  assert.match(dialog, /"aria-modal":\s*ariaModal\s*=\s*true/u);
  // Portal Select + Toast consume product/theme tokens, not hard-coded light only.
  assert.match(select, /bg-surface-2/u);
  assert.match(select, /text-popover-foreground/u);
  assert.match(toaster, /resolvedTheme/u);
  assert.match(toaster, /--normal-bg':\s*'var\(--popover\)'/u);
});
