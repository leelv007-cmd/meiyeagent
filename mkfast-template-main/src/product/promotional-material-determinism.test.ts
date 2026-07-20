import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMOTIONAL_MATERIAL_SPECS } from '@meiye/contracts';
import { overwriteGetLocale } from '../locale/paraglide/runtime';

import { renderLightCanvasDocument } from './light-composer-canvas';
import {
  assertPromotionalMaterialTextSafeArea,
  finalizePromotionalMaterialReceipt,
  planPromotionalMaterialExport,
  promotionalMaterialTextSafeAreaBounds,
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

test('material text bounds use the frozen textSafeArea and reject clipping', () => {
  const spec = PROMOTIONAL_MATERIAL_SPECS[2];
  const resized = resizeLightComposerDocumentForMaterial(document, spec);

  assert.deepEqual(promotionalMaterialTextSafeAreaBounds(spec), {
    bottom: 994,
    left: 86,
    right: 994,
    top: 86,
  });
  assert.doesNotThrow(() =>
    assertPromotionalMaterialTextSafeArea(resized, spec)
  );
  assert.throws(
    () =>
      assertPromotionalMaterialTextSafeArea(
        {
          ...resized,
          pages: [
            {
              ...resized.pages[0]!,
              elements: resized.pages[0]!.elements.map((element) =>
                element.id === 'title' ? { ...element, y: 85 } : element
              ),
            },
          ],
        },
        spec
      ),
    /title.*textSafeArea/u
  );
});

test('fixed renderer output bytes have the same SHA256 across two exports', async () => {
  overwriteGetLocale(() => 'zh');
  const plan = planPromotionalMaterialExport({
    availableAssetIds: [],
    capabilityStatus: 'verified',
    document,
    spec: PROMOTIONAL_MATERIAL_SPECS[2],
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      document: {
        createElement: () => {
          const draws: unknown[] = [];
          const context = {
            fillRect: (...args: unknown[]) => draws.push(['fillRect', ...args]),
            fillStyle: '',
            fillText: (...args: unknown[]) => draws.push(['fillText', ...args]),
            font: '',
            globalAlpha: 1,
            restore: () => draws.push(['restore']),
            rotate: (...args: unknown[]) => draws.push(['rotate', ...args]),
            save: () => draws.push(['save']),
            textBaseline: 'top',
            translate: (...args: unknown[]) =>
              draws.push(['translate', ...args]),
          };
          return {
            getContext: () => context,
            height: 0,
            // Node has no browser Canvas. The existing renderer seam is kept,
            // while final toDataURL bytes encode its draw trace deterministically.
            toDataURL: () =>
              `data:image/png;base64,${Buffer.from(JSON.stringify(draws)).toString('base64')}`,
            width: 0,
          };
        },
      },
    },
  });
  try {
    const labels = { aigcLabelEnabled: false, watermarkEnabled: false };
    const firstBytes = await renderLightCanvasDocument(
      plan.document,
      [],
      labels
    );
    const replayBytes = await renderLightCanvasDocument(
      plan.document,
      [],
      labels
    );
    const changedBytes = await renderLightCanvasDocument(
      {
        ...plan.document,
        pages: [
          {
            ...plan.document.pages[0]!,
            elements: plan.document.pages[0]!.elements.map((element) =>
              element.kind === 'text'
                ? { ...element, text: '不同的标题' }
                : element
            ),
          },
        ],
      },
      [],
      labels
    );
    const first = await finalizePromotionalMaterialReceipt({
      dataUrl: firstBytes,
      plan,
      provenanceRef: 'canvas-revision-2',
    });
    const replay = await finalizePromotionalMaterialReceipt({
      dataUrl: replayBytes,
      plan,
      provenanceRef: 'canvas-revision-2',
    });
    const changed = await finalizePromotionalMaterialReceipt({
      dataUrl: changedBytes,
      plan,
      provenanceRef: 'canvas-revision-2',
    });

    assert.equal(replay.outputSha256, first.outputSha256);
    assert.notEqual(changed.outputSha256, first.outputSha256);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});
