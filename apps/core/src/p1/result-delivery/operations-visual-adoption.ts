import {
  contentPackageVisibleStatus,
  toPublicContentPackage,
  type ContentPackage,
  type ResultAdjustCommand,
  type ResultAdjustConfirmCommand,
  type ResultAdoptCommand,
  type ResultExportCommand,
  type ReviseContentPackageVisualsCommand,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  OperationsApplicationService,
  OperationsError,
} from '../operations/application-service.js';
import type { OperationContext } from '../operations/types.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import type {
  FirstAdoptCommand,
  VisualAdoptionResult,
} from './visual-adoption.js';

function operationContext(context: P1Context): OperationContext {
  const actor = context.actor ?? 'owner';
  if (actor === 'payment') {
    throw new OperationsError(
      'FORBIDDEN',
      'The payment actor cannot perform result delivery actions.',
      403,
    );
  }
  return {
    actor,
    correlationId: context.correlationId,
    userId: context.userId,
    workspaceId: context.workspaceId,
  };
}

function merchantPackage(contentPackage: ContentPackage): VisualAdoptionResult {
  return {
    ...toPublicContentPackage(contentPackage),
    ...contentPackageVisibleStatus(contentPackage.status),
  };
}

/**
 * Production visual-adoption port backed by the canonical Operations workspace
 * transaction and ContentPackage Postgres CAS. It owns no process-local state.
 */
export class OperationsVisualAdoptionPort {
  constructor(private readonly operations: OperationsApplicationService) {}

