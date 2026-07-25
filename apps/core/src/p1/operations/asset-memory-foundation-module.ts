import {
  assetIntakeMissingFactKeysQuerySchema,
  assetDraftViewQuerySchema,
  assetIntakeExperienceQuerySchema,
  assetIntakeViewQuerySchema,
  confirmAssetIntakeFactCommandSchema,
  confirmPreferenceCommandSchema,
  confirmReusableAssetCommandSchema,
  correctAssetIntakeFactCommandSchema,
  createReuseTaskCommandSchema,
  deactivateSeriesCommandSchema,
  parseAssetBatchCommandSchema,
  parseSingleAssetCommandSchema,
  parseTaskViewQuerySchema,
  preferenceViewQuerySchema,
  prepareAssistedPriceIntakeCommandSchema,
  prepareManualAssetDraftCommandSchema,
  promoteAssetDraftCommandSchema,
  proposePreferenceCommandSchema,
  proposeReusableAssetCommandSchema,
  recordAssetIntakeBatchCommandSchema,
  recordPreferenceSignalCommandSchema,
  rejectAssetIntakeCandidateCommandSchema,
  reusableAssetViewQuerySchema,
  reusableAssetRevisionQuerySchema,
  revokePreferenceCommandSchema,
  seriesSuggestionsQuerySchema,
  type ReuseTaskSeed,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { AssetIntakeService } from './asset-intake-service.js';
import type { ContextBundleRepository } from './context-bundle-repository.js';
import type { ReuseMemoryService } from './reuse-memory-service.js';
import type { ParseService } from './parse-service.js';

export interface ReuseTaskSubmissionPort {
  submit(input: {
    context: P1Context;
    taskId: string;
    packageId: string;
    rawInput: string;
    workflowRevision: number;
    assetIds: string[];
    factScope: {
      storeId: string;
      serviceId?: string;
      personaId?: string;
      platform?: string;
    };
    seed: ReuseTaskSeed;
    suggestion?: {
      suggestionId: string;
      explanation: string;
      variableSlotKeys: string[];
    };
  }): Promise<unknown>;
}

function action(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'An asset-memory action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'An asset-memory payload is required.',
    );
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', 'Invalid asset-memory payload.');
  }
  return parsed.data;
}

export class AssetMemoryFoundationModule implements P1OperationModule {
  readonly name = 'asset-memory';

