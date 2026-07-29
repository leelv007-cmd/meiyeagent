/**
 * #102 VideoWorkflow derivation — equivalence, idempotent recover, read-only projection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDefaultCatalogModels, createDefaultDeployments } from './catalog.js';
import {
  ContentWorkflowRunner,
  InMemoryCanonicalVideoRunStore,
  InMemoryDurableVideoWorkflowStore,
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  RecordedVideoCompositionPort,
  VideoWorkflowCanonicalCommands,
  VideoWorkflowProjectionReadFacade,
  VideoWorkflowProjectionReadonlyError,
  assertPublicProjectionIsSanitized,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  projectVideoWorkflowPublic,
  type DurableVideoWorkflow,
  type VideoExecutionContract,
  type VideoQualityScoringPort,
} from './index.js';

function frozenVideoContract(
  overrides: Partial<VideoExecutionContract> = {}
): VideoExecutionContract {
  return {
    aigcLabelEnabled: false,
    aspectRatio: '9:16',
    catalogModelId: 'seedance-2',
    catalogRevision: 'catalog-video-v1',
    currency: 'CNY',
    dataClass: [],
    durationSeconds: 4,
    estimatedAmount: 12,
    operation: 'video.generate',
    outputCount: 1,
    outputLabel: '4 second composed video',
    quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
    quoteRevision: 'quote-video-v1',
    watermarkEnabled: false,
    ...overrides,
  };
}

class PassThroughScorer implements VideoQualityScoringPort {
  async score(input: Parameters<VideoQualityScoringPort['score']>[0]) {
    return {
      score: 0.95,
      dimensions: {
        humanAnatomy: 0.95,
        sourceConsistency: 0.94,
        crossShotContinuity: 0.93,
        subtitleOcclusion: 0.92,
        publishRisk: 0.91,
      },
      publishWarnings: [],
      scorerRevision: 'derivation-test-v1',
      calibration: 'recorded_human_fixture' as const,
      calibrationEvidence: {
        datasetRevision: 'derivation-test-set-v1',
        sampleId: `candidate-${input.candidateIndex}`,
        raterCount: 2,
        annotatedAt: '2026-07-01T00:00:00.000Z',
        assetFingerprint: input.asset.sha256.slice(0, 16),
        priorAssetFingerprints: [],
        peerCandidateFingerprints: [],
      },
    };
  }
}

function setupRunner(store = new InMemoryDurableVideoWorkflowStore()) {
  const execution = new RecordedProviderExecutionPort();
  let executions = 0;
  const models = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['seedance-2-direct'],
    }),
    execution: {
      async execute(request) {
        executions += 1;
        return execution.execute(request);
      },
    },
    assetStorage: new MemoryModelAssetStorage(),
  });
  const runner = new ContentWorkflowRunner(
    models,
    new RecordedVideoCompositionPort(),
    store,
    new PassThroughScorer()
  );
  return {
    runner,
    store,
    executions: () => executions,
    draftInput: {
      workflowId: 'wf-derive-1',
      workspaceId: 'ws-a',
      actorId: 'actor-a',
      workId: 'work-a',
      dataClass: [],
      storyboardRevision: 'storyboard-derive-v1',
      catalogModelId: 'seedance-2',
      executionContract: frozenVideoContract(),
      shots: [
        {
          id: 'shot-1',
          prompt: '门店入口',
          candidatesPerShot: 1,
          durationSeconds: 2,
          width: 720,
          height: 1280,
        },
        {
          id: 'shot-2',
          prompt: '护理细节',
          candidatesPerShot: 1,
          durationSeconds: 2,
          width: 720,
          height: 1280,
        },
      ],
    },
  };
}

function publicShape(workflow: DurableVideoWorkflow) {
  return projectVideoWorkflowPublic(workflow);
}

describe('VideoWorkflow derivation (#102)', () => {
  it('create/confirm/run/cancel chain is equivalent via adapter and projects publicly', async () => {
    const { runner, store, draftInput } = setupRunner();

    const draft = runner.createVideoWorkflow(draftInput);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.confirmed, false);
    assert.equal(draft.revision, 0);

    // Canonical store is the sole authority under the adapter.
    const canonical = store.canonicalStore.get(draft.id);
    assert.ok(canonical);
    assert.equal(canonical.task.kind, 'video.composed');
    assert.equal(canonical.job.status, 'draft');
    assert.deepEqual(
      projectDurableVideoWorkflow(canonical).shots.map((s) => s.id),
      ['shot-1', 'shot-2']
    );

    const confirmed = runner.confirmVideoWorkflow(draft.id, draft.workspaceId);
    assert.equal(confirmed.confirmed, true);
    assert.ok(confirmed.routeSnapshot);

    const completed = await runner.runVideoWorkflow(
      confirmed.id,
      confirmed.workspaceId
    );
    assert.equal(completed.status, 'completed');
    assert.ok(completed.composedAsset);
    assert.equal(completed.clipAssets.length, 2);

    const publicProjection = publicShape(completed);
    assert.equal(publicProjection.workflowId, completed.id);
    assert.equal(publicProjection.status, 'completed');
    assert.equal(publicProjection.confirmed, true);
    assert.equal(publicProjection.shots.length, 2);
    assertPublicProjectionIsSanitized(publicProjection);

    // Cancel is terminal-blocked after completion.
    assert.throws(
      () =>
        runner.requestVideoWorkflowCancel(completed.id, completed.workspaceId),
      /terminal video workflow cannot be cancelled/
    );
  });

  it('cancel mid-lifecycle is idempotent on request and projects cancel_requested', async () => {
    const { runner, draftInput } = setupRunner();
    const draft = runner.createVideoWorkflow({
      ...draftInput,
      workflowId: 'wf-cancel-1',
    });
    runner.confirmVideoWorkflow(draft.id, draft.workspaceId);

    const first = runner.requestVideoWorkflowCancel(
      draft.id,
      draft.workspaceId
    );
    const second = runner.requestVideoWorkflowCancel(
      draft.id,
      draft.workspaceId
    );
    assert.equal(first.status, 'cancel_requested');
    assert.equal(second.status, 'cancel_requested');
    assert.equal(first.revision, second.revision);
    assert.equal(publicShape(first).status, 'cancel_requested');
  });

  it('double recover is idempotent — no double provider charge on completed run', async () => {
    const { runner, executions, draftInput } = setupRunner();
    const draft = runner.createVideoWorkflow({
      ...draftInput,
      workflowId: 'wf-recover-1',
    });
    runner.confirmVideoWorkflow(draft.id, draft.workspaceId);

    const first = await runner.runVideoWorkflow(draft.id, draft.workspaceId);
    assert.equal(first.status, 'completed');
    const charged = executions();
    assert.ok(charged >= 1);

    const second = await runner.runVideoWorkflow(draft.id, draft.workspaceId);
    assert.equal(second.status, 'completed');
    assert.equal(second.revision, first.revision);
    assert.equal(second.composedAsset?.id, first.composedAsset?.id);
    // Terminal short-circuit: no additional provider execute.
    assert.equal(executions(), charged);

    const third = await runner.runVideoWorkflow(draft.id, draft.workspaceId);
    assert.equal(third.composedAsset?.sha256, first.composedAsset?.sha256);
    assert.equal(executions(), charged);
  });

  it('projection-only facade rejects all write paths', () => {
    const canonical = new InMemoryCanonicalVideoRunStore();
    const commands = new VideoWorkflowCanonicalCommands(canonical);
    const facade = new VideoWorkflowProjectionReadFacade(canonical);

    const seeded = commands.checkpoint({
      id: 'wf-ro-1',
      workspaceId: 'ws-a',
      actorId: 'actor-a',
      storyboardVersion: 1,
      dataClass: [],
      aigcLabelEnabled: false,
      storyboardRevision: 'sb-1',
      confirmed: false,
      catalogModelId: 'seedance-2',
      shots: [
        {
          id: 'shot-1',
          prompt: 'x',
          candidatesPerShot: 1,
          candidates: [],
        },
      ],
      attempts: [],
      clipAssets: [],
      status: 'draft',
      revision: 0,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    assert.equal(facade.get('wf-ro-1')?.id, 'wf-ro-1');
    assert.equal(facade.list('ws-a', 'actor-a').length, 1);
    assert.equal(facade.findLatest('ws-a', 'actor-a')?.id, 'wf-ro-1');

    assert.throws(
      () => facade.save(seeded),
      (error: unknown) =>
        error instanceof VideoWorkflowProjectionReadonlyError &&
        error.code === 'VIDEO_WORKFLOW_PROJECTION_READONLY'
    );
    assert.throws(
      () => facade.claimRun('wf-ro-1', 'ws-a', 'lease'),
      (error: unknown) => error instanceof VideoWorkflowProjectionReadonlyError
    );
    assert.throws(
      () =>
        facade.requestCancel(
          'wf-ro-1',
          'ws-a',
          '2026-07-18T00:00:01.000Z'
        ),
      (error: unknown) => error instanceof VideoWorkflowProjectionReadonlyError
    );
    assert.throws(
      () => facade.assertRunnable('wf-ro-1', 'ws-a', 0, 'lease'),
      (error: unknown) => error instanceof VideoWorkflowProjectionReadonlyError
    );
  });

  it('legacy durable row round-trips through lift → project without authority drift', () => {
    const legacy: DurableVideoWorkflow = {
      id: 'wf-legacy-1',
      workspaceId: 'ws-a',
      actorId: 'actor-a',
      workId: 'work-a',
      storyboardVersion: 2,
      dataClass: ['contains_face'],
      aigcLabelEnabled: true,
      brandWatermarkText: 'Brand',
      storyboardRevision: 'sb-legacy',
      confirmed: true,
      catalogModelId: 'seedance-2',
      referenceAssetIds: ['ref-1'],
      shots: [
        {
          id: 'shot-a',
          prompt: 'legacy shot',
          candidatesPerShot: 1,
          candidates: [],
        },
      ],
      attempts: [],
      clipAssets: [],
      status: 'running',
      revision: 3,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    };

    const store = new InMemoryDurableVideoWorkflowStore();
    const restored = store.restore(legacy);
    assert.equal(restored.id, legacy.id);
    assert.equal(restored.revision, 3);
    assert.equal(restored.status, 'running');

    const canonical = liftDurableToCanonical(legacy);
    assert.equal(canonical.runId, legacy.id);
    assert.equal(canonical.task.storyboardVersion, 2);
    assert.equal(canonical.job.revision, 3);
    assert.equal(canonical.task.derivedFromRunId, undefined);

    const projected = projectDurableVideoWorkflow(canonical);
    assert.equal(projected.id, legacy.id);
    assert.equal(projected.storyboardRevision, legacy.storyboardRevision);
    assert.equal(projected.brandWatermarkText, 'Brand');
    assert.deepEqual(projected.dataClass, ['contains_face']);

    const pub = projectVideoWorkflowPublic(canonical);
    assert.equal(pub.workflowId, 'wf-legacy-1');
    assert.equal(pub.workId, 'work-a');
    assert.equal(pub.revision, 3);
    assertPublicProjectionIsSanitized(pub);
  });

  it('public projection serialization never includes provider or credential fields', async () => {
    const { runner, draftInput } = setupRunner();
    const draft = runner.createVideoWorkflow({
      ...draftInput,
      workflowId: 'wf-sanitize-1',
    });
    const confirmed = runner.confirmVideoWorkflow(draft.id, draft.workspaceId);
    const completed = await runner.runVideoWorkflow(
      confirmed.id,
      confirmed.workspaceId
    );

    // Durable projection still carries attempts for audit — public must not.
    assert.ok(completed.attempts.length > 0);
    assert.ok(completed.routeSnapshot);

    const pub = projectVideoWorkflowPublic(completed);
    const json = JSON.stringify(pub);
    assert.equal(json.includes('provider'), false);
    assert.equal(json.includes('credential'), false);
    assert.equal(json.includes('routeSnapshot'), false);
    assert.equal(json.includes('attempts'), false);
    assert.equal(json.includes('composedAsset'), false);
    assertPublicProjectionIsSanitized(pub);
  });

  it('adapter save is not an independent authority — same canonical map as commands', () => {
    const canonical = new InMemoryCanonicalVideoRunStore();
    const adapter = new InMemoryDurableVideoWorkflowStore(canonical);
    const commands = new VideoWorkflowCanonicalCommands(canonical);

    adapter.save({
      id: 'wf-shared-1',
      workspaceId: 'ws-a',
      actorId: 'actor-a',
      storyboardVersion: 1,
      dataClass: [],
      aigcLabelEnabled: false,
      storyboardRevision: 'sb-shared',
      confirmed: false,
      catalogModelId: 'seedance-2',
      shots: [
        {
          id: 'shot-1',
          prompt: 'shared',
          candidatesPerShot: 1,
          candidates: [],
        },
      ],
      attempts: [],
      clipAssets: [],
      status: 'draft',
      revision: 0,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    });

    assert.equal(commands.get('wf-shared-1')?.id, 'wf-shared-1');
    assert.equal(
      adapter.canonicalStore.get('wf-shared-1')?.runId,
      'wf-shared-1'
    );

    const viaCommand = commands.checkpoint({
      ...commands.get('wf-shared-1')!,
      confirmed: true,
      updatedAt: '2026-07-18T00:00:01.000Z',
    });
    assert.equal(viaCommand.confirmed, true);
    assert.equal(adapter.get('wf-shared-1')?.confirmed, true);
    assert.equal(adapter.get('wf-shared-1')?.revision, viaCommand.revision);
  });

  it('selects and orders a reviewable workflow but rejects terminal writes', async () => {
    const { runner, draftInput } = setupRunner();
    const draft = runner.createVideoWorkflow({
      ...draftInput,
      workflowId: 'wf-edit-1',
    });
    runner.confirmVideoWorkflow(draft.id, draft.workspaceId);
    const completed = await runner.runVideoWorkflow(draft.id, draft.workspaceId);
    const store = new InMemoryCanonicalVideoRunStore();
    const reviewable = liftDurableToCanonical(completed);
    reviewable.job.status = 'awaiting_quality_review';
    store.restore(reviewable);
    const commands = new VideoWorkflowCanonicalCommands(store);
    const base = completed.revision;

    assert.throws(
      () =>
        commands.edit(
          {
            actorId: 'actor-a',
            correlationId: 'corr-retired-subtitle',
            edit: { kind: 'set_subtitle', text: '不应写入' } as never,
            expectedRevision: base,
            workflowId: completed.id,
            workspaceId: completed.workspaceId,
          },
          () => Date.parse('2026-07-20T07:59:59.000Z'),
        ),
      /Unsupported video edit set_subtitle/,
    );
    assert.equal(commands.get(completed.id)?.revision, base);

    const selected = commands.edit(
      {
        actorId: 'actor-a',
        correlationId: 'corr-select',
        edit: { kind: 'select_candidate', shotId: 'shot-1', candidateIndex: 0 },
        expectedRevision: base,
        workflowId: completed.id,
        workspaceId: completed.workspaceId,
      },
      () => Date.parse('2026-07-20T08:00:00.000Z'),
    );
    assert.equal(selected.revision, base + 1);

    const reordered = commands.edit(
      {
        actorId: 'actor-a',
        correlationId: 'corr-order',
        edit: { kind: 'reorder_shots', shotIds: ['shot-2', 'shot-1'] },
        expectedRevision: selected.revision,
        workflowId: completed.id,
        workspaceId: completed.workspaceId,
      },
      () => Date.parse('2026-07-20T08:00:01.000Z'),
    );
    assert.deepEqual(reordered.shots.map((shot) => shot.id), ['shot-2', 'shot-1']);
    assert.deepEqual(
      reordered.clipAssets.map((asset) => asset.id),
      [completed.clipAssets[1]!.id, completed.clipAssets[0]!.id],
    );

    assert.throws(
      () =>
        commands.edit(
          {
            actorId: 'actor-a',
            correlationId: 'corr-stale',
            edit: {
              kind: 'select_candidate',
              shotId: 'shot-1',
              candidateIndex: 0,
            },
            expectedRevision: base,
            workflowId: completed.id,
            workspaceId: completed.workspaceId,
          },
          () => Date.parse('2026-07-20T08:00:03.000Z'),
        ),
      /revision is stale/,
    );

    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      const terminal = liftDurableToCanonical(completed);
      terminal.job.status = status;
      const terminalStore = new InMemoryCanonicalVideoRunStore();
      terminalStore.restore(terminal);
      const terminalCommands = new VideoWorkflowCanonicalCommands(
        terminalStore,
      );
      assert.throws(
        () =>
          terminalCommands.edit(
            {
              actorId: 'actor-a',
              correlationId: `corr-terminal-${status}`,
              edit: {
                kind: 'select_candidate',
                shotId: 'shot-1',
                candidateIndex: 0,
              },
              expectedRevision: terminal.job.revision,
              workflowId: completed.id,
              workspaceId: completed.workspaceId,
            },
            () => Date.parse('2026-07-20T08:00:04.000Z'),
          ),
        /terminal workflows are read only/,
      );
    }
  });
});
