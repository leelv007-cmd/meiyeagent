/**
 * DESIGN.md is the single visual authority (D-130). The token bridge restates
 * its palette so HeroUI v3 can consume it, and a restatement drifts silently —
 * so every value in the bridge is checked back against DESIGN.md here.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const designMarkdown = readFileSync(
  join(here, '../../../../DESIGN.md'),
  'utf8'
);
const productStyles = readFileSync(join(here, '../../styles.css'), 'utf8');
const bridge = readFileSync(
  join(here, 'theme/design-token-bridge.css'),
  'utf8'
);
const glassSheet = readFileSync(join(here, 'heroui-glass.css'), 'utf8');
const materials = readFileSync(join(here, '../../meiye-materials.css'), 'utf8');
const vendoredGlassTheme = readFileSync(
  join(here, 'vendor/css/theme-glass.css'),
  'utf8'
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Body of a top-level CSS rule, which in this file never nests braces. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `bridge is missing the ${selector} rule`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/^\s+(--[a-z0-9-]+):\s*([^;]+);/gm)].map(
      ([, name, value]) => [name, value.trim()]
    )
  );
}

const light = declarations(
  stripComments(ruleBody(bridge, 'html:has(.meiye-heroui-glass)'))
);
const dark = declarations(
  stripComments(ruleBody(bridge, 'html.dark:has(.meiye-heroui-glass)'))
);

/** `--x` resolved through the bridge's own var() chain, light rule first. */
function resolve(name: string, body: Map<string, string>): string | undefined {
  const seen = new Set<string>();
  let value = body.get(name) ?? light.get(name);
  while (value?.startsWith('var(--')) {
    const reference = value.slice(4, value.indexOf(')'));
    if (seen.has(reference)) return undefined;
    seen.add(reference);
    value = body.get(reference) ?? light.get(reference);
  }
  return value;
}

/** The `colors` block of DESIGN.md frontmatter. */
function designColors(): Map<string, string> {
  const frontmatter = designMarkdown.split('---')[1] ?? '';
  const colors = frontmatter.slice(frontmatter.indexOf('colors:'));
  const stop = colors.indexOf('\ntypography:');
  return new Map(
    [...colors.slice(0, stop).matchAll(/^ {2}([a-z0-9-]+):\s*"([^"]+)"/gm)].map(
      ([, name, value]) => [name, value]
    )
  );
}

test('light palette restates DESIGN.md frontmatter colors verbatim', () => {
  const colors = designColors();
  assert.ok(colors.size >= 20, 'failed to parse DESIGN.md colors');
  for (const [name, value] of colors) {
    assert.equal(
      light.get(`--meiye-${name}`),
      value,
      `--meiye-${name} must equal DESIGN.md colors.${name}`
    );
  }
});

test('light tokens DESIGN.md states in prose are quoted verbatim', () => {
  // DESIGN.md §4 Shadow Vocabulary, §5 Buttons.
  for (const token of [
    '--meiye-shadow-ambient',
    '--meiye-shadow-overlay',
    '--meiye-shadow-rose-glow',
    '--meiye-ink-hover',
  ]) {
    const value = light.get(token);
    assert.ok(value, `${token} is not declared`);
    assert.ok(
      designMarkdown.includes(value),
      `${token} value ${value} does not appear in DESIGN.md`
    );
  }
});

test('dark palette restates the DESIGN.md §7 measured values', () => {
  const darkTheme = designMarkdown.slice(
    designMarkdown.indexOf('## 7. 暗色主题')
  );
  assert.ok(darkTheme.length > 0, 'failed to locate DESIGN.md §7');
  // §7 names 玫瑰金 spark/spark-wash/spark-deep; the bridge keeps the
  // frontmatter's rose-* names so a single HeroUI mapping serves both themes.
  for (const token of [
    '--meiye-ink',
    '--meiye-ink-90',
    '--meiye-ink-60',
    '--meiye-ink-40',
    '--meiye-paper',
    '--meiye-canvas',
    '--meiye-glass-80',
    '--meiye-glass-50',
    '--meiye-glass-35',
    '--meiye-glass-edge',
    '--meiye-mask-scrim',
    '--meiye-rose-gold',
    '--meiye-rose-wash',
    '--meiye-rose-deep',
    '--meiye-focus',
  ]) {
    const value = dark.get(token);
    assert.ok(value, `${token} is not declared in the dark rule`);
    assert.ok(
      darkTheme.includes(value),
      `${token} value ${value} does not appear in DESIGN.md §7`
    );
  }
});

