import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

/**
 * OI-48 的静态门禁。
 *
 * 这一批缺陷全是同一个形状：**底色 token 被当成前景色用**。`--muted` /
 * `--default` / `--tint-hover` 都是 4%–8% 的 alpha 底色，写进 `color:` 就是隐形字 ——
 * `.widget__description` 实测明 1.06:1、暗 1.17:1，六张配方卡的说明行等于被删掉。
 * 同源的还有「压在氛围带上的白字在氛围层没铺上时压 canvas」（1.11:1）与「白瓷描边
 * 硬编码 90% 白、不消费 --glass-edge，暗色下亮 5 倍」。
 *
 * 门禁按「谁写的谁负责」分两段：本产品自己的表逐条算 alpha；vendored 的表不能改
 * （`scripts/sync-heroui-pro.ts` 整棵重建 + MIRROR.json 逐文件 sha256），所以对它查的
 * 是**每一处都被共享边界覆盖**——上游升级新加一处 `color: var(--muted)` 会在这里红。
 */

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const flatten = (css: string) => stripComments(css).replace(/\s+/gu, ' ');

type Rule = { selector: string; body: string };
const rules = (css: string): Rule[] =>
  [...flatten(css).matchAll(/([^{}]*)\{([^{}]*)\}/gu)].map(([, s, b]) => ({
    selector: s.trim(),
    body: b,
  }));

const declarations = (body: string, property: string) =>
  body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${property}:`))
    .map((part) => part.slice(property.length + 1).trim());

const PRODUCT_SHEETS = {
  'src/styles.css': read('src/styles.css'),
  'src/meiye-materials.css': read('src/meiye-materials.css'),
  'heroui-pro/heroui-glass.css': read(
    'src/components/heroui-pro/heroui-glass.css'
  ),
  'heroui-pro/theme/design-token-bridge.css': read(
    'src/components/heroui-pro/theme/design-token-bridge.css'
  ),
};

/** 把一个规则块里的 `--x: y` 收成表。 */
const tokensOf = (css: string, selector: string) => {
  const found = rules(css).find((rule) => rule.selector === selector);
  assert.ok(found, `expected a \`${selector}\` rule to declare tokens`);
  const table = new Map<string, string>();
  for (const part of found.body.split(';')) {
    const match = part.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/u);
    if (match) table.set(match[1], match[2].trim());
  }
  return table;
};

const styles = PRODUCT_SHEETS['src/styles.css'];
const bridge = PRODUCT_SHEETS['heroui-pro/theme/design-token-bridge.css'];

const merge = (...tables: Map<string, string>[]) =>
  new Map(tables.flatMap((table) => [...table]));

const LIGHT = merge(
  tokensOf(bridge, 'html:has(.meiye-heroui-glass)'),
  tokensOf(styles, '.meiye-product-shell')
);
const DARK = merge(
  LIGHT,
  tokensOf(bridge, 'html.dark:has(.meiye-heroui-glass)'),
  tokensOf(styles, '.dark .meiye-product-shell')
);

/** 顺着 var() 链解到底；解不动就返回 null（不假装知道）。 */
const resolveValue = (value: string, table: Map<string, string>) => {
  let current = value;
  for (let hop = 0; hop < 12; hop += 1) {
    const match = current.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/u);
    if (!match) return current.trim();
    const [whole, name, fallback] = match;
    const replacement = table.get(name) ?? fallback;
    if (replacement === undefined) return null;
    current = current.replace(whole, replacement);
  }
  return null;
};

/** oklch(L C H / A) → A。无 alpha 通道即 1；看不懂的返回 null。 */
const alphaOf = (value: string) => {
  if (/^#[0-9a-f]{4}$/iu.test(value)) {
    return Number.parseInt(value.slice(4), 16) / 15;
  }
  if (/^#[0-9a-f]{8}$/iu.test(value)) {
    return Number.parseInt(value.slice(7), 16) / 255;
  }
  const fn = value.match(/^(?:oklch|oklab|rgb|rgba|hsl|hsla)\(([^()]*)\)$/u);
  if (!fn) return null;
  const slash = fn[1].split('/');
  if (slash.length === 1) return 1;
  const raw = slash[1].trim();
  const percent = raw.endsWith('%');
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return null;
  return percent ? parsed / 100 : parsed;
};

