import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetRevisionSchema,
  contentPackageSchema,
  reusableAssetCandidateSchema,
} from '@meiye/contracts';

import { buildContentPackage } from './content-package.js';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import { compileContextBundle } from './context-compiler.js';
import { ReuseMemoryError } from './reuse-memory-service.js';
import { OperationsReusableAssetSourceVerifier } from './reuse-memory-source-verifier.js';

const timestamp = '2026-07-18T03:00:00.000Z';

test('production reusable source verification binds package, version, bundle and live rights', async () => {
  const bundles = new MemoryContextBundleRepository();
  await bundles.freeze({
    workspaceId: 'workspace-a',
    bundleId: 'bundle-a',
    compiled: compileContextBundle({
      workspaceId: 'workspace-a',
      taskId: 'task-source',
      sourceRevisions: {
        facts: 0,
        assets: 0,
        identity: 0,
        rights: 0,
        preferences: 0,
        recipe: 0,
        platformRules: 0,
        currentSignal: 0,
      },
      contributions: [],
    }),
    expectedRevision: 0,
    frozenAt: timestamp,
    frozenBy: 'owner-a',
    idempotencyKey: 'freeze-source',
    reason: 'source fixture',
  });
  let packageRevision = 3;
  let rightsAllowed = true;
  const sourcePackage = () =>
    contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-a',
        workspaceId: 'workspace-a',
        kind: 'image_text',
        source: { assetIds: ['asset-a'] },
        timestamp,
      }),
      revision: packageRevision,
      status: 'accepted',
      currentVersionId: 'version-a',
      versions: [
        {
          id: 'version-a',
          title: '旧标题',
          body: '旧正文 旧价格 199',
          orderedAssetIds: ['asset-a'],
          topics: ['旧话题'],
          createdAt: timestamp,
          createdBy: 'owner-a',
          source: 'merchant_edited',
        },
      ],
    });
  const verifier = new OperationsReusableAssetSourceVerifier(
    {
      async getContentPackage() {
        return sourcePackage();
      },
    },
    {
      async resolve({ assetIds }) {
        return {
          knownAssetIds: rightsAllowed ? assetIds : [],
          unauthorizedAssetIds: rightsAllowed ? [] : assetIds,
        };
      },
    },
    bundles,
  );
  const candidate = reusableAssetCandidateSchema.parse({
    candidateId: 'candidate-a',
    assetId: 'series-a',
    workspaceId: 'workspace-a',
    kind: 'series',
    name: '三段式系列',
    fixedItems: [
      {
        key: 'structure.three-part',
        value: ['experience', 'evidence', 'cta'],
        sourceRef: 'package-a:version-a',
      },
    ],
    variableSlots: [
      { key: 'offer.price', source: 'current_fact', required: true },
    ],
    defaultScope: { storeId: 'store-a' },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 3,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 1,
    },
    rights: { assetIds: ['asset-a'], status: 'authorized' },
    status: 'pending',
    createdAt: timestamp,
    createdBy: 'owner-a',
  });
  await verifier.verifyCandidate(candidate);

  packageRevision = 4;
  const { status: _status, ...candidateBody } = candidate;
  const revision = assetRevisionSchema.parse({
    ...candidateBody,
    revisionId: 'series-a:1',
    revision: 1,
    finalScope: candidate.defaultScope,
    scopeDecision: {
      mode: 'accepted_default',
      decisionId: 'decision-a',
      decidedBy: 'owner-a',
      decidedAt: timestamp,
    },
    nextSuggestions: [],
  });
  await verifier.verifyRevision(revision);
  rightsAllowed = false;
  await assert.rejects(
    verifier.verifyRevision(revision),
    (error: unknown) =>
      error instanceof ReuseMemoryError && error.code === 'INVALID_STATE',
  );
});
