import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

/**
 * Static gate for the two first-screen rules the runtime kept losing.
 *
 * DESIGN.md §3 问候语法则 — the Display layer carries the greeting and nothing
 * else, 一屏最多一处. PRODUCT.md Design Principle 1 — Composer 永远是唯一主轴,
 * so no panel opens the page above it with a metric.
 *
 * Written as a source scan (same shape as `components/layout/
 * shell-visual-contract.test.ts`) because the previous failure mode was exactly
 * a green unit test over an uncalled helper: `.meiye-greeting` had CSS,
 * `workbenchGreetingName()` had passing tests, and neither ever rendered.
 */

const readSource = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

/** Every class that means "Display, 200 weight" in this codebase. */
const DISPLAY_LAYER_CLASSES = ['meiye-greeting', 'meiye-type-display'];

/**
 * The product surface area: workbench pages plus the shell chrome around them.
 * `routes/heroui-spike/` stays out — it is a vendor spike, not a product page.
 */
const PRODUCT_SOURCE_DIRS = ['src/product', 'src/components/layout'];

function collectTsx(dir: string): string[] {
  const absolute = resolve(process.cwd(), dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(child);
    return entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx')
      ? [child]
      : [];
  });
}

/**
 * Class tokens actually handed to `className` — a docblock that names a class
 * must not count as a use of it. Covers the two forms this repo writes:
 * `className="a b"` and `className={cn('a', …)}`.
 */
function classTokens(source: string) {
  const values = [
    ...[...source.matchAll(/className="([^"]*)"/gu)].map((match) => match[1]),
    ...[...source.matchAll(/className=\{cn\(([\s\S]*?)\)\}/gu)].flatMap(
      (match) => [...match[1].matchAll(/'([^']*)'/gu)].map((cls) => cls[1])
    ),
  ];
  return values.flatMap((value) => value.split(/\s+/u));
}

test('the workbench renders exactly one Display, and it is the greeting', () => {
  const hits = PRODUCT_SOURCE_DIRS.flatMap(collectTsx).flatMap((file) => {
    const tokens = classTokens(readSource(file));
    return DISPLAY_LAYER_CLASSES.flatMap((className) =>
      tokens
        .filter((token) => token === className)
        .map(() => `${file}:${className}`)
    );
  });

  assert.deepEqual(
    hits,
    ['src/product/dashboard-home-surface.tsx:meiye-greeting'],
    'DESIGN.md §3: Display 是工作台问候语专用，一屏最多一处'
  );
});