test('dark tokens DESIGN.md leaves open follow the shipped product shell', () => {
  const shellStart = productStyles.indexOf('.dark .meiye-product-shell {');
  assert.notEqual(shellStart, -1, 'product shell dark block is missing');
  const shell = declarations(
    productStyles.slice(shellStart, productStyles.indexOf('\n  }', shellStart))
  );
  for (const name of ['tint-active', 'tint-hover', 'hairline']) {
    assert.equal(
      dark.get(`--meiye-${name}`),
      shell.get(`--${name}`),
      `--meiye-${name} must match .dark .meiye-product-shell`
    );
  }
});

test('every HeroUI token the bridge maps resolves to a declared 门店橱窗 token', () => {
  const declared = new Set([...light.keys(), ...dark.keys()]);
  for (const body of [light, dark]) {
    for (const [name, value] of body) {
      for (const [, reference] of value.matchAll(
        /var\((--meiye-[a-z0-9-]+)\)/g
      )) {
        assert.ok(
          declared.has(reference),
          `${name} references undeclared ${reference}`
        );
      }
    }
  }
});

test('一点胭脂法则: 玫瑰金 never becomes a control, link or text colour', () => {
  // DESIGN.md §2: rose-gold is an AI spark only — never a button ground,
  // never a link, never body text. The dark focus ring is the one exception
  // DESIGN.md §7 grants, so it is not asserted here.
  const rose = ['rose-gold', 'rose-wash', 'rose-deep', 'focus'];
  for (const body of [light, dark]) {
    for (const token of [
      '--accent',
      '--accent-hover',
      '--link',
      '--foreground',
      '--background',
      '--surface',
      '--default',
    ]) {
      const value = body.get(token);
      if (!value) continue;
      for (const name of rose) {
        assert.ok(
          !value.includes(`--meiye-${name}`),
          `${token} must not resolve to --meiye-${name}`
        );
      }
    }
  }
});

/**
 * 上面九个断言全是 `--meiye-*` 对着 DESIGN.md 自证——把整段 HeroUI remap 删掉，它们
 * 照样全绿，于是「桥接住了组件库」这件事一行都没有被测过。下面五个测的是另一半：
 * HeroUI 的 base token 到底有没有指到门店橱窗的值上。删掉 remap 段，它们必须红。
 */

test('every token the vendored Glass theme declares is re-pointed by the bridge', () => {
  const upstream = new Set(
    [
      ...stripComments(vendoredGlassTheme).matchAll(/^\s+(--[a-z0-9-]+):/gm),
    ].map(([, name]) => name)
  );
  assert.ok(
    upstream.size >= 20,
    `failed to parse the vendored Glass theme (${upstream.size} tokens)`
  );
  const missed = [...upstream].filter((name) => !light.has(name)).sort();
  assert.deepEqual(
    missed,
    [],
    'the Glass theme ships these with HeroUI defaults and the bridge never ' +
      'answers them, so the component library paints itself here'
  );
});

test('HeroUI base tokens resolve to the 门店橱窗 values they are supposed to', () => {
  // Naming the mapping rather than only its shape: a rename upstream, or a
  // silent revert of one of the three breaches U02 closed, lands here.
  const expected = new Map([
    // §4 玻璃三档 — the whole point of the Glass theme's backdrop-filter.
    ['--surface', 'var(--meiye-glass-80)'],
    ['--surface-secondary', 'var(--meiye-glass-50)'],
    ['--surface-tertiary', 'var(--meiye-glass-35)'],
    ['--glass-blur', 'var(--meiye-blur-piece)'],
    // §2 全中性控件 + 发丝线是分隔线唯一色.
    ['--accent', 'var(--meiye-ink)'],
    ['--accent-hover', 'var(--meiye-ink-hover)'],
    ['--border', 'var(--meiye-hairline)'],
    ['--separator', 'var(--meiye-hairline)'],
    ['--link', 'var(--meiye-ink-90)'],
    ['--focus', 'var(--meiye-ink)'],
    // §5 实体面：表单白瓷底、真悬浮层白瓷 + 悬浮影.
    ['--field-background', 'var(--meiye-paper)'],
    ['--overlay', 'var(--meiye-paper)'],
    ['--overlay-shadow', 'var(--meiye-shadow-overlay)'],
    ['--surface-shadow', 'var(--meiye-shadow-ambient)'],
    ['--backdrop', 'var(--meiye-mask-scrim)'],
    // frontmatter rounded.md.
    ['--radius', 'var(--meiye-radius-md)'],
    ['--field-radius', 'var(--meiye-radius-md)'],
  ]);
  for (const [token, value] of expected) {
    assert.equal(light.get(token), value, `${token} must map to ${value}`);
  }
});

