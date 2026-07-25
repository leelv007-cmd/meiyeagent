/**
 * D-031 slot-form retirement gate — T30 / #224, 归桶矩阵 §6.10 违规位 ①.
 *
 * The 「旧内容换平台」panel forced three selections (source / form / carrier)
 * before creation could start. The reshell answers the same question inside the
 * conversation, so the panel must be unreachable from anything the app mounts.
 *
 * The component file itself is not deleted here — it belongs to the
 * delete-after-reshell batch, which is a different ticket. This gate proves it
 * is dead code rather than a live surface, and fails loudly if a future change
 * re-mounts it or reintroduces a slot form under a new name.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The retired module and its own tests may still name it. */
const EXEMPT = new Set([
  'product/composer/reuse-content-panel.tsx',
  'product/composer/reuse-panel-retirement.static.test.ts',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return ['.ts', '.tsx'].includes(extname(full)) ? [full] : [];
  });
}

const runtimeFiles = walk(SRC_ROOT)
  .map((file) => ({ file, key: relative(SRC_ROOT, file).replaceAll('\\', '/') }))
  .filter(({ key }) => !EXEMPT.has(key))
  .filter(({ key }) => !key.includes('.test.'))
  .map(({ file, key }) => ({ key, source: readFileSync(file, 'utf8') }));

test('nothing the app mounts imports the retired reuse panel', () => {
  const importers = runtimeFiles
    .filter(({ source }) => /from\s+'[^']*reuse-content-panel'/u.test(source))
    .map(({ key }) => key);
  assert.deepEqual(
    importers,
    [],
    `reuse-content-panel is mounted again by: ${importers.join(', ')}`
  );

  const renderers = runtimeFiles
    .filter(({ source }) => /<ReuseContentPanel[\s/>]/u.test(source))
    .map(({ key }) => key);
  assert.deepEqual(renderers, []);
});

test('the composer renders no reuse slot form', () => {
  const composerSurfaces = runtimeFiles.filter(({ key }) =>
    key.startsWith('product/composer/')
  );
  // The panel's own control ids are the observable shape of the slot form.
  const forbidden = [
    'composer-reuse-content-panel',
    'composer-reuse-confirm',
    'composer-reuse-source-',
    'composer-reuse-lens-',
    'composer-reuse-carrier-',
  ];
  for (const { key, source } of composerSurfaces) {
    for (const token of forbidden) {
      assert.equal(
        source.includes(token),
        false,
        `${key} still renders the retired reuse slot form (${token})`
      );
    }
  }
});

test('reuse is answered in the conversation instead', () => {
  const conversation = readFileSync(
    fileURLToPath(new URL('./composer-conversation.tsx', import.meta.url)),
    'utf8'
  );
  const home = readFileSync(
    fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
    'utf8'
  );
  assert.match(conversation, /composer-reuse-chips/);
  assert.match(conversation, /composer-reuse-chip-\$\{chip\.id\}/);
  assert.match(home, /COMPOSER_REUSE_CHIPS/);
  // Selecting the reuse card hands back to the container, never to a panel.
  const panel = readFileSync(
    fileURLToPath(new URL('./recipe-cards-panel.tsx', import.meta.url)),
    'utf8'
  );
  assert.match(panel, /onReuseRequested\?\.\(\)/);
});

test('the retired settings grid did not come back either (D-031)', () => {
  const home = readFileSync(
    fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
    'utf8'
  );
  // Its five controls were exactly the T08 signed fields.
  assert.doesNotMatch(home, /composer-settings-row/);
  assert.doesNotMatch(home, /composer-setting-input-/);
  assert.doesNotMatch(home, /buildDynamicSettingsRow/);
});