test('本产品自己的表里没有 alpha < 0.3 的 color —— 底色 token 不许当前景色', () => {
  const MIN_ALPHA = 0.3;
  let checked = 0;
  for (const [file, css] of Object.entries(PRODUCT_SHEETS)) {
    for (const { selector, body } of rules(css)) {
      for (const value of declarations(body, 'color')) {
        for (const [theme, table] of [
          ['light', LIGHT],
          ['dark', DARK],
        ] as const) {
          const resolved = resolveValue(value, table);
          if (resolved === null) continue;
          const alpha = alphaOf(resolved.replace(/\s*!important$/u, ''));
          if (alpha === null) continue;
          checked += 1;
          assert.ok(
            alpha >= MIN_ALPHA,
            `${file} · ${theme} · \`${selector}\` 的 color 解到 ${resolved}（alpha ${alpha}）——` +
              ` 这是底色档位，当前景色一定低于 4.5:1。前景请走 --ink-90 / --ink-60 / --muted-foreground。`
          );
        }
      }
    }
  }
  // 解析器一旦解不动，上面整个循环会安静地什么都不查；给它一个下限，
  // 保证这条断言不会在某次重构后变成永远为真。
  assert.ok(
    checked >= 40,
    `只算出 ${checked} 条 color，解析器多半已经和这几张表脱节`
  );
});

test('vendored 表里每一处「底色 token 当前景色」都被共享边界收住', () => {
  const MIN_ALPHA = 0.3;
  const glass = PRODUCT_SHEETS['heroui-pro/heroui-glass.css'];

  // 共享边界＝ heroui-glass.css 里所有落在 .meiye-product-shell 作用域内、且真的
  // 改了前景（color: 或把 --muted 重定义成前景 token）的规则。
  const covered = new Set<string>();
  for (const { selector, body } of rules(glass)) {
    if (!selector.includes('.meiye-product-shell')) continue;
    const fixesForeground =
      declarations(body, 'color').length > 0 ||
      declarations(body, '--muted').length > 0;
    if (!fixesForeground) continue;
    for (const cls of selector.matchAll(/\.[a-z][\w-]*/gu)) covered.add(cls[0]);
    for (const slot of selector.matchAll(/\[data-slot="([\w-]+)"\]/gu)) {
      covered.add(`.${slot[1]}`);
    }
  }

  const vendorFiles = read(
    'src/components/heroui-pro/vendor/css/index.css'
  ).matchAll(/@import "\.\/([\w-]+\.css)"/gu);

  let sites = 0;
  for (const [, name] of vendorFiles) {
    const css = read(`src/components/heroui-pro/vendor/css/${name}`);
    for (const { selector, body } of rules(css)) {
      // 判据是**解出来的 alpha**，不是 token 的名字：`var(--field-placeholder,
      // var(--muted))` 里的 --muted 只是永不生效的兜底（桥在 <html> 上定义了
      // --field-placeholder），按名字查会把它误报成缺陷。
      const sinksToBackground = declarations(body, 'color').some((value) =>
        [LIGHT, DARK].some((table) => {
          const resolved = resolveValue(value, table);
          if (resolved === null) return false;
          const alpha = alphaOf(resolved);
          return alpha !== null && alpha < MIN_ALPHA;
        })
      );
      if (!sinksToBackground) continue;
      sites += 1;
      // 取最右侧的类名：它就是这条规则真正落在的那个件。
      const classes = [...selector.matchAll(/\.[a-z][\w-]*/gu)].map(
        (m) => m[0]
      );
      const leaf = classes.at(-1);
      assert.ok(
        leaf && covered.has(leaf),
        `vendor/css/${name} 的 \`${selector}\` 拿底色 token 当前景色，` +
          ` heroui-glass.css 里却没有对应的 .meiye-product-shell 覆写。` +
          ` vendored 表不能手改（sync-heroui-pro.ts 会整棵重建），请在 heroui-glass.css` +
          ` 的共享边界上补一条 color: var(--muted-foreground)。`
      );
    }
  }
  assert.ok(sites >= 25, `只扫到 ${sites} 处，vendored 表的读取多半断了`);

  // 修的只能是前景。任何一条覆写要是顺手动了底色，`bg-muted/NN` 那 36 处底色用法
  // 就会跟着变成墨块 —— 这正是「把 --muted 整体翻成 --ink-60」被否决的原因。
  for (const { selector, body } of rules(glass)) {
    if (!selector.includes('.meiye-product-shell')) continue;
    if (declarations(body, 'color').length === 0) continue;
    assert.equal(
      declarations(body, 'background').length +
        declarations(body, 'background-color').length,
      0,
      `\`${selector}\` 在修前景的同时改了底色`
    );
  }
});

test('白瓷描边消费 --glass-edge，不硬编码', () => {
  // §7 规定 glass-edge 暗色档 = oklch(1 0 0 / 0.18)。白瓷以前硬写 0.9，暗色下亮 5 倍，
  // 每张卡被近乎纯白的硬边框住，读作线框稿 —— 恰好把 §4「用玻璃层次表达深度」反过来做。
  const materials = PRODUCT_SHEETS['src/meiye-materials.css'];
  const porcelain = rules(materials).find(
    (rule) => rule.selector === '.meiye-porcelain'
  );
  assert.ok(porcelain, 'src/meiye-materials.css must declare .meiye-porcelain');
  const [border] = declarations(porcelain.body, 'border');
  assert.ok(border, '.meiye-porcelain must keep a 1px edge (DESIGN.md §4)');
  assert.match(
    border,
    /^1px solid var\(--meiye-glass-edge, var\(--glass-edge\)\)$/u,
    `.meiye-porcelain 的描边是 \`${border}\` —— 材质描边必须走 --glass-edge，` +
      ' 和同一张表里的 .meiye-glass-piece 一致，否则暗色档跟不上 §7。'
  );
});

