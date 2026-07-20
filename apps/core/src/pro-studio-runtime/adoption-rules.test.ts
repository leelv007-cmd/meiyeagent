import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdvancedCanvasAdoptionError,
  adoptionPayloadHash,
  createAdoptionAuditDetails,
  createAdoptionIdentity,
  createAdoptionResult,
  createAdoptionRevisionId,
  memoryAdoptionRuleProfile,
  postgresAdoptionRuleProfile,
  resolveAdoptionSelection,
  resolveIdempotencyReplay,
} from './adoption-rules.js';

const command = {
  projectId: 'project-1',
  revisionRef: { kind: 'frozen' as const, revisionId: 'revision-1' },
  selection: {
    textNodeId: 'text-1',
    orderedMediaNodeIds: ['image-1', 'image-2'],
  },
  target: { kind: 'new_package' as const },
  idempotencyKey: 'adoption-1',
};

const nodes = [
  { id: 'text-1', kind: 'text' as const, text: 'Adopted copy' },
  {
    id: 'image-1',
    kind: 'image' as const,
    assetId: 'asset-1',
    jobId: 'job-1',
    sourceAssetIds: ['source-1'],
    deliverable: true,
  },
  {
    id: 'image-2',
    kind: 'image' as const,
    assetId: 'asset-2',
    jobId: 'job-2',
    sourceAssetIds: ['source-2'],
    deliverable: true,
  },
];

test('memory and postgres implementations resolve the same adoption facts', () => {
  const memorySelection = resolveAdoptionSelection(
    nodes,
    command.selection,
    memoryAdoptionRuleProfile,
  );
  const postgresSelection = resolveAdoptionSelection(
    nodes,
    command.selection,
    postgresAdoptionRuleProfile,
  );

  assert.deepEqual(postgresSelection, memorySelection);
  assert.deepEqual(memorySelection, {
    kind: 'image_text',
    body: 'Adopted copy',
    orderedAssetIds: ['asset-1', 'asset-2'],
    orderedJobIds: ['job-1', 'job-2'],
    childJobIds: ['job-1', 'job-2'],
    sourceAssetIds: ['source-1', 'source-2'],
    selectedNodeIds: ['text-1', 'image-1', 'image-2'],
  });
});

test('adapter-facing selection error codes remain compatible', () => {
  for (const [profile, expectedCode] of [
    [memoryAdoptionRuleProfile, 'MEDIA_NODE_NOT_FOUND'],
    [postgresAdoptionRuleProfile, 'CONTENT_KIND_INVALID'],
  ] as const) {
    assert.throws(
      () =>
        resolveAdoptionSelection(
          nodes,
          { textNodeId: 'text-1', orderedMediaNodeIds: ['text-1'] },
          profile,
        ),
      (error: unknown) =>
        error instanceof AdvancedCanvasAdoptionError &&
        error.code === expectedCode,
    );
  }
});

test('business identity stays shared while version formats remain compatible', () => {
  const memoryIdentity = createAdoptionIdentity(
    command,
    'revision-1',
    memoryAdoptionRuleProfile,
  );
  const postgresIdentity = createAdoptionIdentity(
    command,
    'revision-1',
    postgresAdoptionRuleProfile,
  );

  assert.equal(postgresIdentity.businessKey, memoryIdentity.businessKey);
  assert.equal(postgresIdentity.packageId, memoryIdentity.packageId);
  assert.equal(
    memoryIdentity.versionId,
    'content-version-e88ad7f1eedf46a912dc8187',
  );
  assert.equal(
    postgresIdentity.versionId,
    'content-package-e88ad7f1eedf46a912dc8187-v-e88ad7f1eedf46a9',
  );
  assert.equal(
    createAdoptionRevisionId(
      { projectId: 'project-1', draftVersion: 7 },
      memoryAdoptionRuleProfile,
    ),
    'advanced-canvas-revision-b36e9641d75dffcfbb90a52c',
  );
  assert.equal(
    createAdoptionRevisionId(
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        draftVersion: 7,
        graph: { schemaVersion: 1, nodes: [], edges: [] },
      },
      postgresAdoptionRuleProfile,
    ),
    'revision-8538138b89626a489b886f9b',
  );
});

test('idempotency and audit details use one rule for both implementations', () => {
  const identity = createAdoptionIdentity(
    command,
    'revision-1',
    postgresAdoptionRuleProfile,
  );
  const result = createAdoptionResult(
    command,
    'revision-1',
    identity,
    ['text-1', 'image-1', 'image-2'],
  );
  const payloadHash = adoptionPayloadHash(command, postgresAdoptionRuleProfile);
  const receipts = [{ idempotencyKey: 'adoption-1', payloadHash, result }];

  assert.deepEqual(
    resolveIdempotencyReplay(receipts, 'adoption-1', payloadHash),
    result,
  );
  assert.deepEqual(
    createAdoptionAuditDetails({ correlationId: 'correlation-1' }, result),
    {
      correlationId: 'correlation-1',
      orderedMediaNodeIds: ['image-1', 'image-2'],
      packageId: identity.packageId,
      revisionId: 'revision-1',
      selectedNodeIds: ['text-1', 'image-1', 'image-2'],
      versionId: identity.versionId,
    },
  );
  assert.throws(
    () => resolveIdempotencyReplay(receipts, 'adoption-1', 'another-payload'),
    (error: unknown) =>
      error instanceof AdvancedCanvasAdoptionError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});
