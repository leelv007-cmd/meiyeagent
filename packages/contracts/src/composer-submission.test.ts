import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerSubmissionSignedFieldsSchema,
  isComposerVariantPlatform,
  pickComposerSubmissionSignedFields,
} from './composer-submission.js';

const signedFields = {
  catalogModel: { id: 'model-copy', revision: 'catalog-r1' },
  recipe: { id: 'recipe-copy', revision: 'recipe-copy@1' },
  contentPackagePlatform: 'wechat_moments' as const,
  distributionTarget: 'assisted_handoff' as const,
  deliverable: { kind: 'copy_document' as const, quantity: 1 },
};

test('freezes the exact extensible signed-field schema without server fields', () => {
  const picked = pickComposerSubmissionSignedFields({
    ...signedFields,
    route: { id: 'browser-forged-route' },
  });
  assert.deepEqual(picked, signedFields);
  assert.deepEqual(composerSubmissionSignedFieldsSchema.parse(picked), picked);
});

test('wechat_moments is a delivery target but not a variant platform', () => {
  assert.equal(isComposerVariantPlatform('wechat_moments'), false);
  assert.equal(isComposerVariantPlatform('xiaohongshu'), true);
});
