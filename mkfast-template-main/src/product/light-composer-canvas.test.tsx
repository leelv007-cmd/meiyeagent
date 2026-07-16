import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { LightComposerCanvas } from './light-composer-canvas';

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
