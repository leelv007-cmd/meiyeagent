import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelSupplyApplicationService,
  MemoryModelAssetStorage,
  RecordedAdapterRouter,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from '../model-supply/index.js';
import { ModelSupplyImageGenerationAdapter } from './model-supply-image-adapter.js';

test('graphics workbench persists a fixed model result through model supply', async () => {
  const saved: Array<{ workspaceId: string; jobId: string }> = [];
  const models = new ModelSupplyApplicationService({
    assetStorage: new (class extends MemoryModelAssetStorage {
      publicUrl(objectKey: string) {
        return `http://core.test/v1/assets/${objectKey}`;
      }
    })(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['gpt-image-2-managed'],
      activationEvidenceStatus: 'recorded',
    }),
    execution: new RecordedAdapterRouter(),
    models: createDefaultCatalogModels(),
    resultSink: {
      async saveResult(workspaceId, result) {
        saved.push({ jobId: result.jobId, workspaceId });
      },
    },
  });

  const adapter = new ModelSupplyImageGenerationAdapter(models);
  const request: Parameters<typeof adapter.submit>[0] = {
    actorId: 'owner-a',
    dataClass: [],
    operation: 'generate',
    origin: { kind: 'layout_work', id: 'work-a', revisionId: 'work-a-r1' },
    prompt: '门店护肤项目氛围图',
    requestedModelId: 'gpt-image-2',
    workspaceId: 'workspace-a',
  };
  const expectedJobId = adapter.jobId(request);
  const result = await adapter.submit(request);

  assert.equal(result.id, expectedJobId);
  assert.equal(result.actualModelId, 'gpt-image-2');
  assert.equal(result.status, 'completed');
  assert.match(
    result.outputAssetUrl ?? '',
    /^http:\/\/core\.test\/v1\/assets\/workspace-a\/generated\//,
  );
  assert.deepEqual(saved, [
    { jobId: result.id, workspaceId: 'workspace-a' },
  ]);
});

test('graphics workbench preserves actor and sensitive data classes', async () => {
  const submissions: Array<{ actorId: string; dataClass: string[] }> = [];
  const adapter = new ModelSupplyImageGenerationAdapter({
    async submit(
      submission: Parameters<ModelSupplyApplicationService['submit']>[0]
    ) {
      submissions.push({
        actorId: submission.actorId,
        dataClass: submission.dataClass,
      });
      return {
        asset: undefined,
        jobId: 'model-job-a',
        status: 'completed' as const,
        snapshot: { actualCatalogModelId: 'seedream-5-pro' },
      } as never;
    },
  } as unknown as ModelSupplyApplicationService);

  await adapter.submit({
    actorId: 'owner-sensitive',
    dataClass: ['contains_face', 'pii'],
    inputAssetId: 'asset-sensitive-a',
    operation: 'edit',
    origin: { kind: 'layout_work', id: 'work-a', revisionId: 'work-a-r1' },
    prompt: '保持人物特征',
    requestedModelId: 'seedream-5-pro',
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(submissions, [
    {
      actorId: 'owner-sensitive',
      dataClass: ['contains_face', 'pii'],
    },
  ]);
});
