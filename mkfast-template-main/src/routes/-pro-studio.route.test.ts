import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('generated routing includes the Pro Studio page, entry and dedicated checkout APIs', async () => {
  const routeTree = await readFile(
    resolve(process.cwd(), 'src/routeTree.gen.ts'),
    'utf8'
  );
  assert.match(routeTree, /routes\/pro-studio/u);
  assert.match(routeTree, /api\/pro-studio\/entry/u);
  assert.match(routeTree, /api\/pro-studio\/checkout/u);
});
