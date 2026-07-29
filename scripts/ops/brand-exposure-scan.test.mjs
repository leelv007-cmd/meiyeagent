import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { BRAND_EN, BRAND_ZH, LEGACY_BRAND_NAMES, scan } from './brand-exposure-scan.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'brand-scan-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(resolve(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return root;
}

test('user-visible copy is 对外, test guards and comments are 工程内部', async () => {
  const root = await fixture({
    'messages/zh.json': '{\n  "shell_product_brand": "美业内容中台"\n}\n',
    'src/thing.ts': '// 品牌链接「美业内容簿标志」会连「内容」一起吃掉\nexport const x = 1;\n',
    'tests/e2e/brand.spec.ts': "const ALLOWED = ['美业内容簿'];\n",
    'src/widget.test.ts': "assert(label === '美业管理模式');\n",
  });

  const byFile = new Map(scan(root).map((f) => [f.file, f]));

  assert.equal(byFile.get('messages/zh.json').kind, 'external');
  assert.equal(byFile.get('messages/zh.json').line, 2);
  assert.equal(byFile.get('messages/zh.json').name, '美业内容中台');
  assert.equal(byFile.get('src/thing.ts').kind, 'internal', 'a source comment is not exposure');
  assert.equal(byFile.get('tests/e2e/brand.spec.ts').kind, 'internal');
  assert.equal(byFile.get('src/widget.test.ts').kind, 'internal', '*.test.ts is a guard, not copy');
});

test('generated, vendored, and historical trees are not scanned', async () => {
  const root = await fixture({
    'docs/decisions.md': '美业内容簿\n',
    'references/mirror/app.ts': "const n = '美业内容簿';\n",
    'src/locale/paraglide/messages.js': "export const built_with_brand = () => '美业内容簿';\n",
    'node_modules/pkg/index.js': "const n = '美业内容簿';\n",
    'src/real.ts': "export const n = '美业内容簿';\n",
  });

  assert.deepEqual(
    scan(root).map((f) => f.file),
    ['src/real.ts'],
    'docs/ and references/ keep the retired name by design; paraglide output is generated'
  );
});

test('the scan does not report its own definition list', () => {
  const selfHits = scan(repositoryRoot).filter((f) =>
    f.file.endsWith('brand-exposure-scan.mjs')
  );
  assert.deepEqual(selfHits, [], 'the scanner names the retired brands and would find itself');
});

test('the retired names and their replacements are pinned to D-152', () => {
  assert.deepEqual(LEGACY_BRAND_NAMES, [
    '美业内容簿',
    '美业内容中台',
    '美业管理模式',
    'Beauty Content Desk',
    'Beauty admin mode',
  ]);
  assert.equal(BRAND_ZH, '丽客美页 LIKEPAGE');
  assert.equal(
    BRAND_EN,
    'LIKEPAGE',
    'EN pages take the Latin form; CJK there trips the no-CJK assertion in uiux-upgrade-b-results.spec.ts'
  );
});
