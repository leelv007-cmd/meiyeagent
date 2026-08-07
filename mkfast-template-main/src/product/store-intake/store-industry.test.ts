import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  createProgressiveFactDraft,
  PRICE_VALIDITY_LONG_TERM,
} from '@/product/composer/progressive-fact';
import {
  MEDICAL_QUALIFICATION_INDUSTRIES,
  requiresMedicalQualification,
} from './store-industry';

/**
 * D-C3: 美甲 is the first persona and had no way to say so. This proves the
 * choice survives the store profile write path — the same finalize command the
 * wizard sends — while the today-recommendation layer keeps deciding on its own
 * what it can serve (covered core-side in foundation-module.test.ts).
 */
test('a 美甲 store keeps its 主营方向 through the profile write path', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );
  draft = answerProgressiveFact(draft, 'industry', '美甲');

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-nail',
    capturedAt: '2026-08-07T10:00:00.000Z',
    expectedRevision: 0,
    referenceId: 'progressive-card-nail',
    regulatedDefault: false,
    taskId: 'progressive-task-nail',
    workspaceId: 'workspace-a',
  });

  assert.equal(command?.payload.profilePatch.industry, '美甲');
  // The category is not medical, so Day-0 does not seed a regulated store.
  assert.equal(command?.payload.profilePatch.regulated, false);
});

test('first launch admits no medical category, so no ordinary store is asked for one', () => {
  assert.deepEqual([...MEDICAL_QUALIFICATION_INDUSTRIES], []);
  for (const industry of [
    'hair_care',
    'nail',
    'lash',
    'skin_management',
    'beauty_salon',
    'hair_growth',
  ]) {
    assert.equal(
      requiresMedicalQualification({ industry, regulated: false }),
      false,
      `${industry} must not be asked for medical qualification`
    );
  }
});

test('a regulated store, or one that already filed a record, still sees the block', () => {
  assert.equal(
    requiresMedicalQualification({
      industry: 'skin_management',
      regulated: true,
    }),
    true
  );
  assert.equal(
    requiresMedicalQualification({
      industry: 'nail',
      regulated: false,
      hasQualificationRecord: true,
    }),
    true
  );
});
