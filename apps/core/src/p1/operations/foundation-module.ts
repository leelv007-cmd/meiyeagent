import {
  adoptCanvasWorkExportCommandSchema,
  adoptHarnessCandidateCommandSchema,
  adoptIntoContentPackageCommandSchema,
  approveContentPackageActionCommandSchema,
  attachContentPackageGenerationCommandSchema,
  cancelContentPackageCommandSchema,
  contentPackageQuerySchema,
  contentPackageMigrationCommandSchema,
  contentPackageMigrationQuerySchema,
  contentPackagesQuerySchema,
  creativeOperationSchema,
  createContentPackageCommandSchema,
  editContentPackageVariantCommandSchema,
  editContentPackageVersionCommandSchema,
  deliverContentPackageCommandSchema,
  exportContentPackageCommandSchema,
  generateContentPackageVariantsCommandSchema,
  revokeContentPackageRightsCommandSchema,
  recordContentPackageManualResultCommandSchema,
  recordContentPackageResultReviewActionCommandSchema,
  recordContentPackageResultSignalCommandSchema,
  reuseContentPackageCommandSchema,
  rollbackContentPackageVersionCommandSchema,
  toPublicContentPackage,
  type ContentPackage,
  type PublicContentPackage,
} from '@meiye/contracts';
import type { P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  type OperationsApplicationService,
  OperationsError,
} from './application-service.js';
import type {
  BuiltInTriggerKind,
  CanvasDocument,
  ContentTaskStatus,
  CreateTaskInput,
  CreativeBriefFieldId,
  CreativeContentModuleId,
  CreativeExecutionContract,
  CreativeInheritanceFieldId,
  CreativeOperation,
  CreativeSourceReference,
  ExportRequest,
  ImageModelId,
  OperationContext,
  SearchQuery,
  TemplateShortcut,
  WeeklyFact,
} from './types.js';
import type { ContentPackageDeliveryService } from './content-package-delivery.js';