  constructor(
    private readonly intake: AssetIntakeService,
    private readonly bundles: ContextBundleRepository,
    private readonly reuse: ReuseMemoryService,
    private readonly reuseTasks?: ReuseTaskSubmissionPort,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly parsing?: ParseService,
  ) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    const value = payload(args.input);
    switch (name) {
      case 'parse_single_asset':
        return this.requireParsing().parseSingle(
          args.context,
          parse(parseSingleAssetCommandSchema, value),
        );
      case 'parse_asset_batch':
        return this.requireParsing().startBatch(
          args.context,
          parse(parseAssetBatchCommandSchema, value),
        );
      case 'prepare_manual_asset_draft':
        return this.requireParsing().prepareManualDraft(
          args.context,
          parse(prepareManualAssetDraftCommandSchema, value),
        );
      case 'promote_asset_draft': {
        const input = parse(promoteAssetDraftCommandSchema, value);
        const draft = await this.requireParsing().draft(
          args.context.workspaceId,
          input.draftId,
          input.draftRevision,
        );
        if (draft.factCandidates.length === 0) {
          throw new P1DomainError(
            'INVALID_STATE',
            'This draft has no facts to confirm.',
          );
        }
        return this.intake.recordBatch({
          batchId: input.batchId,
          workspaceId: args.context.workspaceId,
          taskId: draft.taskId,
          source: {
            sourceId: draft.sourceAssetId,
            kind:
              draft.target === 'group_buy'
                ? 'group_buy_screenshot'
                : draft.target === 'price_list'
                  ? 'price_list'
                  : 'gallery',
            referenceId: draft.sourceAssetId,
            capabilityStatus: 'assisted',
            sourceWorkspaceId: args.context.workspaceId,
            capturedAt: draft.createdAt,
            example: false,
          },
          summary: `已整理出 ${draft.factCandidates.length} 项待确认资料。`,
          candidates: draft.factCandidates.map((fact, index) => ({
            candidateId: `${draft.draftId}:fact:${index + 1}`,
            status: 'pending' as const,
            objectKind: 'store_fact' as const,
            fact,
          })),
          createdAt: this.now(),
        });
      }
      case 'record_asset_intake_batch': {
        const input = parse(recordAssetIntakeBatchCommandSchema, value);
        if (
          !input.source.example &&
          input.source.sourceWorkspaceId !== args.context.workspaceId
        ) {
          throw new P1DomainError(
            'FORBIDDEN',
            'Asset intake sources cannot cross workspaces.',
          );
        }
        return this.intake.recordBatch({
          ...input,
          workspaceId: args.context.workspaceId,
          createdAt: this.now(),
        });
      }
      case 'prepare_assisted_price_intake': {
        const input = parse(prepareAssistedPriceIntakeCommandSchema, value);
        return this.intake.prepareAssistedPriceIntake(args.context, input);
      }
      case 'correct_asset_intake_fact': {
        const input = parse(correctAssetIntakeFactCommandSchema, value);
        return this.intake.correctFact(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'confirm_asset_intake_fact': {
        const input = parse(confirmAssetIntakeFactCommandSchema, value);
        return this.intake.confirmFact(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'reject_asset_intake_candidate': {
        const input = parse(rejectAssetIntakeCandidateCommandSchema, value);
        return this.intake.rejectCandidate(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'propose_reusable_asset': {
        const input = parse(proposeReusableAssetCommandSchema, value);
        return this.reuse.proposeReusableAsset({
          ...input,
          workspaceId: args.context.workspaceId,
          status: 'pending',
          createdAt: this.now(),
          createdBy: args.context.userId,
        });
      }
      case 'confirm_reusable_asset': {
        const input = parse(confirmReusableAssetCommandSchema, value);
        return this.reuse.confirmReusableAsset(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'deactivate_series': {
        const input = parse(deactivateSeriesCommandSchema, value);
        return this.reuse.deactivateSeries(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'create_reuse_task': {
        const input = parse(createReuseTaskCommandSchema, value);
        if (!this.reuseTasks) {
          throw new P1DomainError(
            'INVALID_STATE',
            'The production Harness is unavailable for reuse Tasks.',
          );
        }
        const continuation = input.suggestionId
          ? await this.reuse.createSeriesContinuationSeed(
              args.context.workspaceId,
              input.assetId,
              input.assetRevision,
              input.suggestionId,
            )
          : {
              seed: await this.reuse.createReuseTaskSeed(
                args.context.workspaceId,
                input.assetId,
                input.assetRevision,
              ),
              suggestion: undefined,
            };
        await this.reuse.verifyReuseTaskSeed(
          args.context.workspaceId,
          continuation.seed,
        );
        return this.reuseTasks.submit({
          context: args.context,
          taskId: input.taskId,
          packageId: `reuse-${input.taskId}`,
          rawInput: input.rawInput,
          workflowRevision: input.workflowRevision,
          assetIds: input.assetIds,
          factScope: input.factScope ?? {
            storeId: args.context.workspaceId,
          },
          seed: continuation.seed,
          ...(continuation.suggestion
            ? { suggestion: continuation.suggestion }
            : {}),
        });
      }
      case 'record_preference_signal': {
        const input = parse(recordPreferenceSignalCommandSchema, value);
        return this.reuse.recordPreferenceSignal(args.context, input);
      }
      case 'propose_preference': {
        const input = parse(proposePreferenceCommandSchema, value);
        return this.reuse.proposePreference({
          ...input,
          workspaceId: args.context.workspaceId,
          status: 'pending',
          proposedAt: this.now(),
        });
      }
      case 'confirm_preference': {
        const input = parse(confirmPreferenceCommandSchema, value);
        return this.reuse.confirmPreference(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'revoke_preference': {
        const input = parse(revokePreferenceCommandSchema, value);
        return this.reuse.revokePreference(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown asset-memory command ${name}.`,
        );
    }
  }

  async query(args: { context: P1Context; input: Record<string, unknown> }) {
    const name = action(args.input);
    const value = payload(args.input);
    switch (name) {
      case 'parse_task_view': {
        const input = parse(parseTaskViewQuerySchema, value);
        return this.requireParsing().task(
          args.context.workspaceId,
          input.taskId,
        );
      }
      case 'asset_draft_view': {
        const input = parse(assetDraftViewQuerySchema, value);
        return this.requireParsing().draft(
          args.context.workspaceId,
          input.draftId,
          input.revision,
        );
      }
      case 'asset_intake_experience': {
        const input = parse(assetIntakeExperienceQuerySchema, value);
        return this.requireParsing().experience(input);
      }
      case 'asset_intake_view': {
        const input = parse(assetIntakeViewQuerySchema, value);
        return this.intake.view(args.context.workspaceId, input.batchId);
      }
      case 'asset_intake_missing_fact_keys': {
        const input = parse(assetIntakeMissingFactKeysQuerySchema, value);
        const bundle = await this.bundles.get(
          args.context.workspaceId,
          input.bundleId,
          input.bundleRevision,
        );
        if (!bundle) {
          throw new P1DomainError('NOT_FOUND', 'ContextBundle was not found.');
        }
        return {
          bundleId: bundle.bundleId,
          bundleRevision: bundle.revision,
          missingKeys: this.intake.missingFactKeys({
            bundle,
            requiredKeys: input.requiredKeys,
          }),
        };
      }
      case 'reusable_asset_view': {
        const input = parse(reusableAssetViewQuerySchema, value);
        return this.reuse.assetView(args.context.workspaceId, input.assetId);
      }
      case 'reuse_task_seed': {
        const input = parse(reusableAssetRevisionQuerySchema, value);
        return this.reuse.createReuseTaskSeed(
          args.context.workspaceId,
          input.assetId,
          input.revision,
        );
      }
      case 'series_suggestions':
        parse(seriesSuggestionsQuerySchema, value);
        return this.reuse.listAutomaticSeriesSuggestions(
          args.context.workspaceId,
        );
      case 'preference_view':
        parse(preferenceViewQuerySchema, value);
        return this.reuse.preferenceView(args.context.workspaceId);
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown asset-memory query ${name}.`,
        );
    }
  }

  private requireParsing() {
    if (!this.parsing) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The asset parsing service is unavailable.',
      );
    }
    return this.parsing;
  }
}
