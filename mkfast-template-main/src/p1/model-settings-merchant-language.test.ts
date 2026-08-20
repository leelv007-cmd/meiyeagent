import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  model_settings_auto_badge,
  model_settings_auto_description,
  model_settings_auto_selected_toast,
  model_settings_auto_title,
  model_settings_auto_use,
  model_settings_llm_description,
  model_settings_llm_title,
  settings_models_advanced_description,
  settings_models_advanced_heading,
  settings_models_description,
  settings_models_preferences_heading,
  settings_models_summary_auto,
  settings_models_summary_detail_named,
  settings_models_summary_line,
  settings_models_system_blurb,
} from '@/locale/paraglide/messages';

import { buildModelSettingsSummaryLines } from './model-settings';
import type { CatalogModelView } from './settings-view-model';

const MERCHANT_COPY = [
  model_settings_auto_badge(),
  model_settings_auto_description(),
  model_settings_auto_selected_toast(),
  model_settings_auto_title(),
  model_settings_auto_use(),
  model_settings_llm_description(),
  model_settings_llm_title(),
  settings_models_advanced_description(),
  settings_models_advanced_heading(),
  settings_models_description(),
  settings_models_preferences_heading(),
  settings_models_summary_auto(),
  settings_models_summary_detail_named({
    name: 'OpenAI Direct',
    source: settings_models_summary_auto(),
  }),
  settings_models_summary_line({
    detail: settings_models_summary_auto(),
    type: model_settings_llm_title(),
  }),
  settings_models_system_blurb(),
];

function model(id: string, displayName = id): CatalogModelView {
  return {
    availabilityKind: 'production',
    available: true,
    capabilityLabels: ['copy'],
    displayName,
    id,
    modality: 'llm',
    qualityRank: 1,
    unitPrice: {
      amountMicros: 1_000,
      currency: 'CNY',
      revision: 'price-v1',
      unit: 'request',
    },
  };
}

test('merchant model settings copy never exposes LLM jargon', () => {
  for (const text of MERCHANT_COPY) {
    assert.doesNotMatch(text, /\bLLM\b/u, `merchant copy leaked LLM: ${text}`);
  }
  assert.match(model_settings_llm_title(), /文案模型|Copy models/u);
  assert.match(
    settings_models_preferences_heading(),
    /模型偏好|Model preferences/u
  );
  assert.match(settings_models_summary_auto(), /自动|Automatic/u);
  assert.match(
    settings_models_advanced_heading(),
    /自己挑选|Advanced|Choose yourself/u
  );
});

test('default summary uses resolved model names and falls back to automatic', () => {
  const lines = buildModelSettingsSummaryLines({
    currentSelections: {
      'copy.generate': 'llm-openai',
    },
    sections: [
      {
        id: 'llm',
        operation: 'copy.generate',
        title: () => '文案模型',
      },
      {
        id: 'image',
        operation: 'image.generate',
        title: () => '图片模型',
      },
      {
        id: 'video',
        operation: 'video.generate',
        title: () => '视频模型',
      },
    ],
    snapshots: [
      {
        catalog: [model('llm-openai', 'OpenAI Direct')],
        preferences: {
          favorites: [],
          recent: [],
          userDefault: 'llm-openai',
        },
      },
      {
        catalog: [model('seedream-5-pro', 'Seedream')],
        preferences: {
          favorites: [],
          platformDefault: 'seedream-5-pro',
          recent: [],
        },
      },
      {
        catalog: [],
        preferences: { favorites: [], recent: [] },
      },
    ],
  });

  assert.equal(lines.length, 3);
  assert.match(lines[0]!.detail, /OpenAI Direct/);
  assert.match(lines[1]!.detail, /Seedream/);
  assert.equal(lines[2]!.detail, settings_models_summary_auto());
});

test('model settings keeps catalog and BYOK behind advanced collapse', () => {
  const modelSettings = readFileSync(
    new URL('./model-settings.tsx', import.meta.url),
    'utf8'
  );
  const modelsPage = readFileSync(
    new URL('../routes/settings/models.tsx', import.meta.url),
    'utf8'
  );

  assert.match(modelSettings, /data-testid="model-settings-default"/u);
  assert.match(modelSettings, /data-testid="model-settings-advanced-trigger"/u);
  assert.match(modelSettings, /settings_models_advanced_heading/u);
  assert.match(modelSettings, /CollapsibleContent[\s\S]*advancedExtra/u);
  assert.match(modelsPage, /advancedExtra=\{/u);
  assert.match(modelsPage, /ModelByokSettings/u);
  assert.match(modelsPage, /id="byok"/u);
  // Catalog tabs live inside ModelSettings advanced content, not the page shell.
  assert.doesNotMatch(modelsPage, /TabsTrigger/u);
});