test('dark re-points the HeroUI base tokens DESIGN.md §7 moves', () => {
  // 上一个断言只读 light 规则：整段 dark 的 HeroUI remap 删掉，十六个测试照样全绿。
  // 暗色焦点环更是「只做反向断言」的活标本 —— 下面那条一点胭脂法则把 --focus /
  // --field-border-focus 列进 allowed，于是「暗色焦点环接上了玫瑰金」和「它根本没接」
  // 在测试里长得一模一样。这里正面要求它在。
  const expected = new Map([
    // DESIGN.md §7: 暗色焦点环带玫瑰微调，是一点胭脂法则的唯一例外落点。
    ['--focus', 'var(--meiye-focus)'],
    ['--field-border-focus', 'var(--meiye-focus)'],
    // 暗色下 accent/status 的底翻成亮墨，字面必须跟着翻成画布色才读得出来。
    ['--accent-foreground', 'var(--meiye-canvas)'],
    ['--success-foreground', 'var(--meiye-canvas)'],
    ['--warning-foreground', 'var(--meiye-canvas)'],
    ['--danger-foreground', 'var(--meiye-canvas)'],
  ]);
  for (const [token, value] of expected) {
    assert.equal(dark.get(token), value, `dark ${token} must map to ${value}`);
  }

  const focus = resolve('--focus', dark);
  const chroma = Number(focus?.match(/^oklch\(\s*[\d.]+\s+([\d.]+)/u)?.at(1));
  assert.ok(
    chroma > 0,
    `dark --focus resolved to ${focus}, a neutral — DESIGN.md §7 tints it 玫瑰金`
  );

  // 序列色是同一条中性墨梯度，两个主题各从自己那头起步：亮底上 --chart-1 最深，
  // 暗底上它必须最浅。照抄亮色那份，第一条序列就直接沉进画布。
  const lightness = (name: string, body: Map<string, string>) =>
    Number(resolve(name, body)?.match(/^oklch\(\s*([\d.]+)/u)?.at(1));
  const ramp = (body: Map<string, string>) =>
    [1, 2, 3, 4, 5].map((index) => lightness(`--chart-${index}`, body));
  const lightRamp = ramp(light);
  const darkRamp = ramp(dark);
  assert.ok(
    lightRamp.every((value) => value > 0),
    `failed to read the light chart ramp (${lightRamp.join(', ')})`
  );
  assert.deepEqual(
    [...lightRamp].sort((a, b) => a - b),
    lightRamp,
    `the light chart ramp must run 深→浅 (${lightRamp.join(', ')})`
  );
  assert.deepEqual(
    [...darkRamp].sort((a, b) => b - a),
    darkRamp,
    `the dark chart ramp must run 浅→深 (${darkRamp.join(', ')})`
  );
  assert.ok(
    darkRamp[0] > lightRamp[4],
    `dark --chart-1 (${darkRamp[0]}) is not the ramp's light end, so the ` +
      'first series sinks into the 画布'
  );
});

test('the surface family stays 真半透明 so backdrop-filter has something to blur', () => {
  // 破口 ①: 这三个曾经全指向不透明的白瓷/画布，Glass 主题 ~60 个选择器的
  // backdrop-filter 于是纯付 GPU、零画面。alpha 是 blur 的前提。
  for (const [themeName, body] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const token of [
      '--surface',
      '--surface-secondary',
      '--surface-tertiary',
    ]) {
      const value = resolve(token, body);
      assert.ok(value, `${token} does not resolve in ${themeName}`);
      assert.match(
        value,
        /\/\s*0?\.\d+\s*\)$/u,
        `${themeName} ${token} resolved to ${value}, which is fully opaque`
      );
    }
  }
});

