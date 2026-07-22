import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canvasInitialChunkPaths,
  canvasInitialChunkPathsFromClientReference,
  findMainWebCanvasImportViolations,
  validateCanvasBundleBudget,
} from './canvas-bundle-budget.mjs';

test('Canvas bundle budget counts only the initial app-route chunks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-bundle-'));
  try {
    mkdirSync(join(directory, 'static', 'chunks'), { recursive: true });
    writeFileSync(
      join(directory, 'app-build-manifest.json'),
      JSON.stringify({
        pages: {
          '/page': ['static/chunks/app.js', 'static/chunks/app.js', 'static/chunks/lazy.css'],
        },
      })
    );
    writeFileSync(join(directory, 'static', 'chunks', 'app.js'), 'small app chunk');
    assert.deepEqual(
      canvasInitialChunkPaths({ pages: { '/page': ['static/chunks/app.js'] } }),
      ['static/chunks/app.js']
    );
    assert.deepEqual(validateCanvasBundleBudget(directory, 1000), []);
    assert.deepEqual(validateCanvasBundleBudget(directory, 1), [
      `${directory}: Canvas initial gzip 35 exceeds budget 1`,
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('Main Web cannot import Canvas app modules', () => {
  assert.deepEqual(
    findMainWebCanvasImportViolations([
      { contents: 'import type { X } from "@meiye/canvas";', path: 'main.tsx' },
      { contents: 'const origin = process.env.CANVAS_ORIGIN;', path: 'launch.ts' },
    ]),
    ['main.tsx: Main Web must not import Canvas app modules']
  );
});

test('Canvas bundle budget supports the Next client-reference manifest fallback', () => {
  assert.deepEqual(
    canvasInitialChunkPathsFromClientReference(
      {
        polyfillFiles: ['static/chunks/polyfills.js'],
        rootMainFiles: ['static/chunks/webpack.js'],
      },
      'chunks:["17","static/chunks/app/page.js","static/chunks/app/layout.js"]'
    ),
    [
      'static/chunks/app/layout.js',
      'static/chunks/app/page.js',
      'static/chunks/polyfills.js',
      'static/chunks/webpack.js',
    ]
  );
});
