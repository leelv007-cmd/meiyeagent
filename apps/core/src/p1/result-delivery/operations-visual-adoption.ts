import { createHash } from 'node:crypto';

import {
  contentPackageVisibleStatus,
  toPublicContentPackage,
  type ContentPackage,
  type ResultAdjustCommand,
  type ResultAdjustConfirmCommand,
  type ResultAdjustSource,
  type ResultAdjustTextSelectionScope,
  type ResultAdoptCommand,
  type ResultExportCommand,
  type ReviseContentPackageVisualsCommand,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { AgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import { resolveAuthoritativeContentPackageVersionPlatform } from '../execution-spine/source-content-package-resolver.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  type OperationsApplicationService,
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
  }): Promise<
	| CreationExecutionSnapshot
	| {
		snapshot: CreationExecutionSnapshot;
		agentThreadId?: AgentThreadIdentity;
		artifactLineage?: {
		  artifactId: string;
		  parentRevision: number;
		  targetUnitIds?: string[];
		  sourceUnitMappings?: Array<{ sourceUnitId: string; executionUnitId: string }>;
		};
		/**
		 * The ready artifact revision was found but could not be read as
		 * artifact-update/v1. Distinguishes untrustworthy lineage (fail closed)
		 * from absent lineage (legacy Result, adjustable without continuation).
		 */
		artifactLineageUnreadable?: true;
	  }
	| null
  >;
}

