import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('retired canvas SDK is absent from runtime, dependencies, env, locale, and lockfile', async () => {
  const packageJson = JSON.parse(
    await text('mkfast-template-main/package.json')
  );
  assert.equal(packageJson.dependencies.polotno, undefined);
  assert.doesNotMatch(await text('pnpm-lock.yaml'), /polotno/iu);
  assert.doesNotMatch(
    `${await text('mkfast-template-main/src/env/client.ts')}\n${await text(
      'mkfast-template-main/.env.example'
    )}`,
    /polotno/iu
  );
  assert.doesNotMatch(
    `${await text(
      'mkfast-template-main/project.inlang/messages/zh.json'
    )}\n${await text('mkfast-template-main/project.inlang/messages/en.json')}`,
    /polotno/iu
  );
  for (const path of [
    'mkfast-template-main/src/p1/polotno-canvas-runtime.tsx',
    'mkfast-template-main/src/p1/polotno-canvas.tsx',
    'mkfast-template-main/src/p1/polotno-export-labels.ts',
    'mkfast-template-main/src/product/polotno-license.ts',
  ]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});

test('ticket 20 gate ④: owning canvas entry routes use Light Composer, not Polotno', async () => {
  const canvasWorkPage = await text(
    'mkfast-template-main/src/product/canvas-work-page.tsx'
  );
  assert.match(canvasWorkPage, /LightComposerCanvas|light-composer-canvas/u);
  assert.doesNotMatch(canvasWorkPage, /polotno/iu);

  const routeTree = await text('mkfast-template-main/src/routeTree.gen.ts');
  assert.match(routeTree, /dashboard\/works/u);

  for (const path of [
    'mkfast-template-main/src/routes/dashboard/works.tsx',
    'mkfast-template-main/src/routes/dashboard/works_/$workId.tsx',
  ]) {
    const source = await text(path);
    assert.doesNotMatch(source, /polotno/iu, path);
  }
});