const CREATIVE_OPERATIONS = new Set<CreativeOperation>(
  creativeOperationSchema.options
);
const CREATIVE_CONTENT_MODULES = new Set<CreativeContentModuleId>([
  'social_cover',
  'before_after',
  'price_card',
  'package_explainer',
  'review_card',
  'store_intro',
  'shooting_checklist',
]);
const CREATIVE_BRIEF_FIELDS = new Set<CreativeBriefFieldId>([
  'intent',
  'scene',
  'tone',
  'audience',
]);
const CREATIVE_INHERITANCE_FIELDS = new Set<CreativeInheritanceFieldId>([
  'content_structure',
  'layout_slots',
  'copy_skeleton',
  'output_specification',
  'visual_style',
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('P1 operation input must be an object.');
  }
  return value as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function optionalString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function stringList(value: unknown, key: string) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error(`${key} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function imageDataClass(
  value: unknown
): Array<'contains_face' | 'pii' | 'medical'> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new OperationsError(
      'INVALID_DATA_CLASS',
      'dataClass must be an array.'
    );
  }
  const supported = new Set(['contains_face', 'pii', 'medical']);
  const normalized = [...new Set(value)];
  if (
    normalized.some((item) => typeof item !== 'string' || !supported.has(item))
  ) {
    throw new OperationsError(
      'INVALID_DATA_CLASS',
      'dataClass contains an unsupported value.'
    );
  }
  return normalized.sort() as Array<'contains_face' | 'pii' | 'medical'>;
}

function requiredNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OperationsError('INVALID_INPUT', `${key} must be a number.`);
  }
  return value;
}

function requiredPositiveInteger(
  input: Record<string, unknown>,
  key: string
) {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new OperationsError(
      'INVALID_INPUT',
      `${key} must be a positive integer.`
    );
  }
  return value;
}

function creativeOperation(value: unknown): CreativeOperation {
  if (
    typeof value !== 'string' ||
    !CREATIVE_OPERATIONS.has(value as CreativeOperation)
  ) {
    throw new OperationsError(
      'INVALID_CREATIVE_OPERATION',
      'A supported creative operation is required.'
    );
  }
  return value as CreativeOperation;
}

function creativeContentModules(
  value: unknown
): CreativeContentModuleId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new OperationsError(
      'INVALID_CONTENT_MODULES',
      'contentModules must be an array.'
    );
  }
  const modules = [...new Set(value)];
  if (
    modules.length === 0 ||
    modules.length !== value.length ||
    modules.some(
      (moduleId) =>
        typeof moduleId !== 'string' ||
        !CREATIVE_CONTENT_MODULES.has(moduleId as CreativeContentModuleId)
    )
  ) {
    throw new OperationsError(
      'INVALID_CONTENT_MODULES',
      'At least one unique supported content module is required.'
    );
  }
  return modules as CreativeContentModuleId[];
}

function creativeBriefField(value: unknown): CreativeBriefFieldId {
  if (
    typeof value !== 'string' ||
    !CREATIVE_BRIEF_FIELDS.has(value as CreativeBriefFieldId)
  ) {
    throw new OperationsError(
      'INVALID_CREATIVE_BRIEF_FIELD',
      'A supported Creative Brief field is required.'
    );
  }
  return value as CreativeBriefFieldId;
}

function creativeBriefDrafts(
  value: unknown
): Partial<Record<'scene' | 'tone' | 'audience', string>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationsError(
      'INVALID_CREATIVE_BRIEF_FIELD',
      'briefDrafts must be an object.'
    );
  }
  const input = value as Record<string, unknown>;
  const drafts: Partial<Record<'scene' | 'tone' | 'audience', string>> = {};
  for (const field of ['scene', 'tone', 'audience'] as const) {
    const draft = input[field];
    if (draft === undefined) continue;
    if (typeof draft !== 'string' || draft.trim().length === 0) {
      throw new OperationsError(
        'INVALID_CREATIVE_BRIEF_FIELD',
        `briefDrafts.${field} must be a non-empty string.`
      );
    }
    drafts[field] = draft;
  }
  return Object.keys(drafts).length > 0 ? drafts : undefined;
}

function creativeInheritanceFields(
  value: unknown
): CreativeInheritanceFieldId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new OperationsError(
      'INVALID_INHERITANCE_FIELDS',
      'inheritanceFields must be an array.'
    );
  }
  const fields = [...new Set(value)];
  if (
    fields.length === 0 ||
    fields.length !== value.length ||
    fields.some(
      (field) =>
        typeof field !== 'string' ||
        !CREATIVE_INHERITANCE_FIELDS.has(field as CreativeInheritanceFieldId)
    )
  ) {
    throw new OperationsError(
      'INVALID_INHERITANCE_FIELDS',
      'Inherited source fields must be unique supported structure fields.'
    );
  }
  return fields as CreativeInheritanceFieldId[];
}

function creativeSourceReferences(value: unknown): CreativeSourceReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new OperationsError(
      'INVALID_SOURCE_REFERENCE',
      'sourceReferences must be an array.'
    );
  }
  return value.map((candidate) => {
    const reference = object(candidate);
    const inheritanceFields = creativeInheritanceFields(
      reference.inheritanceFields
    );
    return {
      id: requiredString(reference, 'id'),
      ...(inheritanceFields ? { inheritanceFields } : {}),
      kind: requiredString(
        reference,
        'kind'
      ) as CreativeSourceReference['kind'],
    };
  });
}

function creativeContract(value: unknown): CreativeExecutionContract {
  const input = object(value);
  const aspectRatio = input.aspectRatio;
  const contentModules = creativeContentModules(input.contentModules);
  if (
    aspectRatio !== undefined &&
    aspectRatio !== '1:1' &&
    aspectRatio !== '3:4' &&
    aspectRatio !== '9:16'
  ) {
    throw new OperationsError(
      'INVALID_ASPECT_RATIO',
      'aspectRatio must be 1:1, 3:4, or 9:16.'
    );
  }
  return {
    aigcLabelEnabled: input.aigcLabelEnabled === true,
    ...(aspectRatio ? { aspectRatio } : {}),
    catalogModelId: requiredString(input, 'catalogModelId'),
    catalogRevision: requiredString(input, 'catalogRevision'),
    currency: requiredString(input, 'currency'),
    ...(contentModules ? { contentModules } : {}),
    dataClass: imageDataClass(input.dataClass),
    ...(typeof input.durationSeconds === 'number'
      ? { durationSeconds: input.durationSeconds }
      : {}),
    estimatedAmount: requiredNumber(input, 'estimatedAmount'),
    operation: creativeOperation(input.operation),
    outputCount: requiredNumber(input, 'outputCount'),
    outputLabel: requiredString(input, 'outputLabel'),
    quoteAcceptedAt: requiredString(input, 'quoteAcceptedAt'),
    quoteRevision: requiredString(input, 'quoteRevision'),
    watermarkEnabled: input.watermarkEnabled === true,
  };
}

function operationContext(context: P1Context): OperationContext {
  const actor = context.actor ?? 'owner';
  // payment is a P1-only settlement actor (entitlements.payment_grant); never operations.
  if (actor === 'payment') {
    throw new OperationsError(
      'FORBIDDEN',
      'The payment actor cannot perform operations actions.',
      403
    );
  }
  return {
    actor,
    correlationId: context.correlationId,
    userId: context.userId,
    workspaceId: context.workspaceId,
  };
}

function merchantContentPackage(
  contentPackage: ContentPackage,
): PublicContentPackage {
  return toPublicContentPackage(contentPackage);
}

function rolloutPercent(input: Record<string, unknown>, fallback?: number) {
  const value = input.rolloutPercent ?? fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new OperationsError(
      'INVALID_ROLLOUT_PERCENT',
      'rolloutPercent must be an integer between 0 and 100.'
    );
  }
  return value;
}

const ADMIN_COMMANDS = new Set([
  'admin_create_template',
  'admin_create_template_version',
  'admin_enable_template_version',
  'admin_preview_template_version',
  'admin_publish_template_version',
  'admin_retire_template',
  'record_weekly_fact',
  'content_package_migration_activate',
  'content_package_migration_backfill',
  'content_package_migration_dry_run',
  'content_package_migration_freeze',
  'content_package_migration_inspect',
  'content_package_migration_rollback',
  'repair_media_custody',
]);

const ADMIN_QUERIES = new Set([
  'admin_template_catalog',
  'content_package_migration_report',
  'content_package_migration_status',
]);

/**
 * Registers operations behind the highest Product Core seam. The module owns
 * no state; every action delegates to OperationsApplicationService.
 */
export class OperationsFoundationModule implements P1OperationModule {
  readonly name = 'operations';
  private readonly adminActorIds: Set<string>;

  constructor(
    private readonly operations: OperationsApplicationService,
    private readonly options: {
      adminActorIds?: readonly string[];
      delivery?: ContentPackageDeliveryService;
    } = {}
  ) {
    this.adminActorIds = new Set(options.adminActorIds ?? []);
  }

  private adminContext(context: P1Context) {
    if (context.actor !== 'admin' && !this.adminActorIds.has(context.userId)) {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    return { ...context, actor: 'admin' as const };
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<unknown> {
    if (args.idempotencyKey) {
      return this.operations.executeIdempotentModuleCommand(
        operationContext(args.context),
        args.idempotencyKey,
        args.input,
        () => this.execute({ ...args, idempotencyKey: undefined })
      );
    }
    const action = requiredString(args.input, 'action');
    const context = ADMIN_COMMANDS.has(action)
      ? this.adminContext(args.context)
      : operationContext(args.context);
    const payload = object(args.input.payload ?? {});
    const migrationPayload = () => {
      const parsed = contentPackageMigrationCommandSchema.safeParse(payload);
      if (!parsed.success) {
        throw new OperationsError(
          'INVALID_CONTENT_PACKAGE_MIGRATION',
          parsed.error.message
        );
      }
      return parsed.data;
    };

    switch (action) {
      case 'adopt_harness_candidate': {
        const parsed = adoptHarnessCandidateCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_HARNESS_CANDIDATE_ADOPTION',
            parsed.error.message,
          );
        }
        return merchantContentPackage(
          await this.operations.adoptHarnessCandidate(context, parsed.data),
        );
      }
      case 'adopt_canvas_work_export': {
        const parsed = adoptCanvasWorkExportCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CANVAS_EXPORT_ADOPTION',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.adoptCanvasWorkExport(context, parsed.data)
        );
      }
      case 'content_package_migration_activate':
        return this.operations.activateContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_backfill':
        return this.operations.backfillContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_dry_run':
        return this.operations.dryRunContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_freeze':
        return this.operations.freezeContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_inspect':
        return this.operations.inspectContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_rollback':
        return this.operations.rollbackContentPackageMigration(
          context,
          migrationPayload().runId
        );
      case 'repair_media_custody':
        return this.operations.repairMediaCustody(context, {
          packageId: requiredString(payload, 'packageId'),
          versionId: requiredString(payload, 'versionId'),
        });
      case 'adopt_into_content_package': {
        const parsed = adoptIntoContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.adoptIntoContentPackage(context, parsed.data)
        );
      }
      case 'attach_content_package_generation': {
        const parsed =
          attachContentPackageGenerationCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.attachContentPackageGeneration(
            context,
            parsed.data
          )
        );
      }
      case 'cancel_content_package': {
        const parsed = cancelContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.cancelContentPackage(context, parsed.data)
        );
      }
      case 'create_content_package': {
        const parsed = createContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.createContentPackage(context, parsed.data)
        );
      }
      case 'edit_content_package_version': {
        const parsed =
          editContentPackageVersionCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.editContentPackageVersion(context, parsed.data)
        );
      }
      case 'edit_content_package_variant': {
        const parsed =
          editContentPackageVariantCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.editContentPackageVariant(context, parsed.data)
        );
      }
      case 'generate_content_package_variants': {
        const parsed =
          generateContentPackageVariantsCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.generateContentPackageVariants(
            context,
            parsed.data
          )
        );
      }
      case 'export_content_package': {
        const parsed = exportContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.exportContentPackage(context, parsed.data)
        );
      }
      case 'approve_content_package_action': {
        const parsed = approveContentPackageActionCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        const { approvalKey, ...input } = parsed.data;
        return this.options.delivery.approve(context, {
          ...input,
          idempotencyKey: approvalKey,
        });
      }
      case 'deliver_content_package': {
        const parsed = deliverContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return merchantContentPackage(
          await this.options.delivery.deliver(context, parsed.data)
        );
      }
      case 'record_content_package_manual_result': {
        const parsed = recordContentPackageManualResultCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return merchantContentPackage(
          await this.options.delivery.recordManualResult(context, parsed.data)
        );
      }
      case 'record_content_package_result_signal': {
        const parsed = recordContentPackageResultSignalCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return merchantContentPackage(
          await this.options.delivery.recordResultSignal(context, parsed.data)
        );
      }
      case 'record_content_package_result_review_action': {
        const parsed =
          recordContentPackageResultReviewActionCommandSchema.safeParse(
            payload
          );
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success
              ? 'ContentPackage delivery is unavailable.'
              : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return merchantContentPackage(
          await this.options.delivery.recordResultReviewAction(
            context,
            parsed.data
          )
        );
      }
      case 'revoke_content_package_rights': {
        const parsed =
          revokeContentPackageRightsCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.revokeContentPackageRights(context, parsed.data)
        );
      }
      case 'reuse_content_package': {
        const parsed = reuseContentPackageCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.reuseContentPackage(context, parsed.data)
        );
      }
      case 'rollback_content_package_version': {
        const parsed =
          rollbackContentPackageVersionCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.rollbackContentPackageVersion(
            context,
            parsed.data
          )
        );
      }
      case 'record_onboarding_skip':
        return this.operations.recordOnboardingSkip(context);
      case 'create_creative_work': {
        const contentModules = creativeContentModules(payload.contentModules);
        const briefDrafts = creativeBriefDrafts(payload.briefDrafts);
        return this.operations.createCreativeWork(context, {
          ...(contentModules ? { contentModules } : {}),
          intent: requiredString(payload, 'intent'),
          mode:
            payload.mode === 'direct'
              ? ('direct' as const)
              : ('agent' as const),
          ...(payload.operation === undefined
            ? {}
            : { operation: creativeOperation(payload.operation) }),
          sessionId: requiredString(payload, 'sessionId'),
          ...(payload.briefContextId === undefined
            ? {}
            : { briefContextId: requiredString(payload, 'briefContextId') }),
          ...(payload.briefConfirmationId === undefined
            ? {}
            : {
                briefConfirmationId: requiredString(
                  payload,
                  'briefConfirmationId',
                ),
              }),
          sourceReferences: creativeSourceReferences(payload.sourceReferences),
          ...(payload.autoConfirmBrief === undefined
            ? {}
            : { autoConfirmBrief: payload.autoConfirmBrief === true }),
          ...(briefDrafts ? { briefDrafts } : {}),
        });
      }
      case 'update_creative_work_draft':
        return this.operations.updateCreativeWorkDraft(
          context,
          requiredString(payload, 'workId'),
          {
            contentModules:
              creativeContentModules(payload.contentModules) ?? [],
          }
        );
      case 'update_creative_work_brief': {
        const action = requiredString(payload, 'action');
        const field = creativeBriefField(payload.field);
        if (action === 'adopt') {
          return this.operations.updateCreativeWorkBrief(
            context,
            requiredString(payload, 'workId'),
            {
              action,
              aiDraft: requiredString(payload, 'aiDraft'),
              field,
            }
          );
        }
        if (action === 'edit') {
          return this.operations.updateCreativeWorkBrief(
            context,
            requiredString(payload, 'workId'),
            {
              action,
              current: requiredString(payload, 'current'),
              field,
            }
          );
        }
        if (action === 'revert') {
          return this.operations.updateCreativeWorkBrief(
            context,
            requiredString(payload, 'workId'),
            { action, field }
          );
        }
        throw new OperationsError(
          'INVALID_CREATIVE_BRIEF_ACTION',
          'Creative Brief action must be adopt, edit or revert.'
        );
      }
      case 'confirm_creative_work_brief':
        return this.operations.confirmCreativeWorkBrief(
          context,
          requiredString(payload, 'workId')
        );
      case 'derive_creative_work': {
        const contentModules = creativeContentModules(payload.contentModules);
        const briefDrafts = creativeBriefDrafts(payload.briefDrafts);
        return this.operations.deriveCreativeWork(
          context,
          requiredString(payload, 'sourceWorkId'),
          {
            ...(contentModules ? { contentModules } : {}),
            intent: requiredString(payload, 'intent'),
            sessionId: requiredString(payload, 'sessionId'),
            sourceReferences: creativeSourceReferences(
              payload.sourceReferences
            ),
            ...(payload.autoConfirmBrief === undefined
              ? {}
              : { autoConfirmBrief: payload.autoConfirmBrief === true }),
            ...(briefDrafts ? { briefDrafts } : {}),
          }
        );
      }
      case 'submit_creative_work':
        return this.operations.submitCreativeWork(
          context,
          requiredString(payload, 'workId'),
          creativeContract(payload.contract),
          requiredString(payload, 'submissionKey'),
          undefined,
          optionalString(payload.approvalReceiptId),
          optionalString(payload.briefContextId),
          optionalString(payload.briefConfirmationId),
          optionalString(payload.billingQuoteId),
        );
      case 'approve_creative_generation':
        return this.operations.approveCreativeGeneration(context, {
          approvalKey: requiredString(payload, 'approvalKey'),
          contract: creativeContract(payload.contract),
          workId: requiredString(payload, 'workId'),
        });
      case 'resume_creative_job':
        return this.operations.resumeCreativeJob(
          context,
          requiredString(payload, 'jobId')
        );
      case 'cancel_creative_job':
        return this.operations.cancelCreativeJob(
          context,
          requiredString(payload, 'jobId')
        );
      case 'save_creative_work_selection_draft':
        return this.operations.saveCreativeWorkSelectionDraft(context, {
          workId: requiredString(payload, 'workId'),
          baseRevisionId: requiredString(payload, 'baseRevisionId'),
          orderedAssetIds: stringList(
            payload.orderedAssetIds,
            'orderedAssetIds',
          ),
          coverAssetId: optionalString(payload.coverAssetId) ?? null,
          surfaceVersion: requiredString(payload, 'surfaceVersion'),
        });
      case 'save_creative_assets_to_library':
        return this.operations.saveCreativeAssetsToLibrary(context, {
          workId: requiredString(payload, 'workId'),
          assetIds: stringList(payload.assetIds, 'assetIds'),
        });
      case 'retry_creative_job':
        return this.operations.retryCreativeJob(
          context,
          requiredString(payload, 'jobId'),
          requiredString(payload, 'submissionKey')
        );
      case 'reroll_creative_job':
        return this.operations.rerollCreativeJob(
          context,
          requiredString(payload, 'jobId'),
          requiredString(payload, 'submissionKey'),
          requiredString(payload, 'quoteId'),
        );
      case 'quality_retry_creative_job':
        return this.operations.qualityRetryCreativeJob(
          context,
          requiredString(payload, 'jobId'),
          requiredString(payload, 'submissionKey')
        );
      case 'create_task':
        return this.operations.createTask(
          context,
          payload as unknown as CreateTaskInput
        );
      case 'transition_task':
        return this.operations.transitionTask(
          context,
          requiredString(payload, 'taskId'),
          requiredString(payload, 'status') as ContentTaskStatus,
          typeof payload.reason === 'string' ? payload.reason : undefined
        );
      case 'configure_trigger':
        return this.operations.configureTrigger(
          context,
          requiredString(payload, 'kind') as BuiltInTriggerKind,
          payload.enabled === true
        );
      case 'run_trigger':
        return this.operations.runTrigger(context, {
          kind: requiredString(payload, 'kind') as BuiltInTriggerKind,
          sourceId: requiredString(payload, 'sourceId'),
          timeWindow: requiredString(payload, 'timeWindow'),
        });
      case 'retry_task_notification':
        return this.operations.retryTaskNotification(
          context,
          requiredString(payload, 'taskId')
        );
      case 'execute_weekly_batch':
        return this.operations.executeWeeklyBatch(context, {
          action: requiredString(payload, 'batchAction') as
            | 'create'
            | 'revise'
            | 'apply_template'
            | 'prepare_draft',
          taskIds: Array.isArray(payload.taskIds)
            ? payload.taskIds.filter(
                (value): value is string => typeof value === 'string'
              )
            : [],
        });
      case 'record_weekly_fact':
        return this.operations.recordWeeklyFact(
          context,
          payload as unknown as Pick<
            WeeklyFact,
            'kind' | 'occurredAt' | 'sourceId'
          >
        );
      case 'create_weekly_review':
        return this.operations.createWeeklyReview(context, {
          from: requiredString(payload, 'from'),
          to: requiredString(payload, 'to'),
        });
      case 'confirm_weekly_candidates':
        return this.operations.confirmNextWeekCandidates(
          context,
          requiredString(payload, 'reviewId'),
          Array.isArray(payload.candidateIds)
            ? payload.candidateIds.filter(
                (value): value is string => typeof value === 'string'
              )
            : []
        );
      case 'dismiss_weekly_candidate':
        return this.operations.dismissNextWeekCandidate(
          context,
          requiredString(payload, 'reviewId'),
          requiredString(payload, 'candidateId')
        );
      case 'create_work':
        return this.operations.createWork(context, {
          name: optionalString(payload.name),
          templateId: requiredString(payload, 'templateId'),
        });
      case 'copy_template_version_to_work':
        return this.operations.copyTemplateVersionToWork(context, {
          name: optionalString(payload.name),
          sourceWorkId:
            typeof payload.sourceWorkId === 'string'
              ? payload.sourceWorkId
              : undefined,
          templateId: requiredString(payload, 'templateId'),
          templateVersionId: requiredString(payload, 'templateVersionId'),
        });
      case 'preview_template_version':
        return this.operations.previewTemplateVersion(
          context,
          requiredString(payload, 'templateId'),
          requiredString(payload, 'versionId')
        );
      case 'create_blank_work':
        return this.operations.createBlankWork(context, {
          height: Number(payload.height),
          name: optionalString(payload.name),
          width: Number(payload.width),
        });
      case 'create_work_from_content_package':
        return this.operations.createWorkFromContentPackage(context, {
          height: requiredPositiveInteger(payload, 'height'),
          sourcePackageId: requiredString(payload, 'sourcePackageId'),
          sourceVersionId: requiredString(payload, 'sourceVersionId'),
          width: requiredPositiveInteger(payload, 'width'),
        });
      case 'create_work_from_user_template':
        return this.operations.createWorkFromUserTemplate(context, {
          name: optionalString(payload.name),
          userTemplateId: requiredString(payload, 'userTemplateId'),
        });
      case 'save_canvas_revision':
        return this.operations.saveCanvasRevision(
          context,
          requiredString(payload, 'workId'),
          object(payload.document) as unknown as CanvasDocument,
          typeof payload.sourceRevisionId === 'string'
            ? payload.sourceRevisionId
            : undefined
        );
      case 'upgrade_work_template':
        return this.operations.upgradeWorkTemplate(
          context,
          requiredString(payload, 'workId'),
          requiredString(payload, 'templateVersionId')
        );
      case 'set_creation_labels':
        return this.operations.setCreationLabels(
          context,
          requiredString(payload, 'workId'),
          {
            aigcLabelEnabled: payload.aigcLabelEnabled === true,
            brandWatermarkEnabled: payload.brandWatermarkEnabled === true,
          }
        );
      case 'save_user_template':
        return this.operations.saveUserTemplate(context, {
          ...(payload.document
            ? {
                document: object(payload.document) as unknown as CanvasDocument,
              }
            : {}),
          name: optionalString(payload.name),
          sourceRevisionId:
            typeof payload.sourceRevisionId === 'string'
              ? payload.sourceRevisionId
              : undefined,
          workId: requiredString(payload, 'workId'),
        });
      case 'rename_user_template':
        return this.operations.renameUserTemplate(
          context,
          requiredString(payload, 'userTemplateId'),
          requiredString(payload, 'name')
        );
      case 'copy_user_template':
        return this.operations.copyUserTemplate(
          context,
          requiredString(payload, 'userTemplateId'),
          optionalString(payload.name)
        );
      case 'delete_user_template':
        return this.operations.deleteUserTemplate(
          context,
          requiredString(payload, 'userTemplateId')
        );
      case 'set_template_shortcuts':
        return this.operations.setTemplateShortcuts(
          context,
          (Array.isArray(payload.shortcuts)
            ? payload.shortcuts
            : []) as TemplateShortcut[]
        );
      case 'export_work':
        return this.operations.exportWork(
          context,
          requiredString(payload, 'workId'),
          object(payload.request) as unknown as ExportRequest
        );
      case 'start_canvas_image':
        return this.operations.startCanvasImageGeneration(context, {
          dataClass: imageDataClass(payload.dataClass),
          inputAssetId:
            typeof payload.inputAssetId === 'string'
              ? payload.inputAssetId
              : undefined,
          modelId: requiredString(payload, 'modelId') as ImageModelId,
          operation:
            payload.operation === 'edit'
              ? ('edit' as const)
              : ('generate' as const),
          prompt: requiredString(payload, 'prompt'),
          workId: requiredString(payload, 'workId'),
        });
      case 'complete_canvas_image':
        return this.operations.completeCanvasImageGeneration(
          context,
          requiredString(payload, 'jobId'),
          {
            assetId: requiredString(payload, 'assetId'),
            insertIntoCanvas: payload.insertIntoCanvas === true,
            src: typeof payload.src === 'string' ? payload.src : undefined,
          }
        );
      case 'cancel_canvas_image':
        return this.operations.cancelCanvasImageGeneration(
          context,
          requiredString(payload, 'jobId')
        );
      case 'index_search_document': {
        const document = object(payload.document);
        return this.operations.indexSearchDocument(
          context,
          document as unknown as Parameters<
            OperationsApplicationService['indexSearchDocument']
          >[1]
        );
      }
      case 'retrieval_evaluation':
        return this.operations.evaluateRetrieval(
          context,
          payload as unknown as Parameters<
            OperationsApplicationService['evaluateRetrieval']
          >[1]
        );
      case 'admin_create_template_version':
        return this.operations.createTemplateVersion(context, {
          document: object(payload.document) as unknown as CanvasDocument,
          rolloutPercent: rolloutPercent(payload, 0),
          templateId: requiredString(payload, 'templateId'),
        });
      case 'admin_create_template':
        return this.operations.createOfficialTemplate(context, {
          ...(payload.document
            ? {
                document: object(payload.document) as unknown as CanvasDocument,
              }
            : {}),
          family: requiredString(payload, 'family'),
          name: requiredString(payload, 'name'),
          tags: Array.isArray(payload.tags)
            ? payload.tags.filter(
                (tag): tag is string => typeof tag === 'string'
              )
            : [],
        });
      case 'admin_enable_template_version':
        return this.operations.enableTemplateVersion(
          context,
          requiredString(payload, 'templateId'),
          requiredString(payload, 'versionId'),
          rolloutPercent(payload, 0)
        );
      case 'admin_preview_template_version':
        return this.operations.previewTemplateVersion(
          context,
          requiredString(payload, 'templateId'),
          requiredString(payload, 'versionId')
        );
      case 'admin_publish_template_version':
        return this.operations.publishTemplateVersion(
          context,
          requiredString(payload, 'templateId'),
          requiredString(payload, 'versionId'),
          rolloutPercent(payload, 100),
          typeof payload.reason === 'string'
            ? payload.reason
            : 'legacy-admin-action'
        );
      case 'admin_retire_template':
        return this.operations.retireTemplate(
          context,
          requiredString(payload, 'templateId'),
          typeof payload.reason === 'string'
            ? payload.reason
            : 'legacy-admin-action'
        );
      default:
        throw new Error(`Unknown operations command ${action}.`);
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = requiredString(args.input, 'action');
    const context = ADMIN_QUERIES.has(action)
      ? this.adminContext(args.context)
      : operationContext(args.context);
    const payload = object(args.input.payload ?? {});
    const migrationPayload = () => {
      const parsed = contentPackageMigrationQuerySchema.safeParse(payload);
      if (!parsed.success) {
        throw new OperationsError(
          'INVALID_CONTENT_PACKAGE_MIGRATION_QUERY',
          parsed.error.message
        );
      }
      return parsed.data;
    };

    switch (action) {
      case 'content_package_migration_report':
        return this.operations.getContentPackageMigrationReport(
          context,
          migrationPayload().runId
        );
      case 'content_package_migration_status':
        return this.operations.getContentPackageMigrationStatus(
          context,
          migrationPayload().runId
        );
      case 'creative_workbench':
        return this.operations.getCreativeWorkbench(context);
      case 'canonical_history':
        return this.operations.getCanonicalHistory(context, {
          ...(typeof payload.limit === 'number'
            ? { limit: payload.limit }
            : {}),
          ...(typeof payload.offset === 'number'
            ? { offset: payload.offset }
            : {}),
        });
      case 'content_package': {
        const parsed = contentPackageQuerySchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE_QUERY',
            parsed.error.message
          );
        }
        return merchantContentPackage(
          await this.operations.getContentPackage(
            context,
            parsed.data.packageId
          )
        );
      }
      case 'content_package_delivery_timeline': {
        const parsed = contentPackageQuerySchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return this.options.delivery.timeline(context, parsed.data.packageId);
      }
      case 'content_package_results': {
        const parsed = contentPackageQuerySchema.safeParse(payload);
        if (!parsed.success || !this.options.delivery) {
          throw new OperationsError(
            'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            parsed.success ? 'ContentPackage delivery is unavailable.' : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        return this.options.delivery.results(context, parsed.data.packageId);
      }
      case 'content_packages': {
        const parsed = contentPackagesQuerySchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE_QUERY',
            parsed.error.message
          );
        }
        return (await this.operations.listContentPackages(context)).map(
          merchantContentPackage
        );
      }
      case 'canvas_export_asset': {
        if (
          Object.keys(payload).length !== 1 ||
          typeof payload.assetId !== 'string' ||
          !payload.assetId.trim()
        ) {
          throw new OperationsError(
            'INVALID_CANVAS_EXPORT_ASSET_QUERY',
            'Canvas export asset query requires only a non-empty assetId.',
            400
          );
        }
        return this.operations.resolveCanvasExportAsset(
          context,
          payload.assetId
        );
      }
      case 'templates':
        return this.operations.listTemplates(context, payload);
      case 'creation_catalog':
        return this.operations.getCreationCatalog(context);
      case 'work':
        return this.operations.getWork(
          context,
          requiredString(payload, 'workId')
        );
      case 'export_receipts':
        return this.operations.listExportReceipts(
          context,
          typeof payload.workId === 'string' ? payload.workId : undefined
        );
      case 'canvas_image_job':
        return this.operations.getCanvasImageJob(
          context,
          requiredString(payload, 'jobId')
        );
      case 'search':
        return this.operations.search(
          context,
          payload as unknown as SearchQuery
        );
      case 'admin_template_catalog':
        return this.operations.getTemplateCatalogHistory(
          context,
          typeof payload.templateId === 'string'
            ? payload.templateId
            : undefined
        );
      default:
        throw new Error(`Unknown operations query ${action}.`);
    }
  }
}