  async firstAdopt(
    context: P1Context,
    command: FirstAdoptCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult> {
    const operation = operationContext(context);
    const execute = () =>
      this.operations.adoptIntoContentPackage(operation, command);
    const result = idempotencyKey
      ? await this.operations.executeIdempotentModuleCommand(
          operation,
          idempotencyKey,
          { action: 'adopt_into_content_package', payload: command },
          execute,
        )
      : await execute();
    return merchantPackage(result);
  }

  async reviseContentPackageVisuals(
    context: P1Context,
    command: ReviseContentPackageVisualsCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult> {
    const operation = operationContext(context);
    const execute = () =>
      this.operations.reviseContentPackageVisuals(operation, command);
    const result = idempotencyKey
      ? await this.operations.executeIdempotentModuleCommand(
          operation,
          idempotencyKey,
          { action: 'revise_content_package_visuals', payload: command },
          execute,
        )
      : await execute();
    return merchantPackage(result);
  }
}

/** Production Result commands backed by the canonical Operations ledger. */
export class OperationsResultCommandPort {
  constructor(
    private readonly operations: OperationsApplicationService,
    private readonly quotes: Pick<
      ProductBillingApplicationPort,
      'confirm' | 'getQuote'
    >,
  ) {}

  async adopt(
    context: P1Context,
    command: ResultAdoptCommand,
    idempotencyKey: string,
  ) {
    const operation = operationContext(context);
    const result = await this.operations.executeIdempotentModuleCommand(
      operation,
      idempotencyKey,
      { action: 'result_adopt', payload: command },
      () => this.operations.adoptResult(operation, command),
    );
    return merchantPackage(result);
  }

  async prepareAdjust(
    context: P1Context,
    command: ResultAdjustCommand,
    idempotencyKey: string,
  ) {
    const operation = operationContext(context);
    return this.operations.executeIdempotentModuleCommand(
      operation,
      idempotencyKey,
      { action: 'result_adjust_prepare', payload: command },
      async () => {
        const workbench = await this.operations.getCreativeWorkbench(operation);
        const source = workbench.works.find(({ id }) => id === command.workId);
        const sourceJob = workbench.jobs.find(
          ({ id }) => id === command.baseJobId,
        );
        if (!source || !sourceJob || sourceJob.workId !== source.id) {
          throw new OperationsError(
            'RESULT_ADJUST_SOURCE_NOT_FOUND',
            'The source Work and frozen Job were not found.',
            404,
          );
        }
        if (
          source.currentJobId !== sourceJob.id ||
          source.updatedAt !== command.expectedWorkUpdatedAt ||
          sourceJob.status !== 'completed'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_REVISION_CONFLICT',
            'The Result changed before this adjustment was submitted.',
            409,
          );
        }
        if (sourceJob.contract.operation === 'video.generate') {
          throw new OperationsError(
            'RESULT_VIDEO_REGENERATION_REQUIRED',
            'Video adjustments use the quoted regeneration workflow.',
            409,
          );
        }
        if (
          sourceJob.contract.operation !== 'copy.generate' &&
          sourceJob.contract.operation !== 'image.generate'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_OPERATION_UNSUPPORTED',
            'This Result operation does not support quoted adjustment.',
            409,
          );
        }
        const scopeAssetIds = command.scope
          ? command.scope.kind === 'asset'
            ? [command.scope.assetId]
            : command.scope.assetIds
          : [];
        const sourceAssetIds = new Set(
          workbench.assets
            .filter((asset) => asset.jobId === sourceJob.id)
            .map((asset) => asset.id),
        );
        if (
          new Set(scopeAssetIds).size !== scopeAssetIds.length ||
          scopeAssetIds.some((assetId) => !sourceAssetIds.has(assetId))
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_SCOPE_MISMATCH',
            'The adjustment scope does not belong to the source Job.',
            409,
          );
        }
        const scopeInstruction = command.scope
          ? command.scope.kind === 'asset'
            ? `\n调整范围：单张 ${command.scope.assetId}`
            : `\n调整范围：整组 ${command.scope.assetIds.join(', ')}`
          : '';
        const derived = await this.operations.deriveCreativeWork(
          operation,
          source.id,
          {
            autoConfirmBrief: true,
            intent: `${source.intent}\n\n调整要求：${command.instruction}${scopeInstruction}`,
            sessionId: source.sessionId,
            sourceReferences: [
              { id: source.id, kind: 'work' },
              ...scopeAssetIds.map((id) => ({ id, kind: 'asset' as const })),
            ],
          },
        );
        return {
          quoteIntent: {
            ...(sourceJob.contract.aspectRatio
              ? { aspectRatio: sourceJob.contract.aspectRatio }
              : {}),
            catalogModelId: sourceJob.contract.catalogModelId,
            operation: sourceJob.contract.operation,
            quantity:
              scopeAssetIds.length > 0
                ? scopeAssetIds.length
                : sourceJob.contract.outputCount,
          },
          work: derived,
        };
      },
    );
  }

  async adjust(
    context: P1Context,
    command: ResultAdjustConfirmCommand,
    idempotencyKey: string,
  ) {
    const operation = operationContext(context);
    return this.operations.executeIdempotentModuleCommand(
      operation,
      idempotencyKey,
      { action: 'result_adjust', payload: command },
      async () => {
        const workbench = await this.operations.getCreativeWorkbench(operation);
        const sourceJob = workbench.jobs.find(
          ({ id }) => id === command.baseJobId,
        );
        const source = sourceJob
          ? workbench.works.find(({ id }) => id === sourceJob.workId)
          : undefined;
        const derived = workbench.works.find(
          ({ id }) => id === command.derivedWorkId,
        );
        if (
          !source ||
          !sourceJob ||
          !derived ||
          source.currentJobId !== sourceJob.id ||
          sourceJob.status !== 'completed' ||
          derived.currentJobId ||
          !derived.sourceReferences.some(
            (reference) =>
              reference.kind === 'work' && reference.id === source.id,
          )
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_PREPARATION_NOT_FOUND',
            'The prepared adjustment Work and its frozen source were not found.',
            404,
          );
        }
        const inheritedAssetIds = new Set(
          source.sourceReferences
            .filter((reference) => reference.kind === 'asset')
            .map((reference) => reference.id),
        );
        const scopedAssetIds = derived.sourceReferences
          .filter(
            (reference) =>
              reference.kind === 'asset' &&
              !inheritedAssetIds.has(reference.id),
          )
          .map((reference) => reference.id);
        const sourceJobAssetIds = new Set(
          workbench.assets
            .filter((asset) => asset.jobId === sourceJob.id)
            .map((asset) => asset.id),
        );
        if (scopedAssetIds.some((assetId) => !sourceJobAssetIds.has(assetId))) {
          throw new OperationsError(
            'RESULT_ADJUST_SCOPE_MISMATCH',
            'The prepared adjustment scope no longer belongs to the source Job.',
            409,
          );
        }
        const scopedAssetCount = scopedAssetIds.length;
        const expectedOutputCount =
          scopedAssetCount > 0
            ? scopedAssetCount
            : sourceJob.contract.outputCount;
        const expectedOutputLabel = sourceJob.contract.operation.startsWith(
          'copy.',
        )
          ? `${expectedOutputCount} 条内容候选`
          : `${expectedOutputCount} 张 ${sourceJob.contract.aspectRatio} 图片`;
        const pendingQuote = await this.quotes.getQuote(
          command.billingQuoteId,
          operation.workspaceId,
        );
        if (
          !pendingQuote ||
          pendingQuote.workspaceId !== operation.workspaceId ||
          pendingQuote.catalogModelId !== sourceJob.contract.catalogModelId ||
          pendingQuote.outputCount !== expectedOutputCount ||
          pendingQuote.outputLabel !== expectedOutputLabel ||
          (pendingQuote.lifecycleStatus !== 'quoted' &&
            pendingQuote.lifecycleStatus !== 'confirmed') ||
          (pendingQuote.taskId !== undefined &&
            pendingQuote.taskId !== derived.id)
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_QUOTE_MISMATCH',
            'The fresh Product quote does not match this prepared adjustment.',
            409,
          );
        }
        const quote =
          pendingQuote.lifecycleStatus === 'confirmed'
            ? pendingQuote
            : await this.quotes.confirm({
                quoteId: pendingQuote.quoteId,
                taskId: derived.id,
                workspaceId: operation.workspaceId,
              });
        if (
          quote.taskId !== derived.id ||
          quote.lifecycleStatus !== 'confirmed' ||
          !quote.catalogModelRevision ||
          quote.confirmedAmount === undefined ||
          !quote.formula.currency ||
          quote.outputCount !== expectedOutputCount ||
          quote.outputLabel !== expectedOutputLabel ||
          !quote.confirmedAt
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_QUOTE_INCOMPLETE',
            'The confirmed Product quote is incomplete for submission.',
            409,
          );
        }
        const contract = {
          ...structuredClone(sourceJob.contract),
          catalogModelId: quote.catalogModelId,
          catalogRevision: quote.catalogModelRevision,
          currency: quote.formula.currency,
          estimatedAmount: quote.confirmedAmount,
          outputCount: quote.outputCount,
          outputLabel: quote.outputLabel,
          quoteAcceptedAt: quote.confirmedAt,
          quoteRevision: quote.revision,
        };
        return this.operations.submitCreativeWork(
          operation,
          derived.id,
          contract,
          `result-adjust:${idempotencyKey}`,
          undefined,
          undefined,
          undefined,
          undefined,
          command.billingQuoteId,
        );
      },
    );
  }

  async exportPackage(
    context: P1Context,
    command: ResultExportCommand,
    idempotencyKey: string,
  ) {
    const operation = operationContext(context);
    return this.operations.executeIdempotentModuleCommand(
      operation,
      idempotencyKey,
      { action: 'result_export', payload: command },
      async () => {
        const contentPackage = await this.operations.exportContentPackage(
          operation,
          command,
        );
        const receipt = [...contentPackage.exportReceipts]
          .reverse()
          .find(
            (candidate) =>
              candidate.platform === command.platform &&
              candidate.status === 'succeeded',
          );
        if (!receipt?.artifactAssetId || !receipt.artifactObjectKey) {
          throw new OperationsError(
            'RESULT_EXPORT_ARTIFACT_MISSING',
            'The export completed without a downloadable artifact receipt.',
            502,
          );
        }
        return {
          artifactAssetId: receipt.artifactAssetId,
          contentPackage: merchantPackage(contentPackage),
          contentType: receipt.contentType,
          downloadUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(receipt.artifactObjectKey)}`,
          receiptId: receipt.id,
        };
      },
    );
  }
}
