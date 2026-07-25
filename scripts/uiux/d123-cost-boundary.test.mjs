import assert from 'node:assert/strict';
import test from 'node:test';

import { findD123CostBoundaryFindings } from './d123-cost-boundary.mjs';

test('D-123 cost boundary rejects internal cost and margin numbers', () => {
  const findings = findD123CostBoundaryFindings([
    {
      path: 'apps/example.ts',
      text: ['const note = "图片约0.5元";', 'const margin = "毛利 70%";'].join(
        '\n',
      ),
    },
  ]);
  assert.deepEqual(findings, [
    { path: 'apps/example.ts', line: 1 },
    { path: 'apps/example.ts', line: 2 },
  ]);
});

test('D-123 cost boundary permits merchant prices and allowance quantities', () => {
  assert.deepEqual(
    findD123CostBoundaryFindings([
      {
        path: 'apps/example.ts',
        text: 'const trial = { copy: 5, image: 5, video: 1, price: 99 };',
      },
    ]),
    [],
  );
});
