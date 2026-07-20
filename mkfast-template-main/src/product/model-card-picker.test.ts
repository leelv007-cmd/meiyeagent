import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ModelCardPicker, modelCardView } from './model-card-picker';

test('model cards expose catalog facts and resource units without credits', () => {
  const view = modelCardView(
    {
      availabilityKind: 'production',
      available: true,
      capabilityLabels: ['图片生成'],
      displayName: 'Seedream 5 Pro',
      id: 'seedream-5-pro',
      manufacturer: 'ByteDance',
      modality: 'image',
      qualityRank: 1,
      unitPrice: {
        amountMicros: 100_000,
        currency: 'CNY',
        revision: 'price-v1',
        unit: 'image',
      },
    },
    { available: 8, label: '图片张数' }
  );
  assert.equal(view.usageLabel, '图片张数可用 8');
  assert.match(view.metaLabel, /ByteDance/);
  assert.equal(view.previewUrl, '/seed/model/model-image-beauty.webp');
  assert.match(view.previewAlt, /非当前模型实测/);
  assert.doesNotMatch(JSON.stringify(view), /credit|token|积分/i);
});

test('unknown entitlement and unavailable model stay honest', () => {
  const view = modelCardView(
    {
      availabilityKind: 'unavailable',
      available: false,
      capabilityLabels: [],
      displayName: 'Named Model',
      id: 'named-model',
      modality: 'video',
      qualityRank: 0,
      unavailableReason: '当前工作区未激活',
    },
    undefined
  );
  assert.equal(view.usageLabel, '当前可用量未知');
  assert.equal(view.unavailableReason, '当前工作区未激活');
  assert.equal(view.previewUrl, '/seed/model/model-video-storyboard.webp');
  assert.equal(view.selectable, false);
});

test('each modality uses an authorized capability preview instead of a model sample', () => {
  const model = {
    availabilityKind: 'production' as const,
    available: true,
    capabilityLabels: ['文案生成'],
    displayName: 'Named Copy Model',
    id: 'named-copy-model',
    modality: 'llm' as const,
    qualityRank: 1,
  };

  const copyView = modelCardView(model);
  const imageView = modelCardView({ ...model, modality: 'image' });
  const videoView = modelCardView({ ...model, modality: 'video' });

  assert.equal(copyView.previewUrl, '/seed/model/model-copy-planning.webp');
  assert.equal(imageView.previewUrl, '/seed/model/model-image-beauty.webp');
  assert.equal(videoView.previewUrl, '/seed/model/model-video-storyboard.webp');
  assert.match(copyView.previewLabel, /能力预览/);
  assert.match(copyView.previewLabel, /非当前模型实测/);
});

test('every model capability preview asset is present in the public bundle', () => {
  for (const path of [
    'seed/model/model-copy-planning.webp',
    'seed/model/model-image-beauty.webp',
    'seed/model/model-video-storyboard.webp',
  ]) {
    assert.equal(
      existsSync(new URL(`../../public/${path}`, import.meta.url)),
      true,
      `${path} must exist`
    );
  }
});

test('missing quote evidence disables an otherwise available model on the card', () => {
  const view = modelCardView(
    {
      availabilityKind: 'production',
      available: true,
      capabilityLabels: ['视频生成'],
      displayName: 'Named Video Model',
      id: 'named-video-model',
      modality: 'video',
      qualityRank: 1,
    },
    undefined
  );

  assert.equal(view.selectable, false);
  assert.equal(view.statusLabel, '缺少报价');
  assert.match(view.quoteLabel, /报价证据缺失/);
});

test('priced model card shows this run output without provider currency', () => {
  const view = modelCardView({
    availabilityKind: 'production',
    available: true,
    capabilityLabels: ['文案生成'],
    displayName: 'Named Copy Model',
    id: 'named-copy-model',
    modality: 'llm',
    qualityRank: 1,
    unitPrice: {
      amountMicros: 100_000,
      currency: 'USD',
      revision: 'price-v2',
      unit: 'generation',
    },
  });

  assert.equal(view.selectable, true);
  assert.match(view.quoteLabel, /3 条内容候选/);
  assert.match(view.quoteLabel, /消耗产品额度|uses product allowance/u);
  assert.doesNotMatch(view.quoteLabel, /\$|USD|CNY|0\.30|price-v2/u);
});

test('single-channel model card tells merchants there is no fallback', () => {
  const view = modelCardView({
    availabilityKind: 'production',
    available: true,
    capabilityLabels: ['图片生成'],
    channelReadiness: 'single_channel',
    displayName: 'Named Image Model',
    id: 'named-image-model',
    modality: 'image',
    qualityRank: 1,
    unitPrice: {
      amountMicros: 100_000,
      currency: 'CNY',
      revision: 'price-v1',
      unit: 'image',
    },
  });

  assert.equal(view.channelReadinessLabel, '单渠道 / 无回退');
});

test('busy picker locks model changes while preserving the selected model', () => {
  const html = renderToStaticMarkup(
    createElement(ModelCardPicker, {
      busy: true,
      models: [
        {
          availabilityKind: 'production',
          available: true,
          capabilityLabels: ['文案生成'],
          displayName: 'Named Copy Model',
          id: 'named-copy-model',
          modality: 'llm',
          qualityRank: 1,
          unitPrice: {
            amountMicros: 100_000,
            currency: 'CNY',
            revision: 'price-v2',
            unit: 'generation',
          },
        },
      ],
      onChange() {},
      selectedModelId: 'named-copy-model',
    })
  );

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /value="named-copy-model"/);
});
