import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROMOTIONAL_MATERIAL_SPECS } from '@meiye/contracts';

import {
  lightCanvasImageDrawArguments,
  LightComposerCanvas,
} from './light-composer-canvas';

test('maps a normalized source crop to exact raster pixels while preserving the destination box', () => {
  const element = {
    assetId: 'asset-a',
    crop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
    height: 600,
    id: 'hero',
    kind: 'image' as const,
    rotation: 0,
    width: 900,
    x: 90,
    y: 300,
  };

  assert.deepEqual(
    lightCanvasImageDrawArguments(element, 20, 10),
    [2, 1, 16, 8, -450, -300, 900, 600]
  );
  assert.deepEqual(
    lightCanvasImageDrawArguments({ ...element, crop: undefined }, 20, 10),
    [0, 0, 20, 10, -450, -300, 900, 600]
  );
});

test('renders the daily editing surface without free-node or layer controls', () => {
  const html = renderToStaticMarkup(
    <LightComposerCanvas
      aigcLabelEnabled
      document={{
        height: 1350,
        pages: [
          {
            elements: [
              {
                height: 120,
                id: 'headline',
                kind: 'text',
                rotation: 0,
                text: '夏日透亮甲',
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
                width: 900,
                x: 90,
                y: 300,
              },
            ],
            id: 'page-1',
          },
        ],
        width: 1080,
      }}
      documentRevision="revision-1"
      libraryAssets={[
        {
          authorizationStatus: 'authorized',
          id: 'asset-a',
          label: '门店图',
          objectKey: 'workspace/assets/store.png',
          sourceType: 'real',
          src: '/api/storage/file?key=store.png',
        },
      ]}
      onAigcLabelChange={() => {}}
      onExport={() => {}}
      onSave={() => {}}
      onSaveAsTemplate={() => {}}
      onWatermarkChange={() => {}}
      watermarkEnabled
      watermarkText="清风美学"
    />
  );

  assert.match(html, /日常轻编辑/u);
  assert.match(html, /夏日透亮甲/u);
  assert.match(html, /替换为门店图/u);
  assert.match(html, /裁剪 10%/u);
  assert.match(html, /上移|下移/u);
  assert.doesNotMatch(html, /自由连线|任意节点|复杂图层/u);
});

test('uses only carrier-provided material specs with a merchant-facing label', () => {
  const offlineSpec = PROMOTIONAL_MATERIAL_SPECS[3];
  const html = renderToStaticMarkup(
    <LightComposerCanvas
      aigcLabelEnabled
      document={{
        height: 1350,
        pages: [{ elements: [], id: 'page-1' }],
        width: 1080,
      }}
      documentRevision="revision-carrier"
      initialPromotionalMaterialPurpose={offlineSpec.purpose}
      onAigcLabelChange={() => {}}
      onExport={() => {}}
      onSave={() => {}}
      onWatermarkChange={() => {}}
      promotionalMaterialSpecs={[offlineSpec]}
      watermarkEnabled={false}
    />
  );

  assert.match(html, /A4 门店海报 · 2480×3508/u);
  assert.match(html, /value="offline_a4_poster" selected=""/u);
  assert.doesNotMatch(html, /xiaohongshu_cover|offline_a4_poster ·/u);
});
