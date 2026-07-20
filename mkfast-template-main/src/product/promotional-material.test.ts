import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMOTIONAL_MATERIAL_SPECS } from '@meiye/contracts';

import {
  finalizePromotionalMaterialReceipt,
  planPromotionalMaterialExport,
  resizeLightComposerDocumentForMaterial,
} from './promotional-material';

const document = {
  width: 1080,
  height: 1350,
  pages: [
    {
      id: 'page-1',
      elements: [
        {
          id: 'title',
          kind: 'text' as const,
          text: '标题',
          x: 108,
          y: 135,
          width: 864,
          height: 160,
          rotation: 0,
          fontSize: 48,
        },
      ],
    },
  ],
};

test('material resize uses the existing Light Composer document model', () => {
  const spec = PROMOTIONAL_MATERIAL_SPECS[2];
  const resized = resizeLightComposerDocumentForMaterial(document, spec);

  assert.equal(resized.width, 1080);
  assert.equal(resized.height, 1080);
  assert.equal(resized.pages[0]?.elements[0]?.y, 108);
  assert.equal(resized.pages[0]?.elements[0]?.height, 128);
});

test('unverified material rendering produces an explicit assisted text-only export', async () => {
  const planned = planPromotionalMaterialExport({
    availableAssetIds: [],
    capabilityStatus: 'assisted',
    document: {
      ...document,
      pages: [
        {
          ...document.pages[0]!,
          elements: [
            ...document.pages[0]!.elements,
            {
              assetId: 'missing-photo',
              height: 480,
              id: 'hero-photo',
              kind: 'image' as const,
              rotation: 0,
              width: 864,
              x: 108,
              y: 360,
            },
          ],
        },
      ],
    },
    spec: PROMOTIONAL_MATERIAL_SPECS[2],
  });

  assert.equal(planned.missingMaterialFallback, 'text_only');
  assert.equal(planned.document.pages[0]?.elements.length, 1);
  assert.equal(planned.document.pages[0]?.elements[0]?.kind, 'text');
  assert.deepEqual(
    await finalizePromotionalMaterialReceipt({
      dataUrl: 'data:image/png;base64,cG5n',
      plan: planned,
      provenanceRef: 'canvas-revision-2',
    }),
    {
      capabilityStatus: 'assisted',
      missingMaterialFallback: 'text_only',
      outputSha256:
        '8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c',
      provenanceRef: 'canvas-revision-2',
    }
  );
});

test('verified material rendering replaces missing real assets with a brand-safe placeholder', async () => {
  const planned = planPromotionalMaterialExport({
    availableAssetIds: [],
    capabilityStatus: 'verified',
    document: {
      ...document,
      pages: [
        {
          ...document.pages[0]!,
          elements: [
            ...document.pages[0]!.elements,
            {
              assetId: 'missing-photo',
              height: 480,
              id: 'hero-photo',
              kind: 'image' as const,
              rotation: 0,
              width: 864,
              x: 108,
              y: 360,
            },
          ],
        },
      ],
    },
    spec: PROMOTIONAL_MATERIAL_SPECS[2],
  });
  const image = planned.document.pages[0]?.elements.find(
    (element) => element.kind === 'image'
  );

  assert.equal(planned.missingMaterialFallback, 'brand_safe_placeholder');
  assert.match(
    image?.kind === 'image' ? (image.src ?? '') : '',
    /^data:image\/svg\+xml/u
  );
  assert.deepEqual(
    await finalizePromotionalMaterialReceipt({
      dataUrl: 'data:image/png;base64,cG5n',
      plan: planned,
      provenanceRef: 'canvas-revision-3',
    }),
    {
      capabilityStatus: 'verified',
      missingMaterialFallback: 'brand_safe_placeholder',
      outputSha256:
        '8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c',
      provenanceRef: 'canvas-revision-3',
    }
  );
});
