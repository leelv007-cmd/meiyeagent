/**
 * DESIGN.md is the single visual authority (D-130). The token bridge restates
 * its palette so HeroUI v3 can consume it, and a restatement drifts silently —
 * so every value in the bridge is checked back against DESIGN.md here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const designMarkdown = readFileSync(join(here, '../../../../DESIGN.md'), 'utf8');
const productStyles = readFileSync(join(here, '../../styles.css'), 'utf8');
const bridge = readFileSync(join(here, 'theme/design-token-bridge.css'), 'utf8');

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

const light = declarations(ruleBody(bridge, 'html:has(.meiye-heroui-glass)'));
const dark = declarations(ruleBody(bridge, 'html.dark:has(.meiye-heroui-glass)'));

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
      for (const [, reference] of value.matchAll(/var\((--meiye-[a-z0-9-]+)\)/g)) {
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
