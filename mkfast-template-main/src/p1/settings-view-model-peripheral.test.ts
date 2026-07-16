import assert from 'node:assert/strict';
import test from 'node:test';

import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { normalizeCatalog } from './settings-view-model';

const catalogWithDomesticProvider = {
  models: [
    {
      available: true,
      id: 'llm-domestic',
      manufacturer: 'Domestic provider',
      modality: 'llm',
      operations: ['copy.generate'],
      qualityRank: 86,
    },
  ],
};

test('domestic provider uses the current locale public manufacturer name', () => {
  try {
    overwriteGetLocale(() => 'en');
    assert.equal(
      normalizeCatalog(catalogWithDomesticProvider, 'copy.generate').models[0]
        ?.manufacturer,
      'Domestic model provider'
    );

    overwriteGetLocale(() => 'zh');
    assert.equal(
      normalizeCatalog(catalogWithDomesticProvider, 'copy.generate').models[0]
        ?.manufacturer,
      '国内模型服务商'
    );
  } finally {
    overwriteGetLocale(() => 'zh');
  }
});
