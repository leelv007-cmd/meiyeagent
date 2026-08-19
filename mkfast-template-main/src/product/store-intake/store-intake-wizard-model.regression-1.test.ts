import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerProgressiveFact,
  applyExtractedFacts,
  createProgressiveFactDraft,
} from '@/product/composer/progressive-fact';
import {
  applySentenceDraft,
  createStoreIntakeWizardState,
  editSentence,
} from './store-intake-wizard-model';

// Regression: ISSUE-004 — editing intake source kept stale parsed facts
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('editing the source clears AI suggestions and preserves trusted fields', () => {
  let state = createStoreIntakeWizardState(createProgressiveFactDraft());
  state = applySentenceDraft(
    editSentence(state, '项目名称：八月头皮护理\n日常价：239')
  );
  state = {
    ...state,
    draft: applyExtractedFacts(
      answerProgressiveFact(state.draft, 'name', '青禾养发工作室'),
      [
        {
          id: 'address',
          provenance: 'photo_extract',
          value: '西湖区文三路 1 号',
        },
      ]
    ),
  };

  const changed = editSentence(
    state,
    '青禾养发工作室在杭州，主营养发和头皮护理。'
  );

  assert.equal(changed.draft.projectName, '');
  assert.equal(changed.draft.projectPrice, '');
  assert.equal(changed.draft.provenance.projectName, undefined);
  assert.equal(changed.draft.provenance.projectPrice, undefined);
  assert.equal(changed.draft.name, '青禾养发工作室');
  assert.equal(changed.draft.provenance.name, 'user');
  assert.equal(changed.draft.address, '西湖区文三路 1 号');
  assert.equal(changed.draft.provenance.address, 'photo_extract');
  assert.equal(changed.arrangedOrigin, null);
});
