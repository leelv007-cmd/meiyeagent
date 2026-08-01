/**
 * Signed-field preview projection (T30 / #224 over T08 / M-01).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerSubmissionSignedFieldsSchema,
  type ComposerSubmissionSignedFields,
} from '@meiye/contracts';

import {
  composerSignedPreviewMatchesFrozen,
  projectComposerSignedPreview,
} from './composer-signed-preview';

function signed(
  overrides: Partial<ComposerSubmissionSignedFields> = {}
): ComposerSubmissionSignedFields {
  return composerSubmissionSignedFieldsSchema.parse({
    creationMode: 'customized',
    intent: '写一条周末预约文案',
    catalogModel: { id: 'deepseek-v4-pro', revision: 'catalog-7' },
    recipe: { id: 'recipe-weekend', revision: 'rev-3' },
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'export',
    deliverable: { kind: 'copy_document', quantity: 1 },
    ...overrides,
  });
}

test('the confirmed things read back in merchant language, without the model', () => {
  const preview = projectComposerSignedPreview({ signed: signed() });
  // No 「生成方式」 row: model routing is not merchant-facing (PRODUCT.md 反面参照).
  assert.deepEqual(preview.rows, [
    { key: 'destination', label: '发到哪', value: '小红书' },
    { key: 'deliverable', label: '交付物', value: '文案' },
  ]);
  assert.equal(preview.capability, '生成后导出');
});

test('quantity, ratio and duration only show when they carry information', () => {
  assert.equal(
    projectComposerSignedPreview({
      signed: signed({
        deliverable: {
          kind: 'video_package',
          quantity: 3,
          aspectRatio: '9:16',
          durationSeconds: 15,
        },
      }),
    }).rows[1]?.value,
    '视频成片 · 3 份 · 9:16 · 15 秒'
  );
  assert.equal(
    projectComposerSignedPreview({
      signed: signed({ deliverable: { kind: 'note', quantity: 1 } }),
    }).rows[1]?.value,
    '图文笔记'
  );
});

test('朋友圈 is a delivery target, and its capability says so before submit', () => {
  const preview = projectComposerSignedPreview({
    signed: signed({
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'assisted_handoff',
    }),
  });
  assert.equal(preview.rows[0]?.value, '朋友圈');
  assert.equal(preview.capability, '生成后协办交接');
});

test('no internal identifier or model name reaches the merchant surface', () => {
  const preview = projectComposerSignedPreview({ signed: signed() });
  assert.deepEqual(
    preview.rows.map((row) => row.key),
    ['destination', 'deliverable']
  );
  const rendered = [
    ...preview.rows.map((row) => `${row.label}${row.value}`),
    preview.capability,
  ].join('|');
  assert.doesNotMatch(rendered, /recipe-weekend|rev-3|catalog-7|deepseek/iu);
});

test('the frozen value must equal what was shown, field by field', () => {
  const shown = signed();
  assert.equal(composerSignedPreviewMatchesFrozen(shown, signed()), true);

  const overrides: Array<Partial<ComposerSubmissionSignedFields>> = [
    { creationMode: 'free' },
    { intent: '改成夏日护理预约文案' },
    {
      creationMode: 'free',
      imageOperation: 'image.generate',
      deliverable: { kind: 'image_set', quantity: 1 },
    },
    { contentPackagePlatform: 'douyin' },
    { distributionTarget: 'manual_copy' },
    { catalogModel: { id: 'deepseek-v4-flash', revision: 'catalog-7' } },
    { catalogModel: { id: 'deepseek-v4-pro', revision: 'catalog-8' } },
    { recipe: { id: 'recipe-weekend', revision: 'rev-4' } },
    { deliverable: { kind: 'note', quantity: 1 } },
    { deliverable: { kind: 'copy_document', quantity: 2 } },
    {
      deliverable: { kind: 'copy_document', quantity: 1, aspectRatio: '1:1' },
    },
    {
      deliverable: {
        kind: 'copy_document',
        quantity: 1,
        durationSeconds: 10,
      },
    },
  ];
  for (const override of overrides) {
    assert.equal(
      composerSignedPreviewMatchesFrozen(shown, signed(override)),
      false,
      `silent override slipped through: ${JSON.stringify(override)}`
    );
  }
});

test('generation parameter changes cannot silently diverge from the frozen free-mode contract', () => {
  const shown = signed({
    creationMode: 'free',
    beautyVoiceRole: 'beautician',
    thinkingLevel: 'standard',
  });
  assert.equal(
    composerSignedPreviewMatchesFrozen(
      shown,
      signed({
        creationMode: 'free',
        beautyVoiceRole: 'customer',
        thinkingLevel: 'standard',
      })
    ),
    false
  );
  assert.equal(
    composerSignedPreviewMatchesFrozen(
      shown,
      signed({
        creationMode: 'free',
        beautyVoiceRole: 'beautician',
        thinkingLevel: 'deep',
      })
    ),
    false
  );
});

test('every signed platform, target and deliverable has a merchant label', () => {
  for (const platform of composerSubmissionSignedFieldsSchema.shape
    .contentPackagePlatform.options) {
    const preview = projectComposerSignedPreview({
      signed: signed({ contentPackagePlatform: platform }),
    });
    assert.ok(preview.rows[0]?.value, `missing platform label: ${platform}`);
  }
  for (const target of composerSubmissionSignedFieldsSchema.shape
    .distributionTarget.options) {
    const preview = projectComposerSignedPreview({
      signed: signed({ distributionTarget: target }),
    });
    assert.ok(preview.capability, `missing capability label: ${target}`);
  }
  for (const kind of composerSubmissionSignedFieldsSchema.shape.deliverable
    .shape.kind.options) {
    const preview = projectComposerSignedPreview({
      signed: signed({ deliverable: { kind, quantity: 1 } }),
    });
    assert.ok(preview.rows[1]?.value, `missing deliverable label: ${kind}`);
  }
});