test('玻璃三要素齐全：带 blur 的件必须带描边', () => {
  // DESIGN.md §4「玻璃有边法则」——「没有 blur、没有描边的半透明白不是玻璃，
  // 是没上完色，禁止出现」。theme-glass.css 给 .widget__content 与 .segment 上了
  // 件级 blur，vendored 表两处都没给边，在共享边界上补。
  const glass = flatten(PRODUCT_SHEETS['heroui-pro/heroui-glass.css']);
  assert.match(
    glass,
    /\.meiye-product-shell \.widget__content, \.meiye-product-shell \.segment:not\(\.segment--ghost\) \{ border: 1px solid var\(--meiye-glass-edge, var\(--glass-edge\)\); \}/u,
    'widget__content 与 segment 有 blur 无描边，必须补 --glass-edge'
  );
});

test('焦点环有系统级兜底，且压得过 vendored 的 outline: none', () => {
  // DESIGN.md §5「Focus: 2px 墨色 outline + 2px offset」。custom.css 把带
  // `focus-visible:ring` 的元素 outline 关掉交给 ring，vendored 的 segment 也关，
  // 而接管的 ring 依赖一个全仓无定义的 --ring-offset-width —— 四个可聚焦元素因此
  // 焦点完全不可见。兜底必须无 layer（才压得过同样无 layer 的 vendored 表）。
  const glass = PRODUCT_SHEETS['heroui-pro/heroui-glass.css'];
  const fallback = rules(glass).find(
    (rule) =>
      rule.selector ===
      '.meiye-product-shell :is(:focus-visible, [data-focus-visible="true"])'
  );
  assert.ok(fallback, '产品壳缺少 :focus-visible 系统级兜底');
  assert.match(fallback.body, /outline: 2px solid var\(--product-focus/u);
  assert.match(fallback.body, /outline-offset: 2px/u);
  // 兜底只补 outline。box-shadow 归 ring，两者并存，不许在这里抢。
  assert.equal(declarations(fallback.body, 'box-shadow').length, 0);
  // 这张表整体无 layer 是兜底能赢的前提；layer 声明只排序，不给自己套层。
  assert.doesNotMatch(glass, /@layer\s+[\w\s,]*\{/u);
});

test('氛围层可见性依赖 sidebar-main 保持透明 —— 这条耦合必须有人守', () => {
  /*
   * 删掉下面那条规则，氛围层会**静默**全灭：页面照常渲染，只是背景没了。
   *
   * 绘制顺序为什么是这样：provider 是 `position: relative` + `isolation: isolate`
   * （styles.css，自成一个 stacking context），氛围图挂在它的 `::before` 上、
   * `position: absolute` + `z-index: -1`；而 `.sidebar__main` 是
   * `position: relative` 无 z-index（vendor/css/sidebar.css:836-842）。在同一个
   * stacking context 里，z-index 为负的伪元素画在第 2 步，定位过的 `<main>` 画在
   * 第 6 步 —— `<main>` 恒在氛围带**之上**。它只要有不透明底，就把整条带盖掉。
   *
   * 而 `<main>` 有两个底色来源，都得压掉：
   *   1. `sidebar-layout.tsx` 给它的 Tailwind `bg-surface-0`（@layer utilities）
   *   2. vendored 的 `.sidebar__provider:has(.sidebar--inset) .sidebar__main`
   *      `background-color: var(--surface)`（**无 layer**，恒赢所有分层规则）
   * 所以 `!important` 不是装饰：没有它，这条 @layer components 里的规则压不过第 2 条。
   *
   * 这是「有渲染、没测试、一删就静默失效」——和 critique 抓的「有 CSS、有测试、
   * 没渲染」正好互为镜像。改动这条之前请先确认氛围层还看得见。
   */
  const flat = flatten(PRODUCT_SHEETS['src/styles.css']);
  assert.match(
    flat,
    /\.meiye-product-shell\[data-shell-mode="product"\] \[data-slot="sidebar-main"\] \{ background: transparent !important; \}/u,
    'sidebar-main 一旦不透明就会盖掉氛围层；这条透明化（含 !important）是氛围层可见的唯一保障'
  );
  // 另一半前提：氛围图必须留在负 z-index 的伪元素上。它一旦转正或改挂实体元素，
  // 上面那条透明化就不再是「唯一保障」，这条断言的理由也就失效了。
  assert.match(
    flat,
    /\[data-slot="sidebar-provider"\]::before \{[^{}]*z-index: -1;/u,
    '氛围层是 ::before 上 z-index:-1 的背景，改了它请一并重估上面那条耦合'
  );
});
