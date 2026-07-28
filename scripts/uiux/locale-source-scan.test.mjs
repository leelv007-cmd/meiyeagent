import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

test('locale source scan preserves TypeScript literals while excluding comments', () => {
  const probe = `
    (async () => {
      const { sourceHasCjkOutsideComments } =
        await import('./scripts/check-locale-keys.ts');
      const cases = [
        sourceHasCjkOutsideComments("export enum E { A = '中文' }", 'probe.ts'),
        sourceHasCjkOutsideComments("type T = '中文'", 'probe.ts'),
        sourceHasCjkOutsideComments("interface I { value: '中文' }", 'probe.ts'),
        sourceHasCjkOutsideComments("// 中文 only", 'probe.ts'),
        sourceHasCjkOutsideComments(
          "const view = <div>{/* 中文 only */}</div>",
          'probe.tsx'
        ),
      ];
      process.stdout.write(JSON.stringify(cases));
    })();
  `;
  const output = execFileSync(
    'pnpm',
    ['--filter', '@meiye/web', 'exec', 'tsx', '-e', probe],
    { cwd: rootDir, encoding: 'utf8' }
  );

  assert.deepEqual(JSON.parse(output.slice(output.lastIndexOf('['))), [
    true,
    true,
    true,
    false,
    false,
  ]);
});
