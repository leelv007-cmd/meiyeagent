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
  const worksLightEditPage = await text(
    'mkfast-template-main/src/product/works/works-light-edit-page.tsx'
  );
  assert.match(
    worksLightEditPage,
    /LightComposerCanvas|light-composer-canvas/u
  );
  assert.doesNotMatch(worksLightEditPage, /polotno/iu);

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

test('the delete-after-reshell retirement tooling is physically removed', async () => {
  const corePackage = JSON.parse(await text('apps/core/package.json'));
  for (const script of [
    'canvas:retirement-access',
    'canvas:retirement-inventory',
    'canvas:renderer-comparison',
    'canvas:retirement-snapshot',
  ]) {
    assert.equal(corePackage.scripts[script], undefined, script);
  }
  for (const file of [
    'polotno-retirement-access-cli.ts',
    'polotno-retirement-access.ts',
    'polotno-retirement-inventory-cli.ts',
    'polotno-retirement-inventory.ts',
    'polotno-retirement-snapshot-cli-entry.ts',
    'polotno-retirement-snapshot-cli.ts',
    'polotno-retirement-snapshot.ts',
    'renderer-comparison-cli.ts',
    'renderer-comparison.ts',
  ]) {
    assert.equal(
      existsSync(new URL(`apps/core/src/p1/operations/${file}`, root)),
      false,
      file
    );
  }
});
