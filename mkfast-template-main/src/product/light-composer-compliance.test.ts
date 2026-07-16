import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLightComposerComplianceLabels } from './light-composer-compliance';
import { renderLightCanvasDocument } from './light-composer-canvas';
import { overwriteGetLocale } from '../locale/paraglide/runtime';

test('renders the exact four watermark and AIGC compliance combinations', () => {
  const copy = { aigc: 'AI generated', watermark: 'Brand' };
  assert.deepEqual(
    buildLightComposerComplianceLabels(
      { aigcLabelEnabled: false, watermarkEnabled: false },
      copy
    ),
    []
  );
  assert.deepEqual(
    buildLightComposerComplianceLabels(
      { aigcLabelEnabled: true, watermarkEnabled: false },
      copy
    ),
    [{ kind: 'aigc', text: 'AI generated' }]
  );
  assert.deepEqual(
    buildLightComposerComplianceLabels(
      { aigcLabelEnabled: false, watermarkEnabled: true },
      copy
    ),
    [{ kind: 'watermark', text: 'Brand' }]
  );
  assert.deepEqual(
    buildLightComposerComplianceLabels(
      {
        aigcLabelEnabled: true,
        watermarkEnabled: true,
        watermarkText: '  Custom Brand  ',
      },
      copy
    ),
    [
      { kind: 'aigc', text: 'AI generated' },
      { kind: 'watermark', text: 'Custom Brand' },
    ]
  );
});

test('burns enabled labels into the raster before returning the PNG binary', async () => {
  overwriteGetLocale(() => 'zh');
  const text: string[] = [];
  const context = {
    fillRect() {},
    fillStyle: '',
    fillText(value: string) {
      text.push(value);
    },
    font: '',
    globalAlpha: 1,
    restore() {},
    rotate() {},
    save() {},
    textBaseline: 'top',
    translate() {},
  };
  const canvas = {
    getContext: () => context,
    height: 0,
    toDataURL: () => 'data:image/png;base64,cG5n',
    width: 0,
  };
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { document: { createElement: () => canvas } },
  });
  try {
    const dataUrl = await renderLightCanvasDocument(
      {
        height: 1350,
        pages: [{ elements: [], id: 'page-1' }],
        width: 1080,
      },
      [],
      {
        aigcLabelEnabled: true,
        watermarkEnabled: true,
        watermarkText: '清风美学',
      }
    );

    assert.equal(dataUrl, 'data:image/png;base64,cG5n');
    assert.deepEqual(text, ['AI 生成', '清风美学']);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('renderer emits distinct raster bytes for each compliance switch combination', async () => {
  overwriteGetLocale(() => 'zh');
  const drawnLabels: string[] = [];
  const context = {
    fillRect() {},
    fillStyle: '',
    fillText(value: string) {
      drawnLabels.push(value);
    },
    font: '',
    globalAlpha: 1,
    restore() {},
    rotate() {},
    save() {},
    textBaseline: 'top',
    translate() {},
  };
  const canvas = {
    getContext: () => context,
    height: 0,
    toDataURL: () =>
      `data:image/png;base64,${Buffer.from(drawnLabels.join('|')).toString('base64')}`,
    width: 0,
  };
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { document: { createElement: () => canvas } },
  });
  try {
    const combinations = [
      { aigcLabelEnabled: false, watermarkEnabled: false },
      { aigcLabelEnabled: true, watermarkEnabled: false },
      { aigcLabelEnabled: false, watermarkEnabled: true },
      {
        aigcLabelEnabled: true,
        watermarkEnabled: true,
        watermarkText: '清风美学',
      },
    ] as const;
    const outputs: string[] = [];
    const labels: string[][] = [];
    for (const combination of combinations) {
      drawnLabels.length = 0;
      outputs.push(
        await renderLightCanvasDocument(
          {
            height: 1350,
            pages: [{ elements: [], id: 'page-1' }],
            width: 1080,
          },
          [],
          combination
        )
      );
      labels.push([...drawnLabels]);
    }
    assert.equal(new Set(outputs).size, 4);
    assert.deepEqual(labels, [
      [],
      ['AI 生成'],
      ['品牌内容'],
      ['AI 生成', '清风美学'],
    ]);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});
