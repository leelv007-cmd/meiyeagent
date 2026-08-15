import {
  assetIntakeExperienceQuerySchema,
  assetParseTaskDraftsQuerySchema,
  assetParseTaskQuerySchema,
  confirmAssetIntakeFactCommandSchema,
  extractStoreSentenceCommandSchema,
  extractStoreSentenceResultSchema,
  finalizeStoreIntakeCommandSchema,
  parseAssetBatchInputSchema,
  parseSingleAssetCommandSchema,
  prepareManualAssetDraftCommandSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { AssetIntakeService } from './asset-intake-service.js';
import type { ParseService } from './parse-service.js';
import type { StoreIntakeFinalizer } from './store-intake-finalizer.js';
import {
  emptyStoreSentenceExtract,
  type StoreSentenceExtractPort,
} from './store-sentence-extract.js';
import type { StoreProfileImportPreparer } from './store-profile-import.js';

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
    private readonly parsing?: ParseService,
    private readonly storeIntake?: StoreIntakeFinalizer,
    private readonly storeProfileImport?: StoreProfileImportPreparer,
    private readonly sentenceExtract?: StoreSentenceExtractPort,
  ) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<unknown> {
    const name = action(args.input);
    const value = payload(args.input);
    switch (name) {
      case 'parse_single_asset':
        return this.requireParsing().parseSingle(
          args.context,
          parse(parseSingleAssetCommandSchema, value),
        );
      case 'start_parse_asset_batch':
        return this.requireParsing().startBatch(
          args.context,
          parse(parseAssetBatchInputSchema, value),
        );
      case 'prepare_manual_asset_draft':
        return this.requireParsing().prepareManualDraft(
          args.context,
          parse(prepareManualAssetDraftCommandSchema, value),
        );
      case 'confirm_asset_intake_fact': {
        const input = parse(confirmAssetIntakeFactCommandSchema, value);
        return this.intake.confirmFact(args.context, {
          ...input,
          idempotencyKey: args.idempotencyKey,
        });
      }
      case 'finalize_store_intake': {
        if (!this.storeIntake) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Store intake finalization is unavailable.',
          );
        }
        return this.storeIntake.finalize(
          args.context,
          parse(finalizeStoreIntakeCommandSchema, value),
          args.idempotencyKey,
        );
      }
      case 'extract_store_sentence': {
        const input = parse(extractStoreSentenceCommandSchema, value);
        const outcome = this.sentenceExtract
          ? await this.sentenceExtract.extract({
              workspaceId: args.context.workspaceId,
              actorId: args.context.userId,
              effectIdempotencyKey: args.idempotencyKey,
              sentence: input.sentence,
            })
          : emptyStoreSentenceExtract();
        return extractStoreSentenceResultSchema.parse(outcome);
      }
      case 'prepare_store_profile_import': {
        if (!this.storeProfileImport) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Store profile import is unavailable.',
          );
        }
        // Every identity in the staged batch is derived server-side from the
        // stored profile, so the command carries no payload the browser could
        // use to forge a candidate.
        return this.storeProfileImport.prepare(args.context);
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown asset-memory command ${name}.`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const name = action(args.input);
    const value = payload(args.input);
    switch (name) {
      case 'asset_intake_experience': {
        const input = parse(assetIntakeExperienceQuerySchema, value);
        return this.requireParsing().experience(input);
      }
      case 'asset_parse_task': {
        const input = parse(assetParseTaskQuerySchema, value);
        return this.requireParsing().task(
          args.context.workspaceId,
          input.taskId,
        );
      }
      case 'asset_parse_task_drafts': {
        const input = parse(assetParseTaskDraftsQuerySchema, value);
        return this.requireParsing().draftsForTask(
          args.context.workspaceId,
          input.taskId,
        );
      }
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
