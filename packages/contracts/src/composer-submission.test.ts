import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerDistributionTargetSchema,
  composerSubmissionSignedFieldsSchema,
  isComposerVariantPlatform,
  pickComposerSubmissionSignedFields,
} from './composer-submission.js';

const signedFields = {
  creationMode: 'customized' as const,
  intent: '为夏日护理项目写一条预约文案',
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

test('intent and creation mode are required quote-signed fields', () => {
  const { intent: _intent, ...withoutIntent } = signedFields;
  const { creationMode: _creationMode, ...withoutCreationMode } = signedFields;

  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse(withoutIntent).success,
    false,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse(withoutCreationMode).success,
    false,
  );
});

test('free image operation is signed while customized and non-image submissions reject it', () => {
  const freeImage = {
    ...signedFields,
    creationMode: 'free' as const,
    imageOperation: 'image.edit' as const,
    deliverable: {
      kind: 'image_set' as const,
      quantity: 1,
      aspectRatio: '3:4' as const,
    },
  };
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse(freeImage).success,
    true,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...freeImage,
      creationMode: 'customized',
    }).success,
    false,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...freeImage,
      deliverable: { kind: 'copy_document', quantity: 1 },
    }).success,
    false,
  );
});

test('AI cover choices are quote-signed and reject mismatched output dimensions', () => {
  const aiCover = {
    ...signedFields,
    creationMode: 'free' as const,
    imageOperation: 'image.generate' as const,
    recipe: {
      id: 'recipe.promotion_poster',
      revision: 'recipe-promotion-poster-r1',
    },
    contentPackagePlatform: 'xiaohongshu' as const,
    deliverable: {
      kind: 'poster' as const,
      quantity: 1,
      aspectRatio: '9:16' as const,
    },
    aiCover: {
      aspectRatio: '9:16' as const,
      style: 'beauty_editorial' as const,
      size: '1152x2048' as const,
    },
  };

  assert.deepEqual(pickComposerSubmissionSignedFields(aiCover), aiCover);
  assert.equal(composerSubmissionSignedFieldsSchema.safeParse(aiCover).success, true);
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...aiCover,
      aiCover: { ...aiCover.aiCover, size: '2048x2048' },
    }).success,
    false,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...aiCover,
      aiCover: { ...aiCover.aiCover, size: '1440x2560' },
    }).success,
    false,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...aiCover,
      deliverable: { ...aiCover.deliverable, aspectRatio: '1:1' },
    }).success,
    false,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...aiCover,
      recipe: { id: 'recipe.other_poster', revision: 'recipe-r1' },
    }).success,
    false,
  );
});

test('wechat_moments is a delivery target but not a variant platform', () => {
  assert.equal(isComposerVariantPlatform('wechat_moments'), false);
  assert.equal(isComposerVariantPlatform('xiaohongshu'), true);
});

test('distribution targets do not admit platform publishing', () => {
  assert.equal(
    composerDistributionTargetSchema.safeParse('publish:xiaohongshu').success,
    false,
  );
});

test('viral adapt freezes one structured source only with the exact formal recipe', () => {
  const viral = {
    ...signedFields,
    intent: '请按本店项目仿写这篇由商家粘贴的笔记',
    recipe: {
      id: 'recipe.viral_adapt',
      revision: 'recipe.viral_adapt@2',
    },
    viralAdaptSource: {
      schemaVersion: 'viral-adapt-source/v1' as const,
      track: 'paste' as const,
      noteText: '姐妹们，夏日清爽护理三步走',
      authorizedAssetIds: ['asset-reference-1'],
    },
  };

  assert.deepEqual(pickComposerSubmissionSignedFields(viral), viral);
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...viral,
      viralAdaptSource: {
        ...viral.viralAdaptSource,
        track: 'opencli_link',
      },
    }).success,
    true,
  );
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse({
      ...viral,
      recipe: signedFields.recipe,
    }).success,
    false,
  );
  const { viralAdaptSource: _source, ...missingSource } = viral;
  assert.equal(
    composerSubmissionSignedFieldsSchema.safeParse(missingSource).success,
    false,
  );
});

test('image-text note page bound is signed only inside the deliverable', () => {
  const picked = pickComposerSubmissionSignedFields({
    ...signedFields,
    notePageBound: 2,
    deliverable: {
      kind: 'note',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    },
  });

  assert.equal(picked.deliverable.notePageBound, 3);
  assert.equal(Object.hasOwn(picked, 'notePageBound'), false);
});