test('玫瑰金 reaches the HeroUI surface as a spark, and only as a spark', () => {
  // 破口 ②: rose 系 var() 引用曾经是 0——测试只做反向断言，所以「火花没接上」
  // 和「火花接对了」在测试里长得一模一样。
  const spark = new Map([
    ['--spark', 'var(--meiye-rose-gold)'],
    ['--spark-wash', 'var(--meiye-rose-wash)'],
    ['--spark-deep', 'var(--meiye-rose-deep)'],
    ['--shadow-rose-glow', 'var(--meiye-shadow-rose-glow)'],
  ]);
  for (const [token, value] of spark) {
    assert.equal(light.get(token), value, `${token} must map to ${value}`);
  }
  // 一点胭脂法则的正面：这四个名字之外，玫瑰金在桥上只允许出现在暗色焦点环。
  const allowed = new Set([...spark.keys(), '--focus', '--field-border-focus']);
  for (const body of [light, dark]) {
    for (const [name, value] of body) {
      if (name.startsWith('--meiye-') || allowed.has(name)) continue;
      assert.doesNotMatch(
        value,
        /--meiye-rose-|--meiye-focus/u,
        `${name} is not an AI moment and must not carry 玫瑰金`
      );
    }
  }
});

test('DESIGN.md rounded / spacing / typography scales are restated verbatim', () => {
  const frontmatter = designMarkdown.split('---')[1] ?? '';
  const block = (name: string, next: string) =>
    frontmatter.slice(
      frontmatter.indexOf(`${name}:`),
      frontmatter.indexOf(`\n${next}:`)
    );

  const rounded = [
    ...block('rounded', 'spacing').matchAll(/^ {2}([a-z0-9]+):\s*"([^"]+)"/gm),
  ];
  assert.equal(rounded.length, 7, 'failed to parse DESIGN.md rounded');
  for (const [, name, value] of rounded) {
    assert.equal(
      light.get(`--meiye-radius-${name}`),
      value,
      `--meiye-radius-${name} must equal DESIGN.md rounded.${name}`
    );
  }

  const spacing = [
    ...block('spacing', 'components').matchAll(
      /^ {2}([a-z0-9]+):\s*"([^"]+)"/gm
    ),
  ];
  assert.equal(spacing.length, 7, 'failed to parse DESIGN.md spacing');
  for (const [, name, value] of spacing) {
    assert.equal(
      light.get(`--meiye-space-${name}`),
      value,
      `--meiye-space-${name} must equal DESIGN.md spacing.${name}`
    );
  }

  // Display 不在这里：它只服务问候语，由 .meiye-greeting 整条承担。
  const typography = block('typography', 'rounded');
  for (const tier of ['headline', 'title', 'body', 'label']) {
    const section = typography.slice(typography.indexOf(`  ${tier}:`));
    for (const [property, token] of [
      ['fontSize', 'size'],
      ['fontWeight', 'weight'],
      ['lineHeight', 'leading'],
    ]) {
      const value = section
        .match(new RegExp(`^ {4}${property}:\\s*"?([^"\\n]+)"?`, 'mu'))
        ?.at(1)
        ?.trim();
      assert.ok(
        value,
        `failed to parse DESIGN.md typography.${tier}.${property}`
      );
      assert.equal(
        light.get(`--meiye-text-${tier}-${token}`),
        value,
        `--meiye-text-${tier}-${token} must equal DESIGN.md typography.${tier}.${property}`
      );
    }
  }
});

test('the three blur tiers are declared and the sidebar takes the shell one', () => {
  // DESIGN.md §4: 壳 64 / 件 24 / 痕 20. --glass-blur is a single radius, so the
  // sidebar — a shell — has to raise it or it renders two tiers too shallow.
  assert.equal(light.get('--meiye-blur-shell'), '64px');
  assert.equal(light.get('--meiye-blur-piece'), '24px');
  assert.equal(light.get('--meiye-blur-trace'), '20px');
  assert.match(
    stripComments(glassSheet),
    /\.sidebar--floating[\s\S]{0,200}--glass-blur:\s*var\(--meiye-blur-shell\)/u,
    'the Pro Sidebar still blurs at the 件级 radius'
  );
});