test('the greeting is its own export and no panel rides along with it', () => {
  const surface = readSource('src/product/dashboard-home-surface.tsx');

  // 压在氛围层上的字必须在 `.meiye-ambient-copy` 里，才吃得到那一层的处理。
  assert.match(
    surface,
    /export function DashboardHomeGreeting\(\{[\s\S]*?<div className="meiye-ambient-copy">\s*<h1 className="meiye-greeting" data-testid="dashboard-greeting">/u
  );

  // The greeting goes above the Composer and the rest of the page goes below,
  // so the two must not share a component — otherwise they cannot be split.
  const restOfPage = surface.slice(
    surface.indexOf('export function DashboardHomeSurface')
  );
  assert.doesNotMatch(restOfPage, /meiye-greeting|dashboard-greeting/u);
});

/**
 * R-1 (gap-remediation-plan 2026-08-02) supersedes D-164① ordering.
 *
 * Spec §2.4 Idle order: 问候 → 分段器 → Composer → 建议行 → Shelf.
 * D-164① had 提议 → 创作 → 继续; the gap remediation plan moves suggestions
 * under the Composer main axis so first paint leads with creation.
 */
test('the workbench opens 问候语 → 分段器 → 创作 → 建议 → 继续', () => {
  const home = readSource('src/product/composer/composer-home.tsx');

  const greeting = home.indexOf('<DashboardHomeGreeting');
  const segmenter = home.indexOf('<ComposerCreationModeSegment');
  const proposal = home.indexOf('data-testid="dashboard-section-proposal"');
  const create = home.indexOf('data-testid="dashboard-section-create"');
  const continued = home.indexOf('<DashboardContinueSection');
  const composer = home.indexOf('<ComposerPromptBar');
  const recommendations = home.indexOf('<DashboardHomeSurface');

  assert.ok(greeting > -1, 'the workbench renders the greeting');
  assert.ok(
    segmenter > -1,
    'R-1: creation-mode segmenter is a first-screen control'
  );
  assert.ok(proposal > -1, '建议行 is a named section');
  assert.ok(create > -1, '创作面 is a named section');
  assert.ok(continued > -1, 'Shelf / 继续上次工作 is present');
  assert.ok(
    greeting < segmenter,
    'DESIGN.md §3: the greeting is the page opening'
  );
  assert.ok(
    segmenter < create && create < proposal && proposal < continued,
    'R-1: 问候 → 分段器 → Composer → 建议行 → Shelf'
  );

  // The sections are the page's skeleton, so each one has to actually contain
  // the surface it is named for — empty markers in the right order mean nothing.
  assert.ok(
    create < composer && composer < proposal,
    'R-1: 创作面 holds Composer above the suggestion row'
  );
  assert.ok(
    proposal < recommendations && recommendations < continued,
    'R-1: 建议行 holds the recommendation surface below Composer'
  );
});

test('P0-1: Active hides 段① without remounting it and collapses 段③', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /isWorkbenchShelfCollapsed/u);
  assert.match(home, /data-shelf-collapsed/u);
  // A late Active replay may briefly collapse the shelf after Delivered. Keep
  // the recommendation mounted so an expanded chip does not lose disclosure
  // state; native hidden still removes the section from layout/accessibility.
  assert.match(
    home,
    /<section[^>]*data-testid="dashboard-section-proposal"[^>]*hidden=\{shelfCollapsed\}[^>]*>/u
  );
  assert.doesNotMatch(
    home,
    /!shelfCollapsed \? \([\s\S]*dashboard-section-proposal/u
  );
  // Continue has no disclosure state and may remain mount-gated.
  assert.match(home, /!shelfCollapsed \? <DashboardContinueSection/u);
});

test('P0-4: recommendation prefill is typed handoff, not hard-coded copy lens', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /applyRecommendationHandoff/u);
  assert.doesNotMatch(home, /selectLens\(\s*current\s*,\s*['"]copy['"]\s*\)/u);
});

test('P1-06 / D2: Idle 建议 is light capsules, not a heavy entry card above Composer', () => {
  const card = readSource('src/product/today-recommendation-card.tsx');
  // Capsule row is the default face (visual weight below Composer main axis).
  assert.match(card, /data-suggestion-capsules/u);
  assert.match(card, /data-testid="suggestion-capsule-row"/u);
  assert.match(card, /data-testid="suggestion-chip-today"/u);
  // XHS first-screen recipes sit in the same light row (C4 — no new top nav).
  assert.match(card, /IDLE_FIRST_SCREEN_RECIPE_CHIPS/u);
  // Opening 今日建议 reveals the three-element mini card (D-126 elements preserved).
  assert.match(card, /today-recommendation-mini-card/u);
  assert.match(card, /today-recommendation-three-elements/u);
  // Former heavy entry-card shell must not own the Idle face.
  assert.doesNotMatch(card, /meiye-entry-card/u);
});

test('P1-3 / D6: Activity Shelf object cards (≤3, status + next action)', () => {
  const shelf = readSource('src/product/activity-shelf.ts');
  assert.match(shelf, /ACTIVITY_SHELF_MAX_CARDS = 3/u);
  assert.match(shelf, /projectActivityShelfCards/u);
  assert.match(shelf, /nextActionLabel/u);
  assert.match(shelf, /statusLabel/u);
  const section = readSource('src/product/dashboard-continue-section.tsx');
  assert.match(section, /data-testid="activity-shelf"/u);
  assert.match(section, /data-testid="activity-shelf-card"/u);
  assert.match(section, /activity-shelf-status/u);
  assert.match(section, /activity-shelf-thumb/u);
  // Horizontal shelf — not a dense vertical link list.
  assert.match(section, /flex gap-4 overflow-x-auto/u);
});

test('the greeting is fed by workbenchGreetingName, not by a new data source', () => {
  const surface = readSource('src/product/dashboard-home-surface.tsx');

  assert.match(
    surface,
    /import \{ workbenchGreetingName \} from '\.\/workbench-state-model';/u
  );
  assert.match(
    surface,
    /workbenchGreetingName\(\s*state\?\.store\?\.name,\s*state\?\.storeDraft\?\.extracted\.name\s*\)/u
  );
  // Named form when a name exists, generic 称呼 when it does not — never a
  // blank space where the shop name should be.
  assert.match(surface, /workbench_greeting\(\{ name: greetingName \}\)/u);
  assert.match(surface, /workbench_greeting_fallback\(\)/u);
});

test('both greeting locales keep 称呼 + 一句话行动邀请, and carry no metric', () => {
  const locales = {
    en: JSON.parse(readSource('project.inlang/messages/en.json')),
    zh: JSON.parse(readSource('project.inlang/messages/zh.json')),
  } as Record<string, Record<string, string>>;

  for (const [locale, messages] of Object.entries(locales)) {
    const named = messages.workbench_greeting;
    const fallback = messages.workbench_greeting_fallback;
    assert.match(named, /\{name\}/u, `${locale}: greeting addresses the store`);
    assert.doesNotMatch(fallback, /\{/u, `${locale}: fallback takes no name`);
    for (const [key, value] of [
      ['workbench_greeting', named],
      ['workbench_greeting_fallback', fallback],
    ]) {
      // 「禁止用 Display 层放指标数字」— a digit here means a metric crept in.
      assert.doesNotMatch(value, /\d/u, `${locale}.${key} carries a number`);
    }
  }
  assert.match(locales.zh.workbench_greeting_fallback, /店主/u);
});

test('the Display class is a real 200-weight Display in the stylesheet', () => {
  const glass = readSource('src/components/heroui-pro/heroui-glass.css');

  assert.match(
    glass,
    /\.meiye-greeting \{[^}]*font-size:\s*clamp\(1\.75rem[^}]*font-weight:\s*200[^}]*\}/u
  );
});

test('no balance panel opens the first screen', () => {
  const surface = readSource('src/product/dashboard-home-surface.tsx');

  // PRODUCT.md 原则 1 — the opening line is an invitation, not「你还剩 1 条视频」.
  // The per-run cost stays where it is spent: next to the Composer send button.
  assert.doesNotMatch(surface, /DashboardBalanceCard|dashboard-balance/u);
  assert.ok(
    !existsSync(
      resolve(process.cwd(), 'src/product/dashboard-balance-card.tsx')
    ),
    'the first-screen balance card is retired, not merely unmounted'
  );
});

test('the merchant can reach「我还剩多少」from the topbar', () => {
  const header = readSource('src/components/layout/dashboard-header.tsx');

  assert.match(header, /data-testid="product-usage-entry"/u);
  assert.match(header, /search=\{\{ section: 'usage' \}\}/u);
  assert.match(header, /to="\/settings\/account"/u);
  assert.match(header, /shell_product_usage_entry_aria\(\)/u);
});

test('no topbar entry degrades to a bare icon on a 390px screen', () => {
  const header = readSource('src/components/layout/dashboard-header.tsx');

  // Every `hidden sm:inline` label needs an `sm:hidden` short label beside it,
  // or the pill reads as an unlabeled glyph on a phone.
  const desktopOnly = header.match(/className="hidden sm:inline"/gu) ?? [];
  const mobileOnly = header.match(/className="sm:hidden"/gu) ?? [];
  assert.equal(desktopOnly.length, mobileOnly.length);
  assert.match(header, /shell_product_subscription_upgrade_short\(\)/u);
});
