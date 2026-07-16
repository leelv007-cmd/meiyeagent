import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLightComposerEdit,
  parseLightCanvasDocument,
} from './light-composer-document';

const document = parseLightCanvasDocument({
  height: 1350,
  pages: [
    {
      id: 'page-1',
      elements: [
        {
          height: 120,
          id: 'headline',
          kind: 'text',
          rotation: 0,
          text: '旧标题',
          width: 800,
          x: 100,
          y: 100,
        },
        {
          assetId: 'asset-old',
          height: 600,
          id: 'hero',
          kind: 'image',
          rotation: 0,
          width: 900,
          x: 90,
          y: 300,
        },
        {
          height: 100,
          id: 'footer',
          kind: 'text',
          rotation: 0,
          text: '到店有礼',
          width: 800,
          x: 100,
          y: 1100,
        },
      ],
    },
  ],
  width: 1080,
});

test('light Composer edits copy, replaces/crops images, and reorders modules without changing the contract', () => {
  const copyEdited = applyLightComposerEdit(document, {
    elementId: 'headline',
    text: '夏日透亮甲',
    type: 'edit_text',
  });
  const imageEdited = applyLightComposerEdit(copyEdited, {
    assetId: 'asset-new',
    crop: { height: 0.75, width: 0.8, x: 0.1, y: 0.2 },
    elementId: 'hero',
    src: '/api/storage/file?key=new.png',
    type: 'replace_image',
  });
  const reordered = applyLightComposerEdit(imageEdited, {
    elementId: 'footer',
    targetIndex: 0,
    type: 'reorder_module',
  });

  assert.equal(reordered.pages[0]?.elements[0]?.id, 'footer');
  assert.equal(reordered.pages[0]?.elements[1]?.kind, 'text');
  assert.equal(
    reordered.pages[0]?.elements[1]?.kind === 'text'
      ? reordered.pages[0].elements[1].text
      : undefined,
    '夏日透亮甲'
  );
  assert.deepEqual(reordered.pages[0]?.elements[2], {
    assetId: 'asset-new',
    height: 450,
    id: 'hero',
    kind: 'image',
    rotation: 0,
    src: '/api/storage/file?key=new.png',
    width: 720,
    x: 180,
    y: 420,
  });
  assert.equal(document.pages[0]?.elements[0]?.kind, 'text');
  assert.equal(
    document.pages[0]?.elements[0]?.kind === 'text'
      ? document.pages[0].elements[0].text
      : undefined,
    '旧标题'
  );
});

test('light Composer rejects free-node fields and invalid crop bounds', () => {
  assert.throws(
    () =>
      parseLightCanvasDocument({
        ...document,
        pages: [
          {
            elements: [
              {
                fromNodeId: 'node-a',
                id: 'edge-a',
                kind: 'edge',
                toNodeId: 'node-b',
              },
            ],
            id: 'page-1',
          },
        ],
      }),
    /light Composer supports only text and image modules/u
  );
  assert.throws(
    () =>
      applyLightComposerEdit(document, {
        assetId: 'asset-new',
        crop: { height: 1, width: 1, x: 0.5, y: 0 },
        elementId: 'hero',
        type: 'replace_image',
      }),
    /crop must stay inside the source image/u
  );
});

test('opens historical text and image documents through the light contract', () => {
  assert.deepEqual(
    parseLightCanvasDocument({
      height: 1350,
      pages: [
        {
          children: [
            {
              height: 120,
              id: 'headline',
              text: '历史标题',
              type: 'text',
              width: 800,
              x: 100,
              y: 100,
            },
            {
              custom: { productAssetId: 'asset-a' },
              height: 600,
              id: 'hero',
              src: '/api/storage/file?key=hero.png',
              type: 'image',
              width: 900,
              x: 90,
              y: 300,
            },
          ],
          id: 'legacy-page',
        },
      ],
      width: 1080,
    }),
    {
      height: 1350,
      pages: [
        {
          elements: [
            {
              height: 120,
              id: 'headline',
              kind: 'text',
              rotation: 0,
              text: '历史标题',
              width: 800,
              x: 100,
              y: 100,
            },
            {
              assetId: 'asset-a',
              height: 600,
              id: 'hero',
              kind: 'image',
              rotation: 0,
              src: '/api/storage/file?key=hero.png',
              width: 900,
              x: 90,
              y: 300,
            },
          ],
          id: 'legacy-page',
        },
      ],
      width: 1080,
    }
  );
});
