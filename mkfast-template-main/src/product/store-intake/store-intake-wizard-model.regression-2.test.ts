import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgressiveFactDraft } from '@/product/composer/progressive-fact';
import {
  applyLlmSentenceSuggestions,
  createStoreIntakeWizardState,
  editSentence,
} from './store-intake-wizard-model';

// Regression: ISSUE-005 — negative intake scope became a project fact
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('LLM suggestions respect explicit project and price negation', () => {
  const state = editSentence(
    createStoreIntakeWizardState(createProgressiveFactDraft()),
    '只补充青禾养发工作室在杭州的门店基础资料，不记录项目和价格。'
  );
  const filled = applyLlmSentenceSuggestions(state, [
    { id: 'projectName', value: '不记录项目和' },
    { id: 'projectPrice', value: '99' },
    { id: 'city', value: '杭州' },
  ]);

  assert.equal(filled.draft.projectName, '');
  assert.equal(filled.draft.projectPrice, '');
  assert.equal(filled.draft.city, '杭州');
});

test('field-first negation also refuses project and price suggestions', () => {
  const state = editSentence(
    createStoreIntakeWizardState(createProgressiveFactDraft()),
    '项目和价格暂不记录，只确认门店名称。'
  );
  const filled = applyLlmSentenceSuggestions(state, [
    { id: 'projectName', value: '项目和价格暂不' },
    { id: 'projectPrice', value: '199' },
  ]);

  assert.equal(filled.draft.projectName, '');
  assert.equal(filled.draft.projectPrice, '');
});
