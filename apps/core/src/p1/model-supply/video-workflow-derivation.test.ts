import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VideoWorkflowConcurrencyError,
  type DurableVideoWorkflow,
} from './video-workflow-contract.js';
import {
  applyCanonicalVideoEdit,
  normalizeCanonicalVideoRun,
  type CanonicalVideoRun,
} from './video-workflow-canonical.js';
import {
  assertPublicProjectionIsSanitized,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  projectVideoWorkflowPublic,
} from './video-workflow-projection.js';

function legacyWorkflow(
  overrides: Partial<DurableVideoWorkflow> = {},
): DurableVideoWorkflow {
  return {
    actorId: 'actor-a',
    aigcLabelEnabled: true,
    attempts: [],
    brandWatermarkText: 'Brand',
    catalogModelId: 'seedance-2',
    clipAssets: [],
    confirmed: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    dataClass: ['contains_face'],
    id: 'wf-legacy-1',
    referenceAssetIds: ['ref-1'],
    revision: 3,
    routeSnapshot: {
      id: 'route-private',
      catalogRevisionId: 'catalog-video-v1',
      requestedSelection: { mode: 'fixed' },
      candidateCatalogModelIds: ['seedance-2'],
      actualCatalogModelId: 'seedance-2',
      deploymentId: 'seedance-2-direct',
      policyRevision: 'policy-video-v1',
      priceRevision: 'price-video-v1',
      credentialMode: 'platform',
      credentialVersion: 'credential-private',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: ['contains_face'],
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        id: 'shot-a',
        prompt: 'legacy shot',
      },
    ],
    status: 'running',
    storyboardRevision: 'sb-legacy',
    storyboardVersion: 2,
    updatedAt: '2026-07-02T00:00:00.000Z',
    workId: 'work-a',
    workspaceId: 'ws-a',
    ...overrides,
  };
}

function reviewableRun(): CanonicalVideoRun {
  const firstAsset = {
    contentType: 'video/mp4' as const,
    id: 'asset-1',
    objectKey: 'video/asset-1.mp4',
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    technicalValidation: {
      codec: 'h264' as const,
      durationSeconds: 5,
      playable: true,
    },
  };
  const secondAsset = {
    ...firstAsset,
    id: 'asset-2',
    objectKey: 'video/asset-2.mp4',
    sha256: 'b'.repeat(64),
  };
  const candidate = (index: number, assetId: string) =>
    ({
      assetId,
      index,
      status: 'completed',
      technicalValidation: {
        codec: 'h264',
        durationSeconds: 5,
        playable: true,
      },
    }) as CanonicalVideoRun['job']['candidatesByShot'][string][number];

  return {
    actorId: 'actor-a',
    assets: {
      byId: {
        'asset-1': firstAsset,
        'asset-2': secondAsset,
      },
      clipAssetIds: [],
    },
    job: {
      attempts: [],
      candidatesByShot: {
        'shot-1': [candidate(0, 'asset-1')],
        'shot-2': [candidate(0, 'asset-2')],
      },
      confirmed: true,
      createdAt: '2026-07-20T08:00:00.000Z',
      revision: 3,
      status: 'awaiting_quality_review',
      updatedAt: '2026-07-20T08:00:00.000Z',
    },
    runId: 'wf-edit-1',
    task: {
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      dataClass: [],
      kind: 'video.composed',
      shots: [
        { candidatesPerShot: 1, id: 'shot-1', prompt: 'first' },
        { candidatesPerShot: 1, id: 'shot-2', prompt: 'second' },
      ],
      storyboardRevision: 'story-edit-v1',
      storyboardVersion: 1,
    },
    workId: 'work-a',
    workspaceId: 'ws-a',
  };
}