test('玻璃三档与白瓷各只有一处定义, and 白瓷 keeps its edge', () => {
  // 破口 ③: 同一批类名以前在 styles.css (@layer components) 与 heroui-glass.css
  // (无 layer) 各写一遍，无 layer 的那份恒胜而且丢了 border——十条生产路由上的白瓷
  // 描边就是这么静默消失的。
  for (const selector of [
    '.meiye-glass-shell',
    '.meiye-glass-piece',
    '.meiye-glass-trace',
    '.meiye-porcelain',
  ]) {
    const declaredIn = [
      ['src/styles.css', productStyles],
      ['heroui-pro/heroui-glass.css', glassSheet],
      ['src/meiye-materials.css', materials],
    ].filter(([, css]) => stripComments(css).includes(`${selector} {`));
    assert.deepEqual(
      declaredIn.map(([name]) => name),
      ['src/meiye-materials.css'],
      `${selector} must be declared once, in the shared materials sheet`
    );
  }
  assert.match(
    stripComments(ruleBody(materials, '.meiye-porcelain')),
    /border:\s*1px solid/u,
    'DESIGN.md §4「玻璃有边法则」— 白瓷 keeps a 1px near-white edge'
  );
  // Both entry points must keep pulling it in, at the cascade slot each needs.
  assert.match(
    productStyles,
    /@import "\.\/meiye-materials\.css" layer\(components\);/u
  );
  assert.match(glassSheet, /@import "\.\.\/\.\.\/meiye-materials\.css";/u);
});

test('bridge stays rooted at <html> so portalled overlays inherit it', () => {
  // C-02 blocker #2. modal / popover / tooltip portal onto document.body, so
  // they only receive these tokens because the rules' *subject* is the root
  // element and `:has()` is merely the gate. Re-scoping to the shell subtree
  // reads as equivalent and silently strands every floating surface on
  // HeroUI's defaults; live proof is in
  // .scratch/c02-reshell-prereqs-2026-07-25/portal-tokens-after.json.
  const selectors = [
    ...stripComments(bridge).matchAll(/^([^\s@{}][^{}]*)\{/gm),
  ].map(([, selector]) => selector.trim());
  assert.deepEqual(selectors, [
    'html:has(.meiye-heroui-glass)',
    'html.dark:has(.meiye-heroui-glass)',
  ]);
});

test('glass sheet inlines the @heroui/styles entry minus its Tailwind root', () => {
  // C-02 blocker #1. `@import "@heroui/styles/css"` drags in a second
  // `@import "tailwindcss"`, which compiled a duplicate of everything
  // src/styles.css already ships (292KB of the old 733KB artefact). The sheet
  // therefore restates that entry by hand — which only stays correct if an
  // upstream bump does not add or move an import behind our back.
  const upstream = readFileSync(
    join(here, '../../../node_modules/@heroui/styles/dist/index.css'),
    'utf8'
  );
  const imports = (css: string): string[] =>
    [...stripComments(css).matchAll(/@import\s+"([^"]+)"/g)].map(([, s]) => s);

  const tailwindRoots = ['tailwindcss', 'tw-animate-css'];
  // '@heroui/styles/themes/default/index.css' → 'themes/default/index.css'
  const subpathToDist: Record<string, string> = {
    base: 'base/base.css',
    'themes/default': 'themes/default/index.css',
    utilities: 'utilities/index.css',
    variants: 'variants/index.css',
  };
  const ours = imports(glassSheet)
    .filter((specifier) => specifier.startsWith('@heroui/styles'))
    .map((specifier) => {
      const subpath = specifier.replace('@heroui/styles/', '');
      return subpathToDist[subpath] ?? subpath;
    });

  assert.ok(
    !imports(glassSheet).some((specifier) =>
      [...tailwindRoots, '@heroui/styles', '@heroui/styles/css'].includes(
        specifier
      )
    ),
    'heroui-glass.css must not pull a second Tailwind root'
  );
  assert.deepEqual(
    ours,
    imports(upstream)
      .filter((specifier) => !tailwindRoots.includes(specifier))
      .map((specifier) => specifier.replace('./', '')),
    'heroui-glass.css has drifted from @heroui/styles/dist/index.css'
  );
  for (const file of ours) {
    assert.ok(
      existsSync(join(here, '../../../node_modules/@heroui/styles/dist', file)),
      `@heroui/styles/dist/${file} does not exist`
    );
  }
});

test('Glass is the only vendored theme (D-130: Brutalism/Mouve 不启用)', () => {
  const pin = JSON.parse(
    readFileSync(join(here, 'components.json'), 'utf8')
  ) as { theme: string };
  const manifest = JSON.parse(
    readFileSync(join(here, 'vendor/MIRROR.json'), 'utf8')
  ) as { theme: string; files: Record<string, string> };

  assert.equal(pin.theme, 'glass');
  assert.equal(manifest.theme, 'glass');
  const themes = Object.keys(manifest.files).filter((file) =>
    file.startsWith('css/theme-')
  );
  assert.deepEqual(themes, ['css/theme-glass.css']);
});
