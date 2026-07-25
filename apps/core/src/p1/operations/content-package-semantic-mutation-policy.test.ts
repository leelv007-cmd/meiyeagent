import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContentPackage } from './content-package.js';
import {
  ContentPackageSemanticMutationError,
  validateContentPackageSemanticWrite,
} from './content-package-semantic-mutation-policy.js';

const timestamp = '2026-07-25T00:00:00.000Z';

test('accepted Harness state requires canonical adoptedCandidateId evidence', () => {
  const draft = buildContentPackage({
    id: 'package-1',
    kind: 'image_text',
    source: { assetIds: [], workflowId: 'workflow-1' },
    timestamp,
    workspaceId: 'workspace-1',
  });

  assert.throws(
    () =>
      validateContentPackageSemanticWrite({
        expectedRevision: 0,
        next: {
          ...draft,
          currentVersionId: 'version-1',
          harnessSelection: { recommendedCandidateId: 'candidate-1' },
          revision: 1,
          status: 'accepted',
          versions: [
            {
              body: 'body',
              createdAt: timestamp,
              harnessCandidateId: 'candidate-1',
              id: 'version-1',
              orderedAssetIds: [],
              title: 'title',
              topics: [],
            },
          ],
        },
      }),
    (error: unknown) =>
      error instanceof ContentPackageSemanticMutationError &&
      error.code === 'HARNESS_ADOPTION_EVIDENCE_REQUIRED',
  );
});

test('semantic writes enforce one OCC revision step', () => {
  const draft = buildContentPackage({
    id: 'package-1',
    kind: 'image_text',
    source: { assetIds: [] },
    timestamp,
    workspaceId: 'workspace-1',
  });
  assert.throws(
    () =>
      validateContentPackageSemanticWrite({
        expectedRevision: 0,
        next: { ...draft, revision: 2 },
      }),
    (error: unknown) =>
      error instanceof ContentPackageSemanticMutationError &&
      error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT' &&
      error.status === 409,
  );
});