export interface ResultAdjustComposerSubmissionPort {
  prepareTextSelection(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<{ catalogModelId: string; operation: 'copy.generate' }>;
  submit(input: {
    actorId: string;
    idempotencyKey: string;
    instruction: string;
    outputCount: number;
    pageRegenerationTargetAssetIds?: string[];
    quote: { id: string; revision: string };
    sourceContentPackage: { id: string; revision: number };
    sourceNoteStyleId?: string;
    sourceSnapshot: CreationExecutionSnapshot;
	sourceAgentThreadId?: AgentThreadIdentity;
	sourceArtifactLineage?: {
	  artifactId: string;
	  parentRevision: number;
	  targetUnitIds?: string[];
	  sourceUnitMappings?: Array<{ sourceUnitId: string; executionUnitId: string }>;
	};
    taskId: string;
    textSelectionScope?: ResultAdjustTextSelectionScope;
    workId: string;
    workspaceId: string;
  }): Promise<{
    contentPackage: { id: string };
    task: { id: string };
    work: { id: string };
  }>;
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

function composerAdjustmentIds(input: {
  instruction: string;
  scope: ResultAdjustCommand['scope'];
  source: Extract<ResultAdjustSource, { kind: 'content_package_snapshot' }>;
  workId: string;
  workspaceId: string;
}) {
  const suffix = fingerprintValue({
    instruction: input.instruction,
    scope: input.scope ?? null,
    source: input.source,
    workId: input.workId,
    workspaceId: input.workspaceId,
  }).slice(0, 32);
  return {
    task: { id: `composer-task:result-adjust:${suffix}` },
    work: { id: `work-result-adjust-${suffix}` },
  };
}

function resultAdjustScopeAssetIds(scope: ResultAdjustCommand['scope']) {
  if (!scope || scope.kind === 'text_selection') return [];
  return scope.kind === 'asset' ? [scope.assetId] : scope.assetIds;
}

function resultAdjustInstruction(
  instruction: string,
  scope: ResultAdjustCommand['scope'],
) {
  if (!scope) return instruction;
  if (scope.kind === 'asset') {
    return `${instruction}\n调整范围：单张 ${scope.assetId}`;
  }
  if (scope.kind === 'set') {
    return `${instruction}\n调整范围：整组 ${scope.assetIds.join(', ')}`;
  }
  return `${instruction}\n调整范围：正文选区 ${scope.start}-${scope.end}\n选中文字：${scope.selectedText}\n候选 body 必须返回完整正文，且仅允许上述选区变化；选区外的前缀和后缀必须逐字保留。`;
}

function textSelectionVersion(
  contentPackage: ContentPackage,
  scope: ResultAdjustTextSelectionScope,
) {
  if (scope.platform) {
    const variant = (contentPackage.variants ?? []).find(
      (candidate) => candidate.platform === scope.platform,
    );
    return variant?.versions.find(
      (candidate) => candidate.id === variant.currentVersionId,
    );
  }
  return contentPackage.versions.find(
    (candidate) => candidate.id === contentPackage.currentVersionId,
  );
}

function assertTextSelectionScope(input: {
  contentPackage?: ContentPackage;
  operation?: CreationExecutionSnapshot['operation'];
  scope: ResultAdjustCommand['scope'];
  snapshot?: CreationExecutionSnapshot;
}) {
  const scope = input.scope;
  if (scope?.kind !== 'text_selection') return;
  const contentPackage = input.contentPackage;
  const authoritativePlatform =
    contentPackage && input.snapshot
      ? resolveAuthoritativeContentPackageVersionPlatform(
          contentPackage,
          input.snapshot.contentPackagePlatform,
        )
      : undefined;
  const version = contentPackage
    ? textSelectionVersion(contentPackage, scope)
    : undefined;
  const digest = version
    ? createHash('sha256').update(version.body).digest('hex')
    : undefined;
  if (
    (input.operation !== 'copy.generate' &&
      input.snapshot?.lens !== 'image_text_note') ||
    !contentPackage ||
    !input.snapshot ||
    scope.platform !== authoritativePlatform ||
    scope.packageId !== contentPackage.id ||
    !version ||
    scope.versionId !== version.id ||
    scope.end > version.body.length ||
    digest !== scope.sourceTextSha256 ||
    version.body.slice(scope.start, scope.end) !== scope.selectedText
  ) {
    throw new OperationsError(
      'RESULT_ADJUST_SCOPE_MISMATCH',
      'The text selection no longer matches the frozen ContentPackage version.',
      409,
    );
  }
}

type ComposerAdjustConfirmCommand = Extract<
  ResultAdjustConfirmCommand,
  { source: { kind: 'content_package_snapshot' } }
>;

function isComposerAdjustConfirmCommand(
  command: ResultAdjustConfirmCommand,
): command is ComposerAdjustConfirmCommand {
  return command.source.kind === 'content_package_snapshot';
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
	const snapshotResult = await this.snapshots?.get({
      snapshotId: source.snapshotId,
      workspaceId: operation.workspaceId,
    });
	const snapshot = snapshotResult && "snapshot" in snapshotResult
		? snapshotResult.snapshot
		: snapshotResult;
	const agentThreadId = snapshotResult && "snapshot" in snapshotResult
		? snapshotResult.agentThreadId
		: undefined;
	const artifactLineage = snapshotResult && "snapshot" in snapshotResult
		? snapshotResult.artifactLineage
		: undefined;
    const snapshotRef = contentPackage.source.creationExecutionSnapshot;
    const snapshotMatchesSource =
      snapshotRef?.id === snapshot?.id ||
      (snapshot?.semanticDecision !== undefined &&
        snapshot.task.id === contentPackage.source.workflowId &&
        snapshot.work.id === contentPackage.source.workId &&
        snapshot.contentPackage.id === contentPackage.id);
    if (
      !snapshot ||
      !snapshotRef ||
      contentPackage.workspaceId !== operation.workspaceId ||
      contentPackage.source.workId !== snapshot.work.id ||
      contentPackage.source.workflowId !== source.workflowId ||
      contentPackage.source.workflowId !== snapshot.task.id ||
      contentPackage.source.workflowRevision !== snapshot.revision ||
      snapshot.workspaceId !== operation.workspaceId ||
      source.snapshotId !== snapshotRef.id ||
      !snapshotMatchesSource ||
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
	// Absent lineage is not an error. `agentBinding.threadId` arrived with V31-15,
	// so no Result delivered before it carries one, and a run that never reached a
	// ready artifact revision (a note that ended partial, a video adjusted before
	// its scenes completed) has none either. Those Results stay adjustable; the
	// submit payload below already treats both fields as optional, and the new run
	// publishes a fresh artifact instead of continuing the old one.
	//
	// Fail closed only where the lineage exists and cannot be trusted: a ready
	// artifact revision was found for this Thread and artifact but did not read as
	// artifact-update/v1. Continuing from an unreadable parent revision would
	// splice the merchant's next revision onto a base nobody can reconstruct.
	if (
	  snapshotResult &&
	  'artifactLineageUnreadable' in snapshotResult &&
	  snapshotResult.artifactLineageUnreadable
	) {
	  throw new OperationsError(
		'RESULT_ADJUST_SOURCE_NOT_FOUND',
		'The frozen Result artifact lineage could not be read.',
		409,
	  );
	}
    return { contentPackage, snapshot, agentThreadId, artifactLineage };
  }

  private async adjustmentExecution(input: {
    operation: CreationExecutionSnapshot['operation'];
    scope: ResultAdjustCommand['scope'];
    snapshot: CreationExecutionSnapshot;
    userId: string;
    workspaceId: string;
  }) {
    if (
      input.scope?.kind !== 'text_selection' ||
      input.snapshot.lens !== 'image_text_note'
    ) {
      return {
        catalogModelId: input.snapshot.catalogModel.id,
        operation: input.operation,
      };
    }
    if (!this.composerSubmissions) {
      throw new OperationsError(
        'RESULT_ADJUST_OPERATION_UNSUPPORTED',
        'Text adjustment admission is unavailable.',
        409,
      );
    }
    return this.composerSubmissions.prepareTextSelection({
      actorId: input.userId,
      workspaceId: input.workspaceId,
    });
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
        const composerSource =
          command.source.kind === 'content_package_snapshot'
            ? command.source
            : undefined;
        const frozen = composerSource
          ? await this.frozenSource(operation, composerSource)
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
        const sourceCatalogModelId =
          sourceJob?.contract.catalogModelId ?? frozen?.snapshot.catalogModel.id;
        if (
          !sourceCatalogModelId ||
          sourceOperation !== 'copy.generate' &&
          sourceOperation !== 'image.generate'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_OPERATION_UNSUPPORTED',
            'This Result operation does not support quoted adjustment.',
            409,
          );
        }
        assertTextSelectionScope({
          contentPackage: frozen?.contentPackage,
          operation: sourceOperation,
          scope: command.scope,
          snapshot: frozen?.snapshot,
        });
        const adjustmentExecution = frozen
          ? await this.adjustmentExecution({
              operation: sourceOperation,
              scope: command.scope,
              snapshot: frozen.snapshot,
              userId: operation.userId,
              workspaceId: operation.workspaceId,
            })
          : {
              catalogModelId: sourceCatalogModelId,
              operation: sourceOperation,
            };
        const scopeAssetIds = resultAdjustScopeAssetIds(command.scope);
        const currentPackageVersion = frozen
          ? command.scope?.kind === 'text_selection'
            ? textSelectionVersion(frozen.contentPackage, command.scope)
            : frozen.contentPackage.versions.find(
                (version) =>
                  version.id === frozen.contentPackage.currentVersionId,
              )
          : undefined;
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
        const preparedIds =
          frozen && composerSource
            ? composerAdjustmentIds({
                instruction: command.instruction,
                scope: command.scope,
                source: composerSource,
                workId: source.id,
                workspaceId: operation.workspaceId,
              })
            : undefined;
        const derived =
          preparedIds?.work ??
          (await this.operations.deriveCreativeWork(
            operation,
            source.id,
            {
              autoConfirmBrief: true,
              intent: `${source.intent}\n\n调整要求：${resultAdjustInstruction(
                command.instruction,
                command.scope,
              )}`,
              sessionId: source.sessionId,
              sourceReferences: [
                { id: source.id, kind: 'work' },
                ...scopeAssetIds.map((id) => ({ id, kind: 'asset' as const })),
              ],
            },
          ));
        return {
          quoteIntent: {
            ...(adjustmentExecution.operation !== 'copy.generate' &&
            (sourceJob?.contract.aspectRatio ??
              frozen?.snapshot.deliverable.aspectRatio)
              ? {
                  aspectRatio:
                    sourceJob?.contract.aspectRatio ??
                    frozen?.snapshot.deliverable.aspectRatio,
                }
              : {}),
            catalogModelId: adjustmentExecution.catalogModelId,
            operation: adjustmentExecution.operation,
            quantity:
              command.scope?.kind === 'text_selection'
                ? 1
                : scopeAssetIds.length > 0
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
        const composerCommand = isComposerAdjustConfirmCommand(command)
          ? command
          : undefined;
        const frozen = composerCommand
          ? await this.frozenSource(operation, composerCommand.source)
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
        const preparedIds =
          frozen && composerCommand
            ? composerAdjustmentIds({
                instruction: composerCommand.instruction,
                scope: composerCommand.scope,
                source: composerCommand.source,
                workId: frozen.snapshot.work.id,
                workspaceId: operation.workspaceId,
              })
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
            (!composerCommand ||
              !preparedIds ||
              !this.composerSubmissions ||
              composerCommand.derivedWorkId !== preparedIds.work.id ||
              composerCommand.derivedTaskId !== preparedIds.task.id))
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_PREPARATION_NOT_FOUND',
            'The prepared adjustment Work and its frozen source were not found.',
            404,
          );
        }
        const sourceOperation =
          sourceJob?.contract.operation ?? frozen?.snapshot.operation;
        const sourceCatalogModelId =
          sourceJob?.contract.catalogModelId ?? frozen?.snapshot.catalogModel.id;
        if (
          !sourceCatalogModelId ||
          sourceOperation !== 'copy.generate' &&
          sourceOperation !== 'image.generate'
        ) {
          throw new OperationsError(
            'RESULT_ADJUST_OPERATION_UNSUPPORTED',
            'This Result operation does not support quoted adjustment.',
            409,
          );
        }
        assertTextSelectionScope({
          contentPackage: frozen?.contentPackage,
          operation: sourceOperation,
          scope: composerCommand?.scope,
          snapshot: frozen?.snapshot,
        });
        const adjustmentExecution = frozen
          ? await this.adjustmentExecution({
              operation: sourceOperation,
              scope: composerCommand?.scope,
              snapshot: frozen.snapshot,
              userId: operation.userId,
              workspaceId: operation.workspaceId,
            })
          : {
              catalogModelId: sourceCatalogModelId,
              operation: sourceOperation,
            };
        const inheritedAssetIds = new Set(
          source.sourceReferences
            .filter((reference) => reference.kind === 'asset')
            .map((reference) => reference.id),
        );
        const scopedAssetIds = frozen
          ? resultAdjustScopeAssetIds(composerCommand?.scope)
          : (derived?.sourceReferences ?? [])
              .filter(
                (reference) =>
                  reference.kind === 'asset' &&
                  !inheritedAssetIds.has(reference.id),
              )
              .map((reference) => reference.id);
        const currentPackageVersion = frozen
          ? composerCommand?.scope?.kind === 'text_selection'
            ? textSelectionVersion(
                frozen.contentPackage,
                composerCommand.scope,
              )
            : frozen.contentPackage.versions.find(
                (version) =>
                  version.id === frozen.contentPackage.currentVersionId,
              )
          : undefined;
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
          composerCommand?.scope?.kind === 'text_selection'
            ? 1
            : scopedAssetCount > 0
            ? scopedAssetCount
            : (sourceJob?.contract.outputCount ??
              frozen!.snapshot.deliverable.quantity);
        const aspectRatio =
          sourceJob?.contract.aspectRatio ??
          frozen?.snapshot.deliverable.aspectRatio;
        const expectedOutputLabel = adjustmentExecution.operation.startsWith(
          'copy.',
        )
          ? `${expectedOutputCount} 条内容候选`
          : `${expectedOutputCount} 张 ${aspectRatio} 图片`;
        const catalogModelId = adjustmentExecution.catalogModelId;
        const pendingQuote = await this.quotes.getQuote(
          command.billingQuoteId,
          operation.workspaceId,
        );
        const derivedTaskId =
          composerCommand?.derivedTaskId ?? command.derivedWorkId;
        if (
          !pendingQuote ||
          pendingQuote.workspaceId !== operation.workspaceId ||
          pendingQuote.catalogModelId !== catalogModelId ||
          pendingQuote.outputCount !== expectedOutputCount ||
          pendingQuote.outputLabel !== expectedOutputLabel ||
          (pendingQuote.lifecycleStatus !== 'quoted' &&
            pendingQuote.lifecycleStatus !== 'confirmed') ||
          (pendingQuote.taskId !== undefined &&
            pendingQuote.taskId !== derivedTaskId)
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
                taskId: derivedTaskId,
                workspaceId: operation.workspaceId,
              });
        if (
          quote.taskId !== derivedTaskId ||
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
        if (frozen && composerCommand) {
          const sourceNoteStyleId =
            frozen.snapshot.lens === 'image_text_note'
              ? (currentPackageVersion?.note?.plan.style.id ??
                currentPackageVersion?.harnessCandidateId)
              : undefined;
          if (
            frozen.snapshot.lens === 'image_text_note' &&
            !sourceNoteStyleId
          ) {
            throw new OperationsError(
              'RESULT_ADJUST_SOURCE_NOT_FOUND',
              'The frozen image-text note style was not found.',
              404,
            );
          }
          const notePages = currentPackageVersion?.note?.plan.pages;
          const hasPageSubsetScope =
            composerCommand.scope?.kind === 'asset' ||
            composerCommand.scope?.kind === 'set';
          const scopedAssetIds = new Set(
            resultAdjustScopeAssetIds(composerCommand.scope),
          );
          const targetUnitIds = notePages && hasPageSubsetScope
            ? notePages
                .filter(
                  (page) =>
                    page.imageAssetId !== undefined &&
                    scopedAssetIds.has(page.imageAssetId),
                )
                .map((page) => page.id)
            : undefined;
          if (
            frozen.snapshot.lens === 'image_text_note' &&
            hasPageSubsetScope &&
            (!targetUnitIds || targetUnitIds.length !== expectedOutputCount)
          ) {
            throw new OperationsError(
              'RESULT_ADJUST_SCOPE_MISMATCH',
              'The frozen note target pages do not match the adjustment scope.',
              409,
            );
          }
          return this.composerSubmissions!.submit({
            actorId: operation.userId,
            idempotencyKey: `result-adjust:${idempotencyKey}`,
            instruction: resultAdjustInstruction(
              composerCommand.instruction,
              composerCommand.scope,
            ),
            outputCount: expectedOutputCount,
            ...(frozen.snapshot.lens === 'image_text_note' && hasPageSubsetScope
              ? { pageRegenerationTargetAssetIds: [...scopedAssetIds] }
              : {}),
            quote: { id: quote.quoteId, revision: quote.revision },
            sourceContentPackage: {
              id: frozen.contentPackage.id,
              revision: frozen.contentPackage.revision,
            },
            ...(sourceNoteStyleId ? { sourceNoteStyleId } : {}),
            sourceSnapshot: frozen.snapshot,
			...(frozen.agentThreadId ? { sourceAgentThreadId: frozen.agentThreadId } : {}),
			...(frozen.artifactLineage
			  ? {
				  sourceArtifactLineage: {
					...frozen.artifactLineage,
					...(targetUnitIds ? { targetUnitIds } : {}),
				  },
				}
			  : {}),
            taskId: composerCommand.derivedTaskId,
            ...(composerCommand.scope?.kind === 'text_selection'
              ? { textSelectionScope: composerCommand.scope }
              : {}),
            workId: composerCommand.derivedWorkId,
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
