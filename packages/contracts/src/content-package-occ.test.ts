import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageSchema,
  contentPackageVersionSchema,
  editContentPackageVersionCommandSchema,
  generateContentPackageVariantsCommandSchema,
  rollbackContentPackageVersionCommandSchema,
} from './content-package.js';

const basePackage = {
  compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
  createdAt: '2026-07-18T08:00:00.000Z',
  exportReceipts: [],
  generated: { assetIds: [], childRuns: [] },
  id: 'package-1',
  kind: 'image_text',
  lineage: {},
  rights: { state: 'authorized' },
  source: { assetIds: [] },
  status: 'draft',
  updatedAt: '2026-07-18T08:00:00.000Z',
  variants: [],
  versions: [],
  workspaceId: 'workspace-1',
};

const noteVersion = {
  schema: 'image-text-note-version/v1',
  plan: {
    schema: 'note-plan/v1',
    themeAnchor: '夏日补水护理',
    style: {
      id: 'practical-guide',
      name: '干货科普版',
      positioning: '清楚可信',
    },
    pages: [
      {
        id: 'page-1',
        order: 1,
        revision: 1,
        pageRole: 'cover',
        pagePurpose: 'capture_attention',
        textBlock: {
          title: '补水先看肤况',
          body: '先判断当下肤况。',
          exactText: [],
        },
        imageIntent: {
          operation: 'image.generate',
          purpose: '封面配图',
          subject: '门店护理项目',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        dependencies: [],
        imageAssetId: 'asset-1',
      },
      {
        id: 'page-2',
        order: 2,
        revision: 1,
        pageRole: 'cta_guide',
        pagePurpose: 'drive_action',
        textBlock: {
          title: '预约前先沟通',
          body: '私信说明你的肤况。',
          exactText: [],
        },
        imageIntent: {
          operation: 'image.generate',
          purpose: '行动页配图',
          subject: '门店护理项目',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        dependencies: [{ pageId: 'page-1', kind: 'text_sequence' }],
        imageAssetId: 'asset-2',
      },
    ],
  },
  regenerationReceipts: [],
} as const;

test('ContentPackage aggregate owns revision while immutable versions do not', () => {
  assert.equal(contentPackageSchema.parse(basePackage).revision, 0);
  assert.equal(contentPackageSchema.parse({ ...basePackage, revision: 4 }).revision, 4);
  assert.equal(contentPackageSchema.safeParse({ ...basePackage, revision: -1 }).success, false);
  assert.equal('revision' in contentPackageVersionSchema.shape, false);
});

test('retained version mutation commands require a non-negative expectedRevision', () => {
  const commands = [
    [
      editContentPackageVersionCommandSchema,
      {
        baseVersionId: 'version-1',
        changes: {
          body: 'body',
          orderedAssetIds: [],
          title: 'title',
          topics: [],
        },
        packageId: 'package-1',
      },
    ],
    [
      rollbackContentPackageVersionCommandSchema,
      { packageId: 'package-1', targetVersionId: 'version-1' },
    ],
    [
      generateContentPackageVariantsCommandSchema,
      {
        contract: {
          aigcLabelEnabled: true,
          catalogModelId: 'llm-openai',
          catalogRevision: 'catalog-v1',
          currency: 'CNY',
          dataClass: [],
          estimatedAmount: 0.02,
          operation: 'copy.adapt',
          outputCount: 3,
          outputLabel: 'three platform variants',
          quoteAcceptedAt: '2026-07-18T08:00:00.000Z',
          quoteRevision: 'quote-copy-adapt-v1',
          watermarkEnabled: false,
        },
        packageId: 'package-1',
        submissionKey: 'variant-submit-1',
      },
    ],
  ] as const;

  for (const [schema, command] of commands) {
    assert.equal(schema.safeParse(command).success, false);
    assert.equal(schema.safeParse({ ...command, expectedRevision: 3 }).success, true);
    assert.equal(schema.safeParse({ ...command, expectedRevision: -1 }).success, false);
  }
});

test('ContentPackage hand edit validates and retains a canonical note version', () => {
  const command = {
    baseVersionId: 'version-1',
    changes: {
      body: 'body',
      note: noteVersion,
      orderedAssetIds: ['asset-1', 'asset-2'],
      title: 'title',
      topics: [],
    },
    expectedRevision: 3,
    packageId: 'package-1',
  };

  const parsed = editContentPackageVersionCommandSchema.parse(command);
  assert.deepEqual(parsed.changes.note, noteVersion);
  assert.equal(
    editContentPackageVersionCommandSchema.safeParse({
      ...command,
      changes: {
        ...command.changes,
        note: { ...noteVersion, schema: 'unknown-note-version' },
      },
    }).success,
    false,
  );
});
