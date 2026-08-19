import {
  adoptCanvasWorkExportCommandSchema,
  adoptHarnessCandidateCommandSchema,
  adoptIntoContentPackageCommandSchema,
  approveContentPackageActionCommandSchema,
  contentPackageQuerySchema,
  contentPackageMigrationCommandSchema,
  contentPackageMigrationQuerySchema,
  contentPackagesQuerySchema,
  editContentPackageVersionCommandSchema,
  attemptPublishFromHandoffCommandSchema,
  deliverContentPackageCommandSchema,
  generateContentPackageVariantsCommandSchema,
  prepareMobilePublishHandoffCommandSchema,
  recordContentPackageManualResultCommandSchema,
  recordContentPackageResultReviewActionCommandSchema,
  recordContentPackageResultSignalCommandSchema,
  recordMerchantPublishedCommandSchema,
  recordSelfReportAskCommandSchema,
  rollbackContentPackageVersionCommandSchema,
  toPublicContentPackage,
  type ContentPackage,
  type PublicContentPackage,
} from '@meiye/contracts';
import type { P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { CanonicalAssistedDeliveryError } from '../result-delivery/assisted-canonical-repository.js';
import { AssistedReceiptConflictError } from '../result-delivery/assisted-receipt-repository.js';
import {
  type OperationsApplicationService,
  OperationsError,
} from './application-service.js';
import type {
  CanvasDocument,
  CreativeContentModuleId,
  CreativeInheritanceFieldId,
  CreativeSourceReference,
  ExportRequest,
  OperationContext,
  SearchQuery,
} from './types.js';
import type { ContentPackageDeliveryService } from './content-package-delivery.js';
import {
  PublishHandoffError,
  type PublishHandoffService,
} from './publish-handoff.js';

const CREATIVE_CONTENT_MODULES = new Set<CreativeContentModuleId>([
  'social_cover',
  'before_after',
  'price_card',
  'package_explainer',
  'review_card',
  'store_intro',
  'shooting_checklist',
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
  'content_package_migration_activate',
  'content_package_migration_backfill',
  'content_package_migration_dry_run',
  'content_package_migration_freeze',
  'content_package_migration_inspect',
  'content_package_migration_rollback',
]);

const ADMIN_QUERIES = new Set([
  'admin_template_catalog',
  'content_package_migration_report',
  'content_package_migration_status',
]);

/**
 * Registers operations behind the highest Product Core seam. The module owns
 * no state; commands delegate to injected application services.
 */
export class OperationsFoundationModule implements P1OperationModule {
  readonly name = 'operations';
  private readonly adminActorIds: Set<string>;

  constructor(
    private readonly operations: OperationsApplicationService,
    private readonly options: {
      adminActorIds?: readonly string[];
      contentPackageMigration?: {
        activate(workspaceId: string, runId: string): Promise<unknown>;
        backfill(workspaceId: string, runId: string): Promise<unknown>;
        dryRun(workspaceId: string, runId: string): Promise<unknown>;
        freeze(workspaceId: string, runId: string): Promise<unknown>;
        inspect(workspaceId: string, runId: string): Promise<unknown>;
        report(workspaceId: string, runId: string): Promise<unknown>;
        rollback(workspaceId: string, runId: string): Promise<unknown>;
        status(workspaceId: string, runId: string): unknown;
      };
      delivery?: ContentPackageDeliveryService;
      /** V31-17 publish handoff + self-report journey. */
      publishHandoff?: PublishHandoffService;
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

  private migration() {
    if (!this.options.contentPackageMigration) {
      throw new OperationsError(
        'CONTENT_PACKAGE_MIGRATION_UNAVAILABLE',
        'ContentPackage migration is not configured.',
        503
      );
    }
    return this.options.contentPackageMigration;
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
      case 'content_package_migration_activate': {
        const { runId } = migrationPayload();
        return this.migration().activate(context.workspaceId, runId);
      }
      case 'content_package_migration_backfill': {
        const { runId } = migrationPayload();
        return this.migration().backfill(context.workspaceId, runId);
      }
      case 'content_package_migration_dry_run': {
        const { runId } = migrationPayload();
        return this.migration().dryRun(context.workspaceId, runId);
      }
      case 'content_package_migration_freeze': {
        const { runId } = migrationPayload();
        return this.migration().freeze(context.workspaceId, runId);
      }
      case 'content_package_migration_inspect': {
        const { runId } = migrationPayload();
        return this.migration().inspect(context.workspaceId, runId);
      }
      case 'content_package_migration_rollback': {
        const { runId } = migrationPayload();
        return this.migration().rollback(context.workspaceId, runId);
      }
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
      case 'edit_content_package_version': {
        const parsed =
          editContentPackageVersionCommandSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OperationsError(
            'INVALID_CONTENT_PACKAGE',
            parsed.error.message
          );
        }
        if (parsed.data.platform) {
          return merchantContentPackage(
            await this.operations.editContentPackageVariant(context, {
              ...parsed.data,
              platform: parsed.data.platform,
            })
          );
        }
        return merchantContentPackage(
          await this.operations.editContentPackageVersion(context, parsed.data)
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
      case 'prepare_mobile_publish_handoff': {
        const parsed =
          prepareMobilePublishHandoffCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.publishHandoff) {
          throw new OperationsError(
            'PUBLISH_HANDOFF_UNAVAILABLE',
            parsed.success
              ? 'Publish handoff is unavailable.'
              : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        try {
          return await this.options.publishHandoff.prepareMobilePublishHandoff(
            context,
            parsed.data
          );
        } catch (error) {
          throw mapPublishHandoffError(error);
        }
      }
      case 'attempt_publish_from_handoff': {
        const parsed =
          attemptPublishFromHandoffCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.publishHandoff) {
          throw new OperationsError(
            'PUBLISH_HANDOFF_UNAVAILABLE',
            parsed.success
              ? 'Publish handoff is unavailable.'
              : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        const decision =
          this.options.publishHandoff.attemptPublishFromHandoff(parsed.data);
        if (!decision.ok) {
          throw new OperationsError(
            decision.code,
            decision.message,
            403
          );
        }
        return decision;
      }
      case 'record_merchant_published': {
        const parsed = recordMerchantPublishedCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.publishHandoff) {
          throw new OperationsError(
            'PUBLISH_HANDOFF_UNAVAILABLE',
            parsed.success
              ? 'Publish handoff is unavailable.'
              : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        try {
          return merchantContentPackage(
            await this.options.publishHandoff.recordMerchantPublished(
              context,
              parsed.data
            )
          );
        } catch (error) {
          throw mapPublishHandoffError(error);
        }
      }
      case 'record_self_report_ask': {
        const parsed = recordSelfReportAskCommandSchema.safeParse(payload);
        if (!parsed.success || !this.options.publishHandoff) {
          throw new OperationsError(
            'PUBLISH_HANDOFF_UNAVAILABLE',
            parsed.success
              ? 'Publish handoff is unavailable.'
              : parsed.error.message,
            parsed.success ? 503 : 400
          );
        }
        try {
          return await this.options.publishHandoff.recordSelfReportAsk(
            context,
            parsed.data
          );
        } catch (error) {
          throw mapPublishHandoffError(error);
        }
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
      case 'delete_composer_conversation':
        return this.operations.deleteComposerConversation(
          context,
          requiredString(payload, 'conversationId')
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
      case 'create_work_from_content_package':
        return this.operations.createWorkFromContentPackage(context, {
          height: requiredPositiveInteger(payload, 'height'),
          sourcePackageId: requiredString(payload, 'sourcePackageId'),
          sourceVersionId: requiredString(payload, 'sourceVersionId'),
          width: requiredPositiveInteger(payload, 'width'),
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
      case 'export_work':
        return this.operations.exportWork(
          context,
          requiredString(payload, 'workId'),
          object(payload.request) as unknown as ExportRequest
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
      case 'content_package_migration_report': {
        const { runId } = migrationPayload();
        return this.migration().report(context.workspaceId, runId);
      }
      case 'content_package_migration_status': {
        const { runId } = migrationPayload();
        return this.migration().status(context.workspaceId, runId);
      }
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
      case 'self_report_ask': {
        if (!this.options.publishHandoff) {
          throw new OperationsError(
            'PUBLISH_HANDOFF_UNAVAILABLE',
            'Publish handoff is unavailable.',
            503
          );
        }
        // publishHandoffCompletedAt and the package revision are server facts:
        // the ask window is resolved from the durable publish event, never from
        // a timestamp the caller supplies.
        try {
          return await this.options.publishHandoff.evaluateSelfReportAskForWork(
            context,
            {
              workId: requiredString(payload, 'workId'),
              contentPackageId: requiredString(payload, 'contentPackageId'),
              platform: requiredString(payload, 'platform'),
              variantVersionId: requiredString(payload, 'variantVersionId'),
            }
          );
        } catch (error) {
          throw mapPublishHandoffError(error);
        }
      }
      default:
        throw new Error(`Unknown operations query ${action}.`);
    }
  }
}

function mapPublishHandoffError(error: unknown): never {
  if (error instanceof PublishHandoffError) {
    throw new OperationsError(error.code, error.message, error.status);
  }
  if (
    error instanceof CanonicalAssistedDeliveryError ||
    error instanceof AssistedReceiptConflictError
  ) {
    throw new OperationsError(error.code, error.message, error.status);
  }
  if (error instanceof OperationsError) throw error;
  throw error;
}