describe('canonical video workflow derivation', () => {
  it('round-trips legacy durable rows without authority drift', () => {
    const legacy = legacyWorkflow();
    const canonical = liftDurableToCanonical(legacy);
    const projected = projectDurableVideoWorkflow(canonical);

    assert.equal(canonical.runId, legacy.id);
    assert.equal(canonical.task.storyboardVersion, 2);
    assert.equal(canonical.job.revision, 3);
    assert.equal(canonical.task.derivedFromRunId, undefined);
    assert.deepEqual(projected, legacy);
  });

  it('keeps provider, credential, route, attempt, and asset facts out of public projection', () => {
    const canonical = liftDurableToCanonical(legacyWorkflow());
    const projection = projectVideoWorkflowPublic(canonical);

    assert.equal(projection.workflowId, 'wf-legacy-1');
    assert.equal(projection.workId, 'work-a');
    assert.equal(projection.revision, 3);
    assert.equal(projection.shots.length, 1);
    assertPublicProjectionIsSanitized(projection);
    assert.equal(JSON.stringify(projection).includes('credential-private'), false);
  });

  it('does not leak historical subtitleText onto the public projection (V31-37)', () => {
    const projection = projectVideoWorkflowPublic(
      legacyWorkflow({ subtitleText: '历史字幕只读' }),
    );
    assert.equal('subtitleText' in projection, false);
    assert.equal(JSON.stringify(projection).includes('历史字幕'), false);
  });

  it('normalizes reference ids, storyboard version, and revision at the canonical boundary', () => {
    const canonical = liftDurableToCanonical(
      legacyWorkflow({ referenceAssetIds: [' ref-1 ', 'ref-1', ''] }),
    );
    canonical.task.storyboardVersion = 0;
    canonical.job.revision = -1;

    const normalized = normalizeCanonicalVideoRun(canonical);
    assert.deepEqual(normalized.task.referenceAssetIds, ['ref-1']);
    assert.equal(normalized.task.storyboardVersion, 1);
    assert.equal(normalized.job.revision, 0);
  });

  it('applies selection and shot ordering with OCC and immutable terminal rules', () => {
    const base = reviewableRun();
    const selected = applyCanonicalVideoEdit(
      base,
      {
        actorId: 'actor-a',
        correlationId: 'corr-select',
        edit: { candidateIndex: 0, kind: 'select_candidate', shotId: 'shot-1' },
        expectedRevision: 3,
        workflowId: base.runId,
        workspaceId: base.workspaceId,
      },
      '2026-07-20T08:00:01.000Z',
    );
    assert.equal(selected.job.revision, 4);
    assert.equal(selected.task.shots[0]?.selectedCandidateIndex, 0);
    assert.deepEqual(selected.assets.clipAssetIds, ['asset-1']);
    assert.deepEqual(selected.task.shots[0]?.selectionAudit, {
      correlationId: 'corr-select',
      selectedAt: '2026-07-20T08:00:01.000Z',
      selectedBy: 'actor-a',
      source: 'human_quality_review',
    });

    const selectedBoth = structuredClone(selected);
    selectedBoth.task.shots[1]!.selectedCandidateIndex = 0;
    selectedBoth.assets.clipAssetIds = ['asset-1', 'asset-2'];
    const reordered = applyCanonicalVideoEdit(
      selectedBoth,
      {
        actorId: 'actor-a',
        correlationId: 'corr-order',
        edit: { kind: 'reorder_shots', shotIds: ['shot-2', 'shot-1'] },
        expectedRevision: 4,
        workflowId: base.runId,
        workspaceId: base.workspaceId,
      },
      '2026-07-20T08:00:02.000Z',
    );
    assert.deepEqual(
      reordered.task.shots.map((shot) => shot.id),
      ['shot-2', 'shot-1'],
    );
    assert.deepEqual(reordered.assets.clipAssetIds, ['asset-2', 'asset-1']);

    assert.throws(
      () =>
        applyCanonicalVideoEdit(
          reordered,
          {
            actorId: 'actor-a',
            correlationId: 'corr-stale',
            edit: {
              candidateIndex: 0,
              kind: 'select_candidate',
              shotId: 'shot-1',
            },
            expectedRevision: 3,
            workflowId: base.runId,
            workspaceId: base.workspaceId,
          },
          '2026-07-20T08:00:03.000Z',
        ),
      (error: unknown) => error instanceof VideoWorkflowConcurrencyError,
    );

    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      const terminal = structuredClone(base);
      terminal.job.status = status;
      assert.throws(
        () =>
          applyCanonicalVideoEdit(
            terminal,
            {
              actorId: 'actor-a',
              correlationId: `corr-${status}`,
              edit: {
                candidateIndex: 0,
                kind: 'select_candidate',
                shotId: 'shot-1',
              },
              expectedRevision: terminal.job.revision,
              workflowId: terminal.runId,
              workspaceId: terminal.workspaceId,
            },
            '2026-07-20T08:00:04.000Z',
          ),
        /terminal workflows are read only/,
      );
    }
  });
});
