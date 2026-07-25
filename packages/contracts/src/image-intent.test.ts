import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMAGE_INTENT_OPERATIONS,
  IMAGE_INTENT_SLOT_KINDS,
  freeImageIntentSchema,
  imageIntentSchema,
  imageIntentSchemaForProfile,
  imageModelRecipeProfileSchema,
  imageOutputPlanSchema,
} from './image-intent.js';

const references = IMAGE_INTENT_SLOT_KINDS.map((slot, index) => ({
  assetId: `asset-${index + 1}`,
  assetRevision: `asset-${index + 1}-r1`,
  slot,
  mimeType: 'image/png',
  sizeBytes: 1_024,
  factRefs: slot === 'work_case' ? ['fact:work-case:1'] : [],
  rightsRefs: slot === 'subject_person' ? ['rights:person:1'] : [],
}));

const intent = {
  operation: 'image.generate' as const,
  purpose: '门店夏日护理活动海报',
  subject: '夏日护理项目',
  scene: '明亮干净的门店护理区',
  composition: '竖版主视觉，活动信息居中',
  references,
  exactText: [
    { text: '夏日护理 398 元', treatment: 'exact' as const },
    { text: '清爽一夏', treatment: 'creative' as const },
  ],
  changes: [],
  invariants: [],
  factRefs: ['fact:price:398'],
  rightsRefs: ['rights:person:1'],
  outputPlan: { kind: 'single' as const },
};

const profile = {
  id: 'seedream-quality',
  revision: 'seedream-quality-r1',
  operationMappings: {
    'image.generate': 'image.generate',
    'image.edit': 'image.edit',
    'image.reference_transform': 'image.edit',
  },
  slotRules: IMAGE_INTENT_SLOT_KINDS.map((slot) => ({
    slot,
    minItems: 0,
    maxItems: 1,
    allowedMimeTypes: ['image/png'],
    maxBytesPerItem: 2_048,
    incompatibleWith: [],
    nativeField: `references.${slot}`,
  })),
};

test('ImageIntent exposes exactly three canonical operations', () => {
  assert.deepEqual(IMAGE_INTENT_OPERATIONS, [
    'image.generate',
    'image.edit',
    'image.reference_transform',
  ]);
  for (const operation of IMAGE_INTENT_OPERATIONS) {
    assert.equal(
      imageIntentSchema.safeParse({ ...intent, operation }).success,
      operation !== 'image.edit',
    );
  }
  assert.equal(
    imageIntentSchema.safeParse({
      ...intent,
      operation: 'image.batch',
    }).success,
    false,
  );
});

test('all seven slots obey profile count, MIME, size, and combination rules', () => {
  const parsedProfile = imageModelRecipeProfileSchema.parse(profile);
  assert.deepEqual(
    parsedProfile.slotRules.map(({ slot }) => slot),
    IMAGE_INTENT_SLOT_KINDS,
  );

  for (const [index, slot] of IMAGE_INTENT_SLOT_KINDS.entries()) {
    const schema = imageIntentSchemaForProfile({
      ...profile,
      slotRules: profile.slotRules.map((rule) =>
        rule.slot === slot
          ? {
              ...rule,
              maxItems: 1,
              incompatibleWith: ['brand_element' as const].filter(
                (other) => other !== slot,
              ),
            }
          : rule,
      ),
    });
    const reference = references[index]!;
    assert.equal(
      schema.safeParse({
        ...intent,
        references: [reference],
      }).success,
      true,
      `${slot} accepts its declared format and count`,
    );
    assert.equal(
      schema.safeParse({
        ...intent,
        references: [reference, { ...reference, assetId: `${slot}-2` }],
      }).success,
      false,
      `${slot} rejects excess references`,
    );
    assert.equal(
      schema.safeParse({
        ...intent,
        references: [{ ...reference, mimeType: 'image/jpeg' }],
      }).success,
      false,
      `${slot} rejects an undeclared format`,
    );
    assert.equal(
      schema.safeParse({
        ...intent,
        references: [{ ...reference, sizeBytes: 2_049 }],
      }).success,
      false,
      `${slot} rejects an oversized reference`,
    );
    if (slot !== 'brand_element') {
      assert.equal(
        schema.safeParse({
          ...intent,
          references: [reference, references[4]],
        }).success,
        false,
        `${slot} rejects a declared incompatible combination`,
      );
    }
  }
});

test('person and work-case slots require their rights and truth bindings', () => {
  assert.equal(
    imageIntentSchema.safeParse({
      ...intent,
      references: references.map((reference) =>
        reference.slot === 'subject_person'
          ? { ...reference, rightsRefs: [] }
          : reference,
      ),
    }).success,
    false,
  );
  assert.equal(
    imageIntentSchema.safeParse({
      ...intent,
      references: references.map((reference) =>
        reference.slot === 'work_case'
          ? { ...reference, factRefs: [] }
          : reference,
      ),
    }).success,
    false,
  );
});

test('work-case editing rejects a change to a protected nail surface', () => {
  const result = imageIntentSchema.safeParse({
    ...intent,
    operation: 'image.edit',
    references: references.filter(({ slot }) => slot === 'work_case'),
    changes: [
      {
        target: 'work_case_surface',
        instruction: '把甲面颜色和款式改成另一套',
      },
    ],
    invariants: [
      {
        target: 'work_case_surface',
        requirement: '保持真实案例中的甲面颜色和款式不变',
      },
    ],
  });

  assert.equal(result.success, false);
});

test('OutputPlan supports single and set while free creation v1 rejects set', () => {
  assert.equal(imageOutputPlanSchema.safeParse({ kind: 'single' }).success, true);
  const setPlan = {
    kind: 'set' as const,
    count: 2,
    pages: [
      { order: 1, role: '活动封面' },
      { order: 2, role: '预约引导' },
    ],
    consistencyRequirements: ['品牌色和人物身份保持一致'],
  };
  assert.equal(imageOutputPlanSchema.safeParse(setPlan).success, true);
  assert.equal(
    imageOutputPlanSchema.safeParse({
      ...setPlan,
      pages: [{ order: 1, role: '活动封面' }],
    }).success,
    false,
  );
  assert.equal(
    freeImageIntentSchema.safeParse({
      ...intent,
      outputPlan: setPlan,
    }).success,
    false,
  );
});
