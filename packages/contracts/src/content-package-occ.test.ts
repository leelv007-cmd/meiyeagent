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
