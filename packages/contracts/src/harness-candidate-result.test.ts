import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adoptHarnessCandidateCommandSchema,
  CONTENT_PACKAGE_COMMAND_SCHEMAS,
  contentPackageVersionSchema,
} from './content-package.js';

test('Harness candidates persist their identity and score on package versions', () => {
  const version = contentPackageVersionSchema.parse({
    body: '正文',
    conversionHook: '私信预约',
    createdAt: '2026-07-19T00:00:00.000Z',
    harnessCandidateId: 'c02',
    harnessScore: 92,
    id: 'version-c02',
    orderedAssetIds: [],
    source: 'ai_generated',
    title: '候选 B',
    topics: [],
  });

  assert.equal(version.harnessCandidateId, 'c02');
  assert.equal(version.harnessScore, 92);
});

test('candidate adoption is a typed optimistic-concurrency command', () => {
  assert.equal(
    CONTENT_PACKAGE_COMMAND_SCHEMAS.adopt_harness_candidate,
    adoptHarnessCandidateCommandSchema,
  );
  assert.deepEqual(
    adoptHarnessCandidateCommandSchema.parse({
      candidateId: 'c03',
      expectedRevision: 4,
      packageId: 'package-1',
    }),
    {
      candidateId: 'c03',
      expectedRevision: 4,
      packageId: 'package-1',
    },
  );
});
