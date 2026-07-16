import { createHash } from 'node:crypto';
import {
  modelSupplyJobId,
  type ModelSupplyApplicationService,
  type ModelSupplySubmission,
} from '../model-supply/index.js';
import type { ImageGenerationPort, ImageModelId } from './types.js';

function requestKey(request: Parameters<ImageGenerationPort['submit']>[0]) {
  if (request.idempotencyKey) {
    return createHash('sha256')
      .update(`${request.workspaceId}:${request.idempotencyKey}`)
      .digest('hex');
  }
  return createHash('sha256')
    .update(JSON.stringify(request))
    .digest('hex');
}

/**
 * Bridges the graphics workbench to the same model job/attempt/asset and
 * usage/cost pipeline used by the rest of Product Core.
 */
export class ModelSupplyImageGenerationAdapter implements ImageGenerationPort {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly beforeSubmit?: (workspaceId: string) => Promise<void>
  ) {}

  private submission(
    request: Parameters<ImageGenerationPort['submit']>[0]
  ): ModelSupplySubmission {
    return {
      actorId: request.actorId,
      dataClass: [...request.dataClass],
      idempotencyKey: requestKey(request),
      input: {
        height: 1350,
        referenceAssetIds: request.inputAssetId
          ? [request.inputAssetId]
          : undefined,
        width: 1080,
      },
      operation:
        request.operation === 'edit' ? 'image.edit' : 'image.generate',
      prompt: request.prompt,
      selection: {
        catalogModelId: request.requestedModelId,
        mode: 'fixed',
      },
      workspaceId: request.workspaceId,
    };
  }

  jobId(request: Parameters<ImageGenerationPort['submit']>[0]) {
    return modelSupplyJobId(this.submission(request));
  }

  async submit(request: Parameters<ImageGenerationPort['submit']>[0]) {
    await this.beforeSubmit?.(request.workspaceId);
    const result = await this.models.submit(this.submission(request));

    const actualModelId = result.snapshot.actualCatalogModelId as ImageModelId;
    const durable = await this.readDurable(request.workspaceId, result.jobId);
    const current = durable?.result ?? result;
    return {
      actualModelId,
      id: result.jobId,
      outputAssetId: current.asset?.id,
      outputAssetUrl: current.asset
        ? this.models.assetPublicUrl(current.asset.objectKey)
        : undefined,
      status: durable?.status ?? result.status,
    };
  }

  async get(request: {
    actorId: string;
    workspaceId: string;
    jobId: string;
  }) {
    const durable = await this.models.getDurableMediaJob(
      request.workspaceId,
      request.jobId,
    );
    return this.view(durable);
  }

  async cancel(
    request: Parameters<NonNullable<ImageGenerationPort['cancel']>>[0]
  ) {
    return this.view(await this.models.cancelDurableMediaJob(request));
  }

  private async readDurable(workspaceId: string, jobId: string) {
    try {
      return await this.models.getDurableMediaJob(workspaceId, jobId);
    } catch {
      return undefined;
    }
  }

  private view(
    durable: Awaited<
      ReturnType<ModelSupplyApplicationService['getDurableMediaJob']>
    >,
  ) {
    const asset = durable.result.asset;
    return {
      actualModelId: durable.result.snapshot.actualCatalogModelId as ImageModelId,
      id: durable.jobId,
      outputAssetId: asset?.id,
      outputAssetUrl: asset
        ? this.models.assetPublicUrl(asset.objectKey)
        : undefined,
      status: durable.status,
    };
  }
}
