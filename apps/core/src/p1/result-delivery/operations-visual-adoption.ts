import {
  contentPackageVisibleStatus,
  toPublicContentPackage,
  type ContentPackage,
  type ResultAdjustCommand,
  type ResultAdjustConfirmCommand,
  type ResultAdjustSource,
  type ResultAdoptCommand,
  type ResultExportCommand,
  type ReviseContentPackageVisualsCommand,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
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

export interface ResultAdjustSnapshotReadPort {
  get(input: {
    snapshotId: string;
    workspaceId: string;
  }): Promise<CreationExecutionSnapshot | null>;
}

export interface ResultAdjustComposerSubmissionPort {
  submit(input: {
    actorId: string;
    idempotencyKey: string;
    instruction: string;
    quote: { id: string; revision: string };
    sourceContentPackage: { id: string; revision: number };
    sourceSnapshot: CreationExecutionSnapshot;
    taskId: string;
    workId: string;
    workspaceId: string;
  }): Promise<{ work: { id: string } }>;
}

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

const CREATIVE_SESSION_ID = /^[A-Za-z0-9._:-]{1,160}$/u;

function resultAdjustSessionId(work: { id: string; sessionId: string }) {
  if (CREATIVE_SESSION_ID.test(work.sessionId)) return work.sessionId;
  return `result-adjust:${work.id}`
    .replace(/[^A-Za-z0-9._:-]/gu, '-')
    .slice(0, 160);
}

function composerAdjustmentIds(workspaceId: string, idempotencyKey: string) {
  const suffix = fingerprintValue({ idempotencyKey, workspaceId }).slice(0, 32);
  return {
    task: { id: `composer-task:result-adjust:${suffix}` },
    work: { id: `work-result-adjust-${suffix}` },
  };
}

function isComposerAdjustmentPair(workId: string, taskId: string) {
  return (
    workId.startsWith('work-result-adjust-') &&
    taskId ===
      `composer-task:result-adjust:${workId.slice('work-result-adjust-'.length)}`
  );
}

function resultAdjustScopeAssetIds(
  scope: ResultAdjustCommand['scope'] | ResultAdjustConfirmCommand['scope'],
) {
  return scope
    ? scope.kind === 'asset'
      ? [scope.assetId]
      : scope.assetIds
    : [];
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
    private readonly snapshots?: ResultAdjustSnapshotReadPort,
    private readonly composerSubmissions?: ResultAdjustComposerSubmissionPort,
  ) {}

  private async frozenSource(
    operation: OperationContext,
    source: Extract<ResultAdjustSource, { kind: 'content_package_snapshot' }>,
  ) {
    const contentPackage = await this.operations.getContentPackage(
      operation,
      source.packageId,
    );
    if (contentPackage.revision !== source.expectedPackageRevision) {
      throw new OperationsError(
        'RESULT_ADJUST_REVISION_CONFLICT',
        'The Result changed before this adjustment was submitted.',
        409,
      );
    }
    const snapshot = await this.snapshots?.get({
      snapshotId: source.snapshotId,
      workspaceId: operation.workspaceId,
    });
    const snapshotRef = contentPackage.source.creationExecutionSnapshot;
    if (
      !snapshot ||
      !snapshotRef ||
      contentPackage.workspaceId !== operation.workspaceId ||
      contentPackage.source.workId !== snapshot.work.id ||
      contentPackage.source.workflowId !== source.workflowId ||
      contentPackage.source.workflowId !== snapshot.task.id ||
      contentPackage.source.workflowRevision !== snapshot.revision ||
      snapshot.workspaceId !== operation.workspaceId ||
      snapshot.id !== source.snapshotId ||
      snapshotRef.id !== snapshot.id ||
      snapshotRef.revision !== snapshot.revision ||
      snapshot.contentPackage.id !== contentPackage.id ||
      (snapshotRef.modelSelection !== undefined &&
        JSON.stringify(snapshotRef.modelSelection) !==
          JSON.stringify(snapshot.modelSelection))
    ) {
      throw new OperationsError(
        'RESULT_ADJUST_SOURCE_NOT_FOUND',
        'The frozen ContentPackage adjustment source was not found.',
        404,
      );
    }
    return { contentPackage, snapshot };
  }

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
        if (!source) {
          throw new OperationsError(
            'RESULT_ADJUST_SOURCE_NOT_FOUND',
            'The source Work was not found.',
            404,
          );
        }
        const frozen =
          command.source.kind === 'content_package_snapshot'
            ? await this.frozenSource(operation, command.source)
            : undefined;
        const legacyBaseJobId =
          command.source.kind === 'legacy_job'
            ? command.source.baseJobId
            : undefined;
        const sourceJob = legacyBaseJobId
          ? workbench.jobs.find(({ id }) => id === legacyBaseJobId)
          : undefined;
        if (
          command.source.kind === 'legacy_job' &&
          (!sourceJob || sourceJob.workId !== source.id)
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_SOURCE_NOT_FOUND',
            'The source Work and frozen Job were not found.',
            404,
          );
        }
        if (frozen && frozen.snapshot.work.id !== source.id) {
          throw new OperationsError(
            'RESULT_ADJUST_SOURCE_NOT_FOUND',
            'The frozen ContentPackage does not belong to the source Work.',
            404,
          );
        }
        if (
          source.updatedAt !== command.expectedWorkUpdatedAt ||
          (sourceJob &&
            (source.currentJobId !== sourceJob.id ||
              sourceJob.status !== 'completed'))
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_REVISION_CONFLICT',
            'The Result changed before this adjustment was submitted.',
            409,
          );
        }
        const sourceOperation =
          sourceJob?.contract.operation ?? frozen?.snapshot.operation;
        if (sourceOperation === 'video.generate') {
          throw new OperationsError(
            'RESULT_VIDEO_REGENERATION_REQUIRED',
            'Video adjustments use the quoted regeneration workflow.',
            409,
          );
        }
        if (
          sourceOperation !== 'copy.generate' &&
          sourceOperation !== 'image.generate'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_OPERATION_UNSUPPORTED',
            'This Result operation does not support quoted adjustment.',
            409,
          );
        }
        const scopeAssetIds = resultAdjustScopeAssetIds(command.scope);
        const currentPackageVersion = frozen?.contentPackage.versions.find(
          (version) =>
            version.id === frozen.contentPackage.currentVersionId,
        );
        const sourceAssetIds = sourceJob
          ? new Set(
              workbench.assets
                .filter((asset) => asset.jobId === sourceJob.id)
                .map((asset) => asset.id),
            )
          : new Set([
              ...(frozen?.contentPackage.generated.assetIds ?? []),
              ...(frozen?.contentPackage.generated.ownedAssets ?? []).map(
                ({ id }) => id,
              ),
              ...(currentPackageVersion?.orderedAssetIds ?? []),
            ]);
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
        const preparedIds = frozen
          ? composerAdjustmentIds(operation.workspaceId, idempotencyKey)
          : undefined;
        const derived =
          preparedIds?.work ??
          (await this.operations.deriveCreativeWork(
            operation,
            source.id,
            {
              autoConfirmBrief: true,
              intent: `${source.intent}\n\n调整要求：${command.instruction}${scopeInstruction}`,
              sessionId: resultAdjustSessionId(source),
              sourceReferences: [
                { id: source.id, kind: 'work' },
                ...scopeAssetIds.map((id) => ({ id, kind: 'asset' as const })),
              ],
            },
          ));
        return {
          quoteIntent: {
            ...(sourceJob?.contract.aspectRatio ??
            frozen?.snapshot.deliverable.aspectRatio
              ? {
                  aspectRatio:
                    sourceJob?.contract.aspectRatio ??
                    frozen?.snapshot.deliverable.aspectRatio,
                }
              : {}),
            catalogModelId:
              sourceJob?.contract.catalogModelId ??
              frozen!.snapshot.catalogModel.id,
            operation: sourceOperation,
            quantity:
              scopeAssetIds.length > 0
                ? scopeAssetIds.length
                : (sourceJob?.contract.outputCount ??
                  frozen!.snapshot.deliverable.quantity),
          },
          task: preparedIds?.task ?? { id: derived.id },
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
        const frozen =
          command.source.kind === 'content_package_snapshot'
            ? await this.frozenSource(operation, command.source)
            : undefined;
        const legacyBaseJobId =
          command.source.kind === 'legacy_job'
            ? command.source.baseJobId
            : undefined;
        const sourceJob = legacyBaseJobId
          ? workbench.jobs.find(({ id }) => id === legacyBaseJobId)
          : undefined;
        const source = sourceJob
          ? workbench.works.find(({ id }) => id === sourceJob.workId)
          : frozen
            ? workbench.works.find(
                ({ id }) => id === frozen.snapshot.work.id,
              )
            : undefined;
        const derived = sourceJob
          ? workbench.works.find(({ id }) => id === command.derivedWorkId)
          : undefined;
        if (
          !source ||
          (sourceJob &&
            (!derived ||
              source.currentJobId !== sourceJob.id ||
              sourceJob.status !== 'completed')) ||
          (derived &&
            (derived.currentJobId ||
              !derived.sourceReferences.some(
                (reference) =>
                  reference.kind === 'work' && reference.id === source.id,
              ))) ||
          (frozen &&
            (!this.composerSubmissions ||
              !isComposerAdjustmentPair(
                command.derivedWorkId,
                command.derivedTaskId,
              )))
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_PREPARATION_NOT_FOUND',
            'The prepared adjustment Work and its frozen source were not found.',
            404,
          );
        }
        const sourceOperation =
          sourceJob?.contract.operation ?? frozen?.snapshot.operation;
        if (
          sourceOperation !== 'copy.generate' &&
          sourceOperation !== 'image.generate'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_OPERATION_UNSUPPORTED',
            'This Result operation does not support quoted adjustment.',
            409,
          );
        }
        const inheritedAssetIds = new Set(
          source.sourceReferences
            .filter((reference) => reference.kind === 'asset')
            .map((reference) => reference.id),
        );
        const scopedAssetIds = frozen
          ? resultAdjustScopeAssetIds(command.scope)
          : (derived?.sourceReferences ?? [])
              .filter(
                (reference) =>
                  reference.kind === 'asset' &&
                  !inheritedAssetIds.has(reference.id),
              )
              .map((reference) => reference.id);
        const currentPackageVersion = frozen?.contentPackage.versions.find(
          (version) =>
            version.id === frozen.contentPackage.currentVersionId,
        );
        const sourceAssetIds = sourceJob
          ? new Set(
              workbench.assets
                .filter((asset) => asset.jobId === sourceJob.id)
                .map((asset) => asset.id),
            )
          : new Set([
              ...(frozen?.contentPackage.generated.assetIds ?? []),
              ...(frozen?.contentPackage.generated.ownedAssets ?? []).map(
                ({ id }) => id,
              ),
              ...(currentPackageVersion?.orderedAssetIds ?? []),
            ]);
        if (scopedAssetIds.some((assetId) => !sourceAssetIds.has(assetId))) {
          throw new OperationsError(
            'RESULT_ADJUST_SCOPE_MISMATCH',
            'The prepared adjustment scope no longer belongs to the frozen source.',
            409,
          );
        }
        const scopedAssetCount = scopedAssetIds.length;
        const expectedOutputCount =
          scopedAssetCount > 0
            ? scopedAssetCount
            : (sourceJob?.contract.outputCount ??
              frozen!.snapshot.deliverable.quantity);
        const aspectRatio =
          sourceJob?.contract.aspectRatio ??
          frozen?.snapshot.deliverable.aspectRatio;
        const expectedOutputLabel = sourceOperation.startsWith('copy.')
          ? `${expectedOutputCount} 条内容候选`
          : `${expectedOutputCount} 张 ${aspectRatio} 图片`;
        const catalogModelId =
          sourceJob?.contract.catalogModelId ??
          frozen!.snapshot.catalogModel.id;
        const pendingQuote = await this.quotes.getQuote(
          command.billingQuoteId,
          operation.workspaceId,
        );
        if (
          !pendingQuote ||
          pendingQuote.workspaceId !== operation.workspaceId ||
          pendingQuote.catalogModelId !== catalogModelId ||
          pendingQuote.outputCount !== expectedOutputCount ||
          pendingQuote.outputLabel !== expectedOutputLabel ||
          (pendingQuote.lifecycleStatus !== 'quoted' &&
            pendingQuote.lifecycleStatus !== 'confirmed') ||
          (pendingQuote.taskId !== undefined &&
            pendingQuote.taskId !== command.derivedTaskId)
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
                taskId: command.derivedTaskId,
                workspaceId: operation.workspaceId,
              });
        if (
          quote.taskId !== command.derivedTaskId ||
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
        if (frozen) {
          return this.composerSubmissions!.submit({
            actorId: operation.userId,
            idempotencyKey: `result-adjust:${idempotencyKey}`,
            instruction: command.instruction,
            quote: { id: quote.quoteId, revision: quote.revision },
            sourceContentPackage: {
              id: frozen.contentPackage.id,
              revision: frozen.contentPackage.revision,
            },
            sourceSnapshot: frozen.snapshot,
            taskId: command.derivedTaskId,
            workId: command.derivedWorkId,
            workspaceId: operation.workspaceId,
          });
        }
        const contract = {
          ...structuredClone(sourceJob!.contract),
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
          derived!.id,
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
