import { uploadProductAsset } from '@/api/product-assets';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { AiMarkdown } from '@/components/markdown/ai-markdown';
import { GenerationAccent } from '@/components/uiux/generation-accent';
import { ProductIcon } from '@/components/uiux/product-icon';
import { ProductStatus } from '@/components/uiux/product-status';
import { StatePanel } from '@/components/uiux/state-panel';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  copy_candidate_accept,
  copy_candidate_accepted_badge,
  copy_candidate_conversion_hook_label,
  copy_stream_candidate,
  creation_catalog_copy_label,
  creation_catalog_image_detail,
  creation_catalog_image_label,
  creation_catalog_mode_direct,
  creation_entry_input_guide,
  creative_brief_auto_confirming,
  creative_brief_safe_audience_draft,
  creative_brief_safe_scene_with_asset_draft,
  creative_brief_safe_scene_without_asset_draft,
  creative_brief_safe_tone_draft,
  creative_brief_submit_blocked,
  creative_brief_title,
  creative_grounding_description,
  creative_grounding_missing_asset,
  creative_grounding_missing_project,
  creative_grounding_missing_qualification,
  creative_grounding_missing_store,
  creative_grounding_open_assets,
  creative_grounding_open_store,
  creative_grounding_ready,
  creative_grounding_server_blocked,
  creative_grounding_submit_blocked,
  creative_grounding_title,
  model_settings_production_available,
  operations_rail_aria,
  p1_canvas_export_brand_fallback,
  product_navigation_workbench,
  workbench_accept_contract_hint,
  workbench_accept_contract_label,
  workbench_aigc_follows_switch,
  workbench_aigc_label,
  workbench_aspect_portrait_post,
  workbench_aspect_ratio,
  workbench_aspect_square,
  workbench_aspect_vertical_video,
  workbench_catalog_failure_description,
  workbench_catalog_failure_title,
  workbench_catalog_loading_description,
  workbench_catalog_loading_title,
  workbench_compliance_summary,
  workbench_contract_check_required,
  workbench_contract_incomplete,
  workbench_copy_stream_validation_failed,
  workbench_create_image_text,
  workbench_create_image_text_description,
  workbench_create_video,
  workbench_create_video_description,
  workbench_current_work,
  workbench_derive_new_work,
  workbench_derived_work,
  workbench_description,
  workbench_details_drawer,
  workbench_empty_description,
  workbench_empty_title,
  workbench_expected_output,
  workbench_explicit_model,
  workbench_generating_content,
  workbench_generating_video,
  workbench_greeting,
  workbench_greeting_fallback,
  workbench_harness_alternatives,
  workbench_harness_copy_awaiting,
  workbench_harness_copy_streaming,
  workbench_harness_primary,
  workbench_harness_stop_unavailable,
  workbench_header_badge,
  workbench_image_result,
  workbench_inbox_description,
  workbench_inbox_failure_description,
  workbench_inbox_failure_title,
  workbench_inbox_loading_title,
  workbench_inherited_fields,
  workbench_job_recovered,
  workbench_job_retry_description,
  workbench_list_separator,
  workbench_loading_description,
  workbench_loading_title,
  workbench_local_fixture_description,
  workbench_local_fixture_title,
  workbench_media_execution_disabled,
  workbench_mode_agent,
  workbench_model_execution_disabled,
  workbench_model_guardrail,
  workbench_model_not_selected,
  workbench_model_unavailable_description,
  workbench_model_unavailable_title,
  workbench_module_count,
  workbench_modules_save_failed,
  workbench_new_creation,
  workbench_no_references,
  workbench_open_job,
  workbench_open_session,
  workbench_open_work,
  workbench_operation_failed,
  workbench_preset_identity_description,
  workbench_preset_loading_description,
  workbench_preset_loading_title,
  workbench_professional_settings,
  workbench_projection_failure_description,
  workbench_projection_failure_title,
  workbench_quota_insufficient,
  workbench_quota_insufficient_description,
  workbench_quota_line,
  workbench_quota_open_plans,
  workbench_quote_changed,
  workbench_quote_changed_retry,
  workbench_quote_missing_description,
  workbench_quote_missing_short,
  workbench_quote_missing_title,
  workbench_record_aria,
  workbench_record_direct_aria,
  workbench_reference_assets_will_be_used,
  workbench_reference_failure_action,
  workbench_reference_failure_authorization,
  workbench_reference_failure_deleted,
  workbench_reference_failure_description,
  workbench_reference_failure_fallback_photo,
  workbench_reference_failure_oversized,
  workbench_reference_failure_rights_incomplete,
  workbench_reference_failure_title,
  workbench_reference_failure_unreadable,
  workbench_reference_multi_not_supported,
  workbench_reference_submit_blocked,
  workbench_regenerate,
  workbench_reload,
  workbench_reload_catalog,
  workbench_reload_inbox,
  workbench_reload_sources,
  workbench_reload_tasks,
  workbench_resubmit_stream,
  workbench_result_attached_to_content,
  workbench_result_attach_to_content,
  workbench_result_attaching_to_content,
  workbench_result_saved_as_asset,
  workbench_result_saved_description,
  workbench_result_view_content,
  workbench_resume_job,
  workbench_retry_updates,
  workbench_revise_direction_placeholder,
  workbench_revise_intent,
  workbench_revise_submit,
  workbench_section_composer,
  workbench_section_intent,
  workbench_section_job,
  workbench_progress_title,
  workbench_progress_help,
  workbench_section_next,
  workbench_section_references,
  workbench_section_results,
  workbench_section_reuse,
  workbench_selected_model,
  workbench_selected_preset,
  workbench_selected_source,
  workbench_settings_summary,
  workbench_show_example,
  workbench_source_already_present,
  workbench_source_asset,
  workbench_source_failure_description,
  workbench_source_insert_failed,
  workbench_source_inserted,
  workbench_source_task,
  workbench_sources_failure_title,
  workbench_sources_loading_description,
  workbench_sources_loading_title,
  workbench_start_first_creation,
  workbench_stop_stream,
  workbench_store_asset,
  workbench_stream_guardrail,
  workbench_stream_interrupted,
  workbench_stream_stopped,
  workbench_stream_title,
  workbench_submit_failed,
  workbench_submit_job,
  workbench_submit_with_price,
  workbench_refine_expression,
  workbench_advanced_details,
  workbench_submitting_accent,
  workbench_submitting_title,
  workbench_summary_model_spec,
  workbench_summary_output_duration,
  workbench_summary_quote_labels,
  workbench_summary_starting_card,
  workbench_switch_off,
  workbench_switch_on,
  workbench_tasks_failure_title,
  workbench_technical_failure_usage,
  workbench_title,
  workbench_updates_failed,
  workbench_uploaded_image,
  workbench_usage_copy,
  workbench_usage_image,
  workbench_usage_video,
  workbench_verify_job,
  workbench_verify_only,
  workbench_video_contract_required,
  workbench_video_quote_confirm,
  workbench_video_quote_confirm_hint,
  workbench_video_result,
  workbench_view_model_details,
  workbench_view_settings,
  workbench_watermark,
  workbench_work_create_failed,
  workbench_work_created,
  workbench_work_required,
} from '@/locale/paraglide/messages';
import { runWithStableSubmissionAttempt } from '@/lib/stable-submission-attempt';
import { friendlyProductError } from '@/lib/correlated-api-error';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import { durationEstimateView } from '@/lib/uiux/duration-estimate';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import {
  beginFirstUsableDraftMeasurement,
  cancelFirstUsableDraftMeasurement,
  finishFirstUsableDraftMeasurement,
  prepareFirstUsableDraftMeasurement,
} from '@/lib/first-usable-draft-metric';
import {
  commandP1,
  operationsCommand,
  operationsQuery,
  p1ErrorCode,
  queryP1,
} from '@/p1/client';
import {
  readCurrentModelSelection,
  resolveCreationModelSelection,
  writeCurrentModelSelection,
} from '@/p1/model-current-selection';
import type { RawInbox } from '@/p1/operations-view-model';
import { taskSystemText, templateViews } from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import type { TemplateCatalogItemView } from '@/p1/types';
import type { AccountUsageProjection } from '@/product/account-usage';
import { executeAssetAuthorization } from '@/product/asset-authorization-model';
import type { ComposerImageIdentity } from '@/product/composer-image-input';
import { contentCount } from '@/product/content-count';
import { ContentModuleBuilder } from '@/product/content-module-builder';
import { CreationEntry, CreationModePicker } from '@/product/creation-entry';
import { MarketingEvidenceChips } from '@/product/marketing-evidence-chips';
import { productionMarketingEntryCapabilities } from '@/product/marketing-entry-model';
import {
  canCreateFromUploads,
  composerAssetAuthorizationDraft,
  CREATION_DRAFT_INTENT_STORAGE_KEY,
  exampleStoreVisibility,
  readCreationDraftIntent,
  shouldLaunchAgentHarness,
  writeCreationDraftIntent,
  type ConfirmedAssetFacts,
} from '@/product/creation-entry-model';
import type { CreationCatalogResponse } from '@/product/creation-catalog-model';
import {
  DEFAULT_INHERITANCE_FIELDS,
  INHERITANCE_FIELD_OPTIONS,
} from '@/product/creation-shelf-model';
import { OperationsRail } from '@/product/operations-rail';
import { CreationShelf } from '@/product/creation-shelf';
import { CreationAssistant } from '@/product/creation-assistant';
import { assistantSourceSummaries } from '@/product/creation-assistant-context';
import {
  CreativeBriefEditor,
  missingBriefAdoptFields,
  missingCreativeGrounding,
  type CreativeBriefDrafts,
  type CreativeGroundingRequirement,
} from '@/product/creative-brief-editor';
import { CanonicalMediaGallery } from '@/product/canonical-media-gallery';
import { isContentPackageEligibleAsset } from '@/product/canonical-asset-governance-model';
import { canonicalMediaForAssetIds } from '@/product/canonical-history-model';
import { ContentPackageCard } from '@/p1/content-package-card';
import {
  contentPackageGenerationAttachmentTarget,
  createContentPackageGenerationAttachmentCommand,
} from '@/product/content-package-generation-attachment';
import { CopyCandidateSelector } from '@/product/copy-candidate-selector';
import { buildCopyCandidateSelectorModel } from '@/product/copy-candidate-selector-model';
import { executeProductCommand, readProductEnvelope } from '@/product/client';
import { DeviceRelayPopover } from '@/product/device-relay-popover';
import { useGlobalCommand } from '@/product/global-command-palette';
import { HarnessQuestionCard } from '@/product/harness-question-card';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';
import {
  recordFirstUsableDraftMetric,
  submitHarnessTask,
} from '@/product/harness-client';
import { TodayRecommendationCard } from '@/product/today-recommendation-card';
import { ExampleStorePreview } from '@/product/example-store-preview';
import {
  candidateHasToken,
  CopyCandidateStream,
  shouldShowCopyStreamPanel,
  useCopyCandidateStream,
} from '@/product/copy-stream';
import {
  creativeJobObservation,
  useCreativeJobObserver,
} from '@/product/creative-job-observer';
import {
  creativeOutputLabel,
  creativeQuoteRevision,
  defaultAspectRatioForOperation,
  merchantUsageQuoteLabel,
  quoteFor,
} from '@/product/creative-quote';
import { creativeWorkDisplay } from '@/product/creative-work-display';
import { resultCenterPath } from '@meiye/contracts';
import {
  autoConfirmedCreativeBrief,
  compactDeliveredCopyResult,
  harnessCandidateResultModel,
  harnessCopyStreamPhase,
  quoteRecoveryReady,
  restoredCreationOperation,
  streamErrorCode,
  workbenchComplianceContractValues,
  workbenchComplianceDefaults,
  workbenchGreetingName,
} from '@/product/workbench-state-model';
import { ResultProvenance } from '@/product/result-provenance';
import {
  WorkbenchComposerAxis,
  WorkbenchPrimarySurface,
  WorkbenchStageShell,
  WorkbenchStatusStrip,
  type WorkbenchStage,
} from '@/product/workbench-stage-shell';
import type { VideoDataClass } from '@/product/video-workflow-model';
import {
  normalizeCatalog,
  normalizePreferences,
  type ModelOperation,
} from '@/p1/settings-view-model';
import { ModelCardPicker } from '@/product/model-card-picker';
import type {
  ContentPackage,
  CreativeGenerationApprovalReceipt,
  CreativeBriefUpdate,
  CreativeContentModuleId,
  CreativeExecutionContract,
  CreativeJob,
  CreativeSourceReference,
  CreativeWorkbenchProjection,
  ProductState,
} from '@meiye/contracts';
import { contentPackageVisibleStatus } from '@meiye/contracts';
import {
  IconBolt,
  IconChevronDown,
  IconChevronUp,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconVideo,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

interface RawCatalog {
  revisionId?: string;
  models?: unknown[];
  deployments?: unknown[];
}

interface CreativeResult {
  assets: CreativeWorkbenchProjection['assets'];
  contents: CreativeWorkbenchProjection['contents'];
  job: CreativeJob;
  work: CreativeWorkbenchProjection['works'][number];
}

interface CreativeJobFailureMessages {
  action: () => string;
  authorization: (input: { photo: string }) => string;
  deleted: (input: { photo: string }) => string;
  description: () => string;
  fallbackPhoto: (input: { index: number }) => string;
  multiNotSupported: () => string;
  oversized: (input: { photo: string }) => string;
  rightsIncomplete: (input: { photo: string }) => string;
  submitBlocked: () => string;
  title: () => string;
  unreadable: (input: { photo: string }) => string;
}

type ReferenceFailureReasonCode =
  | 'authorization_withdrawn'
  | 'not_found'
  | 'oversized'
  | 'rights_incomplete'
  | 'unreadable';

interface ReferenceFailureDetail {
  assetId: string;
  reasonCode: ReferenceFailureReasonCode;
}

type SubmissionBlocker =
  | { kind: 'message'; description: string }
  | { kind: 'quota' }
  | { kind: 'quote_changed' }
  | { kind: 'reference'; details: unknown };

type HarnessLaunchFailureKind =
  | 'authorization'
  | 'grounding'
  | 'quota'
  | 'retry';

const referenceAssetFailureCodes = new Set([
  'REFERENCE_ASSET_UNRESOLVED',
  'reference_asset_resolution_required',
]);
const referenceFailureReasonCodes = new Set<ReferenceFailureReasonCode>([
  'authorization_withdrawn',
  'not_found',
  'oversized',
  'rights_incomplete',
  'unreadable',
]);

function localizedCreativeJobFailureMessages(): CreativeJobFailureMessages {
  return {
    action: workbench_reference_failure_action,
    authorization: workbench_reference_failure_authorization,
    deleted: workbench_reference_failure_deleted,
    description: workbench_reference_failure_description,
    fallbackPhoto: workbench_reference_failure_fallback_photo,
    multiNotSupported: workbench_reference_multi_not_supported,
    oversized: workbench_reference_failure_oversized,
    rightsIncomplete: workbench_reference_failure_rights_incomplete,
    submitBlocked: workbench_reference_submit_blocked,
    title: workbench_reference_failure_title,
    unreadable: workbench_reference_failure_unreadable,
  };
}

function referenceFailuresFromDetails(
  details: unknown
): ReferenceFailureDetail[] {
  const failures =
    details &&
    typeof details === 'object' &&
    'referenceFailures' in details &&
    Array.isArray(details.referenceFailures)
      ? details.referenceFailures
      : [];
  return failures.flatMap((failure) => {
    if (
      !failure ||
      typeof failure !== 'object' ||
      !('assetId' in failure) ||
      typeof failure.assetId !== 'string' ||
      !('reasonCode' in failure) ||
      typeof failure.reasonCode !== 'string' ||
      !referenceFailureReasonCodes.has(
        failure.reasonCode as ReferenceFailureReasonCode
      )
    ) {
      return [];
    }
    return [
      {
        assetId: failure.assetId,
        reasonCode: failure.reasonCode as ReferenceFailureReasonCode,
      },
    ];
  });
}

export function harnessLaunchFailureKind(
  error: unknown
): HarnessLaunchFailureKind {
  const errorCode = p1ErrorCode(error);
  if (
    errorCode === 'INSUFFICIENT_ENTITLEMENT' ||
    errorCode === 'ENTITLEMENT_INSUFFICIENT'
  ) {
    return 'quota';
  }
  if (
    errorCode === 'CREATIVE_GROUNDING_INCOMPLETE' ||
    errorCode === 'HARNESS_GROUNDING_INCOMPLETE'
  ) {
    return 'grounding';
  }
  const details =
    error && typeof error === 'object' && 'details' in error
      ? error.details
      : undefined;
  if (
    referenceFailuresFromDetails(details).length > 0 ||
    [
      'ASSET_AUTHORIZATION_REQUIRED',
      'ASSET_NOT_AUTHORIZED',
      'AUTHORIZATION_REQUIRED',
      'CONTENT_PACKAGE_ASSETS_NOT_AUTHORIZED',
      'REFERENCE_ASSET_UNRESOLVED',
      'RIGHTS_EVIDENCE_REQUIRED',
    ].includes(errorCode ?? '')
  ) {
    return 'authorization';
  }
  return 'retry';
}

function ReferenceFailureNotice({
  currentAssets,
  description,
  failures,
  messages,
  snapshotAssets = [],
  testId,
  title,
}: {
  currentAssets: ProductState['assets'];
  description?: string;
  failures: ReferenceFailureDetail[];
  messages: CreativeJobFailureMessages;
  snapshotAssets?: Array<{ id: string; tags: string[] }>;
  testId: string;
  title: string;
}) {
  const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
  const snapshotById = new Map(
    snapshotAssets.map((asset) => [asset.id, asset])
  );
  return (
    <section
      className="meiye-porcelain rounded-2xl border border-divider p-4 text-sm"
      data-testid={testId}
      role="alert"
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1">{description}</p> : null}
      {failures.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {failures.map((failure, index) => {
            const currentAsset = currentById.get(failure.assetId);
            const photo =
              currentAsset?.tags.at(-1) ??
              snapshotById.get(failure.assetId)?.tags.at(-1) ??
              messages.fallbackPhoto({ index: index + 1 });
            const presentation =
              failure.reasonCode === 'not_found'
                ? 'deleted'
                : failure.reasonCode === 'authorization_withdrawn' ||
                    failure.reasonCode === 'rights_incomplete'
                  ? 'authorization'
                  : 'unreadable';
            const reason =
              failure.reasonCode === 'not_found'
                ? messages.deleted({ photo })
                : failure.reasonCode === 'authorization_withdrawn'
                  ? messages.authorization({ photo })
                  : failure.reasonCode === 'rights_incomplete'
                    ? messages.rightsIncomplete({ photo })
                    : failure.reasonCode === 'oversized'
                      ? messages.oversized({ photo })
                      : messages.unreadable({ photo });
            return (
              <li
                className="flex items-center gap-3 rounded-md bg-background/60 p-2"
                data-reference-photo={presentation}
                key={failure.assetId}
              >
                {currentAsset ? (
                  <CanonicalMediaGallery
                    className="w-20 shrink-0 grid-cols-1!"
                    media={canonicalMediaForAssetIds([], currentAssets, [
                      failure.assetId,
                    ])}
                    showMeta={false}
                  />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
                    <IconPhoto aria-hidden="true" className="size-5" />
                  </span>
                )}
                <span>{reason}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <a
        className="mt-3 inline-block font-medium underline underline-offset-4"
        href="/dashboard/assets"
      >
        {messages.action()}
      </a>
    </section>
  );
}

export function CreativeSubmissionFailureNotice({
  currentAssets,
  details,
  messages = localizedCreativeJobFailureMessages(),
}: {
  currentAssets: ProductState['assets'];
  details: unknown;
  messages?: CreativeJobFailureMessages;
}) {
  return (
    <ReferenceFailureNotice
      currentAssets={currentAssets}
      failures={referenceFailuresFromDetails(details)}
      messages={messages}
      testId="creative-submission-reference-failure"
      title={messages.submitBlocked()}
    />
  );
}

export function CreativeJobFailureNotice({
  currentAssets,
  job,
  messages = localizedCreativeJobFailureMessages(),
  sourceAssetIds = [],
}: {
  currentAssets: ProductState['assets'];
  job: CreativeJob;
  messages?: CreativeJobFailureMessages;
  sourceAssetIds?: string[];
}) {
  if (
    job.failureCode === 'model_execution_disabled' ||
    job.failureCode === 'media_execution_disabled'
  ) {
    return (
      <section
        className="meiye-porcelain rounded-2xl border border-destructive/25 p-4 text-sm text-destructive"
        data-testid="creative-job-execution-disabled"
        role="alert"
      >
        <p className="font-medium">
          {job.failureCode === 'model_execution_disabled'
            ? workbench_model_execution_disabled()
            : workbench_media_execution_disabled()}
        </p>
      </section>
    );
  }
  if (job.failureCode === 'video_reference_limit') {
    return (
      <section
        className="meiye-porcelain rounded-2xl border border-divider p-4 text-sm"
        data-testid="creative-job-reference-failure"
        role="alert"
      >
        <p className="font-medium">{messages.multiNotSupported()}</p>
      </section>
    );
  }
  if (!job.failureCode || !referenceAssetFailureCodes.has(job.failureCode)) {
    return null;
  }
  const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
  const snapshotAssets = job.groundingSnapshot?.assets ?? [];
  const referenceAssets =
    snapshotAssets.length > 0
      ? snapshotAssets
      : sourceAssetIds.map((id) => ({
          id,
          tags: currentById.get(id)?.tags ?? [],
        }));

  const failures = referenceAssets.map((snapshotAsset) => {
    const currentAsset = currentById.get(snapshotAsset.id);
    return {
      assetId: snapshotAsset.id,
      reasonCode: !currentAsset
        ? ('not_found' as const)
        : currentAsset.authorizationStatus !== 'authorized'
          ? ('authorization_withdrawn' as const)
          : !currentAsset.rightsEvidence?.trim()
            ? ('rights_incomplete' as const)
            : ('unreadable' as const),
    };
  });
  return (
    <ReferenceFailureNotice
      currentAssets={currentAssets}
      description={messages.description()}
      failures={failures}
      messages={messages}
      snapshotAssets={referenceAssets}
      testId="creative-job-reference-failure"
      title={messages.title()}
    />
  );
}

const operationOptions: Array<{
  description: () => string;
  icon: typeof IconSparkles;
  label: () => string;
  operation: ModelOperation;
}> = [
  {
    description: workbench_create_image_text_description,
    icon: IconSparkles,
    label: workbench_create_image_text,
    operation: 'copy.generate',
  },
  {
    description: creation_catalog_image_detail,
    icon: IconPhoto,
    label: creation_catalog_image_label,
    operation: 'image.generate',
  },
  {
    description: workbench_create_video_description,
    icon: IconVideo,
    label: workbench_create_video,
    operation: 'video.generate',
  },
];

const emptyProjection: CreativeWorkbenchProjection = {
  assets: [],
  contents: [],
  events: [],
  jobs: [],
  works: [],
};

const WORKBENCH_PROJECTION_RETRY_LIMIT = 4;

export function shouldRetryWorkbenchProjection(failureCount: number) {
  return failureCount < WORKBENCH_PROJECTION_RETRY_LIMIT;
}

export function workbenchProjectionRetryDelay(attemptIndex: number) {
  return Math.min(500 * 2 ** attemptIndex, 4_000);
}

export function isWorkbenchProjectionPreparing(
  hasProjection: boolean,
  isPending: boolean
) {
  return !hasProjection && isPending;
}

const EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY =
  'meiye.creation-excluded-asset-ids.v1';

function readExcludedEntryAssetIds() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY) ??
        '[]'
    );
    return new Set(
      Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === 'string')
        : []
    );
  } catch {
    return new Set<string>();
  }
}

function writeExcludedEntryAssetIds(ids: Set<string>) {
  if (ids.size === 0) {
    window.sessionStorage.removeItem(EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(
    EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY,
    JSON.stringify([...ids])
  );
}

function sessionId() {
  if (typeof window === 'undefined') return 'session-pending';
  const stored = window.sessionStorage.getItem('meiye:creative-session-id');
  if (stored) return stored;
  const created = `session-${crypto.randomUUID()}`;
  window.sessionStorage.setItem('meiye:creative-session-id', created);
  return created;
}

async function productState(signal?: AbortSignal) {
  const response = await telemetryFetch('/api/core/product/state', {
    credentials: 'same-origin',
    signal,
  });
  return readProductEnvelope<ProductState>(response);
}

function latest<T extends { updatedAt: string }>(items: T[]) {
  return items.reduce<T | undefined>(
    (current, item) =>
      !current || item.updatedAt >= current.updatedAt ? item : current,
    undefined
  );
}

function RecordSection({
  children,
  className,
  eyebrow,
  hero = false,
  roseGlow = false,
  testId,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** Optional — shop-window stage avoids competing mono eyebrows. */
  eyebrow?: string;
  hero?: boolean;
  roseGlow?: boolean;
  testId?: string;
  title: string;
}) {
  return (
    <section
      className={cn(
        'meiye-porcelain rounded-2xl p-5 sm:p-6',
        hero && 'order-first',
        roseGlow && 'meiye-rose-glow',
        className
      )}
      data-testid={testId}
    >
      <div className={cn(eyebrow ? 'mb-4' : 'mb-3')}>
        {eyebrow ? (
          <p className="meiye-type-aux text-[oklch(0_0_0/0.45)]">{eyebrow}</p>
        ) : null}
        <h2
          className={cn(
            'meiye-type-body font-semibold',
            eyebrow ? 'mt-1' : undefined
          )}
        >
          {title}
        </h2>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function unifiedCreationWorkbenchContentCount(
  productContents: ReadonlyArray<{ id: string }>,
  creativeContents: ReadonlyArray<{ id: string }>,
  contentPackages: ReadonlyArray<Pick<ContentPackage, 'legacySource'>>
) {
  return contentCount(
    [
      ...productContents.map((content) => ({
        id: content.id,
        sourceType: 'product_content_item' as const,
      })),
      ...creativeContents.map((content) => ({
        id: content.id,
        sourceType: 'creative_content' as const,
      })),
    ],
    contentPackages
  );
}

export function UnifiedCreationWorkbench({
  onWorkIdChange,
  workId,
}: {
  onWorkIdChange?: (workId: string) => Promise<void> | void;
  workId?: string;
} = {}) {
  const queryClient = useQueryClient();
  const { pendingAction } = useGlobalCommand();
  const intentRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLElement>(null);
  const copySubmissionKeyRef = useRef<string | undefined>(undefined);
  const quoteAcceptedAtRef = useRef<string | undefined>(undefined);
  const briefAutoConfirmWorkIdRef = useRef<string | undefined>(undefined);
  const initialSourceSelectionApplied = useRef(false);
  const complianceDefaultsApplied = useRef(false);
  const complianceDefaultsTouched = useRef(false);
  const complianceDefaults = useComplianceDefaults();
  const [intent, setIntent] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (readCreationDraftIntent(window.sessionStorage) ?? '')
  );
  const [mode, setMode] = useState<'agent' | 'direct'>('agent');
  const [operation, setOperation] = useState<ModelOperation>('copy.generate');
  const [currentModelSelections, setCurrentModelSelections] = useState<
    Partial<Record<ModelOperation, string>>
  >(() =>
    Object.fromEntries(
      operationOptions.flatMap((item) => {
        const selection = readCurrentModelSelection(item.operation);
        return selection ? [[item.operation, selection.catalogModelId]] : [];
      })
    )
  );
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [quoteAcceptedAt, setQuoteAcceptedAt] = useState<string>();
  const [videoApprovalReceiptId, setVideoApprovalReceiptId] =
    useState<string>();
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [aigcLabelEnabled, setAigcLabelEnabled] = useState(true);
  useEffect(() => {
    if (
      complianceDefaultsApplied.current ||
      complianceDefaultsTouched.current ||
      !complianceDefaults.data
    ) {
      return;
    }
    complianceDefaultsApplied.current = true;
    const defaults = workbenchComplianceDefaults(complianceDefaults.data);
    setWatermarkEnabled(defaults.watermarkEnabled);
    setAigcLabelEnabled(defaults.aigcLabelEnabled);
  }, [complianceDefaults.data]);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '3:4' | '9:16'>('3:4');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [exampleOpened, setExampleOpened] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [professionalOpen, setProfessionalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [briefAutoConfirming, setBriefAutoConfirming] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [contentModules, setContentModules] = useState<
    CreativeContentModuleId[]
  >(['social_cover']);
  const [entryAssetIds, setEntryAssetIds] = useState<Set<string>>(new Set());
  const [entryExcludedAssetIds, setEntryExcludedAssetIds] = useState<
    Set<string>
  >(() => readExcludedEntryAssetIds());
  const [entryUploads, setEntryUploads] = useState<
    Array<{ status: 'uploading' | 'ready' | 'failed' }>
  >([]);
  const selectCurrentModel = (modelId: string) => {
    writeCurrentModelSelection(operation, {
      catalogModelId: modelId,
      mode: 'fixed',
    });
    setCurrentModelSelections((current) => ({
      ...current,
      [operation]: modelId,
    }));
  };
  const revealModelPicker = () => {
    setProfessionalOpen(true);
    requestAnimationFrame(() => modelPickerRef.current?.focus());
  };
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(
    new Set()
  );
  const [copyStreamInterruption, setCopyStreamInterruption] = useState<
    'error' | 'stopped'
  >();
  const [submissionBlocker, setSubmissionBlocker] =
    useState<SubmissionBlocker>();
  const [quoteRecovery, setQuoteRecovery] = useState<{
    previousQuoteRevision: string;
    targetCatalogRevision?: string;
  }>();
  const [harnessLaunchFailureWorkId, setHarnessLaunchFailureWorkId] =
    useState<string>();
  const [harnessLaunchFailureType, setHarnessLaunchFailureType] =
    useState<HarnessLaunchFailureKind>('retry');
  const [harnessLaunchPendingWorkId, setHarnessLaunchPendingWorkId] =
    useState<string>();

  useEffect(() => {
    prepareFirstUsableDraftMeasurement();
  }, []);

  const updateIntent = useCallback((nextIntent: string) => {
    setIntent(nextIntent);
    if (!writeCreationDraftIntent(window.sessionStorage, nextIntent)) {
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    }
  }, []);

  const resetNewCreationState = useCallback(() => {
    setIntent('');
    setOperation('copy.generate');
    window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    setSelectedPresetId(undefined);
    setEntryAssetIds(new Set());
    setEntryExcludedAssetIds(new Set());
    window.sessionStorage.removeItem(EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY);
    setEntryUploads([]);
    setSelectedSourceKeys(new Set());
    setQuoteAccepted(false);
    setQuoteAcceptedAt(undefined);
    setVideoApprovalReceiptId(undefined);
    setQuoteRecovery(undefined);
    quoteAcceptedAtRef.current = undefined;
    setProfessionalOpen(false);
    setDetailsOpen(false);
    briefAutoConfirmWorkIdRef.current = undefined;
    setBriefAutoConfirming(false);
    setOnboardingDismissed(false);
    setShowOnboarding(true);
    initialSourceSelectionApplied.current = false;
  }, []);

  const projectionQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: shouldRetryWorkbenchProjection,
    retryDelay: workbenchProjectionRetryDelay,
  });
  const inboxQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'inbox', { ui: 'creative' }),
    queryFn: ({ signal }) => operationsQuery<RawInbox>('inbox', {}, signal),
  });
  const productQuery = useQuery({
    queryKey: ['product', 'creative-sources'],
    queryFn: ({ signal }) => productState(signal),
  });
  const accountNameQuery = useQuery({
    queryKey: ['workbench', 'account-name'],
    queryFn: async () => {
      // Dynamic import keeps the auth client (and its validated client env)
      // out of the Node test import graph — same pattern as the
      // `cloudflare:workers` fix in the RW rounds.
      const { authClient } = await import('@/auth/client');
      const session = await authClient.getSession();
      return session.data?.user?.name ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const projection = projectionQuery.data ?? emptyProjection;
  const contentPackagesQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackage[]>('content_packages', {}, signal),
  });
  const contentPackages = contentPackagesQuery.data ?? [];
  const currentWork = workId
    ? projection.works.find((work) => work.id === workId)
    : latest(projection.works);
  const currentHarnessPackage =
    currentWork?.mode === 'agent'
      ? contentPackages.find(
          (contentPackage) =>
            contentPackage.kind === 'image_text' &&
            contentPackage.source.workId === currentWork.id &&
            contentPackage.source.workflowId === currentWork.id
        )
      : undefined;
  const catalogQuery = useQuery({
    enabled: Boolean(currentWork),
    queryKey: p1QueryKeys.request('model-supply', 'catalog', { operation }),
    queryFn: ({ signal }) =>
      queryP1<RawCatalog>(
        'model-supply',
        { action: 'catalog', payload: { operation } },
        signal
      ),
  });
  const preferencesQuery = useQuery({
    enabled: Boolean(currentWork),
    queryKey: p1QueryKeys.request('model-supply', 'preferences', { operation }),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'preferences', payload: { operation } },
        signal
      ),
  });
  const creationCatalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  // Light entitlement query stays on from Day 0 so the passive quota line and
  // insufficient-quota recovery card work before the first Work exists (T2).
  const usageQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
    staleTime: 30_000,
  });

  const currentJob = currentWork?.currentJobId
    ? projection.jobs.find((job) => job.id === currentWork.currentJobId)
    : undefined;
  const currentJobObserver = useCreativeJobObserver(
    creativeJobObservation(currentJob)
  );
  useEffect(() => {
    if (!currentWork) return;
    const restored = restoredCreationOperation({
      currentJob,
      work: currentWork,
    });
    setOperation((current) => (current === restored ? current : restored));
  }, [
    currentJob?.contract.operation,
    currentJob?.id,
    currentWork?.id,
    currentWork?.operation,
  ]);
  const currentContents = currentJob
    ? projection.contents.filter((content) => content.jobId === currentJob.id)
    : [];
  const currentAssets = currentJob
    ? projection.assets.filter((asset) => asset.jobId === currentJob.id)
    : [];
  const currentSessionWorkIds = new Set(
    projection.works
      .filter((work) => work.sessionId === currentWork?.sessionId)
      .map((work) => work.id)
  );
  const currentSessionAssets = projection.assets.filter((asset) =>
    currentSessionWorkIds.has(asset.workId)
  );
  const videoReferenceAssetIds = useMemo(() => {
    const availableAssetIds = new Set(
      (productQuery.data?.assets ?? [])
        .filter((asset) => isContentPackageEligibleAsset(asset))
        .map((asset) => asset.id)
    );
    return [
      ...new Set(
        (currentWork?.sourceReferences ?? [])
          .filter(
            (reference) =>
              reference.kind === 'asset' && availableAssetIds.has(reference.id)
          )
          .map((reference) => reference.id)
      ),
    ].sort();
  }, [currentWork?.sourceReferences, productQuery.data?.assets]);
  const videoDataClass = useMemo<VideoDataClass[]>(() => {
    const sourceAssetIds = new Set(videoReferenceAssetIds);
    const sources = (productQuery.data?.assets ?? []).filter((asset) =>
      sourceAssetIds.has(asset.id)
    );
    return [
      ...(sources.some((asset) => asset.containsPerson)
        ? (['contains_face'] as const)
        : []),
      ...(sources.some((asset) => asset.containsSensitiveData)
        ? (['pii'] as const)
        : []),
    ];
  }, [productQuery.data?.assets, videoReferenceAssetIds]);
  const skipped = projection.events.some(
    (event) => event.type === 'cold_start_skipped'
  );
  const catalog = normalizeCatalog(catalogQuery.data ?? {}, operation);
  const preferences = normalizePreferences(preferencesQuery.data);
  const templateItems = templateViews(
    creationCatalogQuery.data?.templates ?? [],
    creationCatalogQuery.data?.userTemplates ?? [],
    creationCatalogQuery.data?.shortcuts ?? []
  );
  // Z1: named presets no longer carry internalIntent; keep create-capable templates only.
  const namedPresets = templateItems.filter(
    (template): template is TemplateCatalogItemView & { inputGuide?: string } =>
      Boolean(template.canCreate)
  );
  const selectedPreset = namedPresets.find(
    (template) => template.id === selectedPresetId
  );
  const currentDisplay = currentWork
    ? creativeWorkDisplay(
        currentWork,
        templateItems,
        Boolean(creationCatalogQuery.data)
      )
    : undefined;
  const currentPreset =
    currentDisplay?.kind === 'preset'
      ? namedPresets.find((template) => template.id === currentDisplay.presetId)
      : undefined;
  const currentSourceSummaries = useMemo(
    () =>
      assistantSourceSummaries({
        assets: (productQuery.data?.assets ?? []).map((asset) => ({
          id: asset.id,
          label: asset.tags[0] ?? asset.mediaType,
        })),
        contents: projection.contents.map((content) => ({
          id: content.id,
          label: content.title,
        })),
        references: currentWork?.sourceReferences ?? [],
        tasks: (inboxQuery.data?.tasks ?? []).map((task) => ({
          id: task.id,
          label: taskSystemText(task.title) ?? task.title,
        })),
        templates: templateItems.map((template) => ({
          id: template.id,
          label: template.name,
        })),
        works: projection.works.map((work) => ({
          id: work.id,
          label: creativeWorkDisplay(
            work,
            templateItems,
            Boolean(creationCatalogQuery.data)
          ).title,
        })),
      }),
    [
      creationCatalogQuery.data,
      currentWork?.sourceReferences,
      inboxQuery.data?.tasks,
      productQuery.data?.assets,
      projection.contents,
      projection.works,
      templateItems,
    ]
  );
  const briefDrafts = useMemo<CreativeBriefDrafts>(
    () => ({
      audience: creative_brief_safe_audience_draft(),
      intent: currentWork?.intent ?? '',
      scene: currentWork?.sourceReferences.some(
        (reference) => reference.kind === 'asset'
      )
        ? creative_brief_safe_scene_with_asset_draft()
        : creative_brief_safe_scene_without_asset_draft(),
      tone:
        productQuery.data?.store?.confirmedAt &&
        productQuery.data.store.brandVoice.trim()
          ? productQuery.data.store.brandVoice
          : creative_brief_safe_tone_draft(),
    }),
    [
      currentWork?.intent,
      currentWork?.sourceReferences,
      productQuery.data?.store?.brandVoice,
      productQuery.data?.store?.confirmedAt,
    ]
  );
  const groundingMissing =
    currentWork && !currentJob
      ? missingCreativeGrounding(
          productQuery.data,
          currentWork.sourceReferences
        )
      : [];
  const groundingLabels: Record<CreativeGroundingRequirement, () => string> = {
    confirmed_project: creative_grounding_missing_project,
    confirmed_qualification: creative_grounding_missing_qualification,
    confirmed_store: creative_grounding_missing_store,
    real_authorized_asset: creative_grounding_missing_asset,
  };
  const modelSelection = resolveCreationModelSelection({
    catalog: catalog.models,
    currentSelection: currentModelSelections[operation],
    userDefault: preferences.userDefault,
    workspaceDefault: preferences.workspaceDefault,
  });
  const selectedModel = modelSelection?.model;
  const quote = quoteFor(operation, selectedModel, aspectRatio);
  const currentQuoteRevision =
    selectedModel?.unitPrice &&
    catalogQuery.data?.revisionId &&
    quote.priceRevision
      ? creativeQuoteRevision({
          aspectRatio,
          catalogModelId: selectedModel.id,
          catalogRevision: catalogQuery.data.revisionId,
          operation,
          priceRevision: quote.priceRevision,
        })
      : undefined;
  const durationEstimate = durationEstimateView(
    selectedModel?.durationEstimate
  );
  const sourceOptions = useMemo(
    () => [
      ...(inboxQuery.data?.tasks ?? []).slice(0, 3).map((task) => ({
        id: task.id,
        kind: 'task' as const,
        label: workbench_source_task({
          title: taskSystemText(task.title) ?? task.title,
        }),
      })),
      ...(productQuery.data?.assets ?? [])
        .filter((asset) => isContentPackageEligibleAsset(asset))
        .slice(0, 6)
        .map((asset) => ({
          id: asset.id,
          kind: 'asset' as const,
          label: workbench_source_asset({
            title: asset.tags[0] ?? asset.mediaType,
          }),
        })),
    ],
    [inboxQuery.data, productQuery.data]
  );
  const usageResource =
    operation === 'copy.generate'
      ? ('copy' as const)
      : operation === 'image.generate'
        ? ('image' as const)
        : ('video' as const);
  const modelUsage = usageQuery.data
    ? {
        available: usageQuery.data.usage[usageResource].available,
        label: {
          copy: workbench_usage_copy(),
          image: workbench_usage_image(),
          video: workbench_usage_video(),
        }[usageResource],
      }
    : undefined;

  // Small-cost path (copy/image): recommended settings auto-confirm when model
  // + price are ready. Video is high-cost (D-012) and requires explicit accept.
  useEffect(() => {
    const ready =
      Boolean(selectedModel?.available) && Boolean(selectedModel?.unitPrice);
    if (operation === 'video.generate') {
      setQuoteAccepted(false);
      setQuoteAcceptedAt(undefined);
      setVideoApprovalReceiptId(undefined);
      quoteAcceptedAtRef.current = undefined;
      return;
    }
    const acceptedAt = ready ? new Date().toISOString() : undefined;
    setQuoteAccepted(ready);
    setQuoteAcceptedAt(acceptedAt);
    quoteAcceptedAtRef.current = acceptedAt;
    if (ready) {
      emitTelemetry('quote_state', {
        operation,
        state: 'accepted',
      });
    }
  }, [
    selectedModel?.id,
    selectedModel?.available,
    selectedModel?.unitPrice,
    operation,
    aspectRatio,
    contentModules,
    aigcLabelEnabled,
    watermarkEnabled,
  ]);

  useEffect(() => {
    if (!currentWork) return;
    setContentModules(
      currentWork.contentModules?.length
        ? [...currentWork.contentModules]
        : ['social_cover']
    );
  }, [currentWork?.id, currentWork?.updatedAt]);

  useEffect(() => {
    if (!selectedModel) return;
    emitTelemetry('model_selection', {
      availability: selectedModel.available ? 'available' : 'unavailable',
      modelId: selectedModel.id,
      operation,
    });
  }, [operation, selectedModel?.available, selectedModel?.id]);

  useEffect(() => {
    if (
      initialSourceSelectionApplied.current ||
      inboxQuery.isLoading ||
      productQuery.isLoading ||
      sourceOptions.length === 0
    ) {
      return;
    }
    // First visit (no works yet): auto-select eligible sources for create.
    // "New creation" resets the ref and sets showOnboarding=true — re-select then,
    // even though works already exist. Do not preselect while the record stage
    // is open with works and onboarding dismissed.
    if (projection.works.length > 0 && !showOnboarding) {
      return;
    }
    initialSourceSelectionApplied.current = true;
    setSelectedSourceKeys(
      new Set(sourceOptions.map((source) => `${source.kind}:${source.id}`))
    );
  }, [
    inboxQuery.isLoading,
    productQuery.isLoading,
    projection.works.length,
    showOnboarding,
    sourceOptions,
  ]);

  useEffect(() => {
    window.addEventListener('meiye:new-content', resetNewCreationState);
    return () =>
      window.removeEventListener('meiye:new-content', resetNewCreationState);
  }, [resetNewCreationState]);

  useEffect(() => {
    if (!showOnboarding) return;
    const frame = window.requestAnimationFrame(() =>
      intentRef.current?.focus()
    );
    return () => window.cancelAnimationFrame(frame);
  }, [showOnboarding]);

  const refreshProjection = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'canonical_history'),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'content_packages'),
      }),
    ]);
  };

  const selectOperation = useCallback((nextOperation: ModelOperation) => {
    setOperation(nextOperation);
    const defaultAspectRatio = defaultAspectRatioForOperation(nextOperation);
    if (defaultAspectRatio) setAspectRatio(defaultAspectRatio);
  }, []);

  const copyStream = useCopyCandidateStream({
    id: `copy-stream-${currentWork?.id ?? 'idle'}`,
    onError: (error) => {
      copySubmissionKeyRef.current = undefined;
      setCopyStreamInterruption((current) => current ?? 'error');
      const errorCode = streamErrorCode(error);
      if (errorCode === 'CREATIVE_QUOTE_CHANGED') {
        setSubmissionBlocker({ kind: 'quote_changed' });
        toast.error(workbench_quote_changed());
        void refreshProjection();
        return;
      }
      if (
        errorCode === 'INSUFFICIENT_ENTITLEMENT' ||
        errorCode === 'ENTITLEMENT_INSUFFICIENT'
      ) {
        setSubmissionBlocker({ kind: 'quota' });
        toast.error(workbench_quota_insufficient());
        void refreshProjection();
        return;
      }
      setSubmissionBlocker({
        description: error.message.includes(
          'Confirmed Product grounding is incomplete'
        )
          ? creative_grounding_server_blocked()
          : workbench_submit_failed(),
        kind: 'message',
      });
      void refreshProjection();
    },
    onFinish: (result) => {
      copySubmissionKeyRef.current = undefined;
      if (!result) {
        setCopyStreamInterruption((current) => current ?? 'error');
        toast.error(workbench_copy_stream_validation_failed());
        return;
      }
      setCopyStreamInterruption(undefined);
      setSubmissionBlocker(undefined);
      void refreshProjection();
    },
  });

  const acceptQuoteNow = () => {
    const acceptedAt = new Date().toISOString();
    // Write the ref first so same-stack creativeContract() reads the fresh value
    // (setState alone is async and caused CREATIVE_QUOTE race / incomplete contract).
    quoteAcceptedAtRef.current = acceptedAt;
    setQuoteAccepted(true);
    setQuoteAcceptedAt(acceptedAt);
    emitTelemetry('quote_state', {
      operation,
      state: 'accepted',
    });
    return acceptedAt;
  };

  const creativeContract = (acceptedAtOverride?: string) => {
    const acceptedAt =
      acceptedAtOverride ?? quoteAcceptedAtRef.current ?? quoteAcceptedAt;
    if (
      !currentWork ||
      !selectedModel?.unitPrice ||
      !catalogQuery.data?.revisionId ||
      quote.estimatedAmount === undefined ||
      !quote.currency ||
      !quote.priceRevision ||
      !acceptedAt
    ) {
      throw new Error(workbench_contract_incomplete());
    }
    const contract: CreativeExecutionContract = {
      ...workbenchComplianceContractValues({
        aigcLabelEnabled,
        watermarkEnabled,
      }),
      ...(operation === 'video.generate' ? { durationSeconds: 15 } : {}),
      ...(operation !== 'copy.generate' ? { aspectRatio } : {}),
      catalogModelId: selectedModel.id,
      catalogRevision: catalogQuery.data.revisionId,
      contentModules,
      currency: quote.currency,
      dataClass: [],
      estimatedAmount: quote.estimatedAmount,
      operation,
      outputCount: quote.outputCount,
      outputLabel: quote.outputLabel,
      quoteAcceptedAt: acceptedAt,
      quoteRevision: creativeQuoteRevision({
        aspectRatio,
        catalogModelId: selectedModel.id,
        catalogRevision: catalogQuery.data.revisionId,
        operation,
        priceRevision: quote.priceRevision,
      }),
    };
    return { contract, workId: currentWork.id };
  };

  const usageAvailable = modelUsage?.available;
  const usageCost = quote.outputCount;
  const quotaInsufficient =
    typeof usageAvailable === 'number' && usageAvailable < usageCost;

  const ensureQuotaOrBlock = () => {
    if (!quotaInsufficient) return true;
    setSubmissionBlocker({ kind: 'quota' });
    toast.error(workbench_quota_insufficient());
    return false;
  };

  const recordHarnessLaunchFailure = (workId: string, error: unknown) => {
    const kind = harnessLaunchFailureKind(error);
    setHarnessLaunchFailureType(kind);
    setHarnessLaunchFailureWorkId(workId);
    if (kind === 'quota') {
      void queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('entitlements', 'projection'),
      });
      toast.error(workbench_quota_insufficient());
      return;
    }
    if (kind === 'grounding') {
      toast.error(creative_grounding_server_blocked());
      return;
    }
    if (kind === 'authorization') {
      toast.error(workbench_reference_submit_blocked());
      return;
    }
    toast.error(workbench_operation_failed());
  };

  const launchHarnessForWork = async (
    createdWork: CreativeWorkbenchProjection['works'][number],
    existingPackage?: ContentPackage
  ) => {
    let contentPackage = existingPackage;
    if (!contentPackage) {
      const assetIds = createdWork.sourceReferences
        .filter(
          (
            reference
          ): reference is CreativeSourceReference & { kind: 'asset' } =>
            reference.kind === 'asset'
        )
        .map(({ id }) => id);
      contentPackage = await operationsCommand<ContentPackage>(
        'create_content_package',
        {
          kind: 'image_text',
          source: {
            assetIds,
            workflowId: createdWork.id,
            workId: createdWork.id,
          },
        },
        `harness-package-${createdWork.id}`
      );
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'content_packages'),
      });
    }

    const assetReferences = contentPackage.source.assetIds;
    await submitHarnessTask({
      taskId: createdWork.id,
      packageId: contentPackage.id,
      expectedRevision: contentPackage.revision,
      workflowRevision: 1,
      rawInput: createdWork.intent,
      intent: {
        assetReferences,
        context: {
          workId: createdWork.id,
          intent: createdWork.intent,
          sourceSummaries: assistantSourceSummaries({
            assets: (productQuery.data?.assets ?? []).map((asset) => ({
              id: asset.id,
              label: asset.tags[0] ?? asset.mediaType,
            })),
            contents: projection.contents.map((content) => ({
              id: content.id,
              label: content.title,
            })),
            references: createdWork.sourceReferences,
            tasks: (inboxQuery.data?.tasks ?? []).map((task) => ({
              id: task.id,
              label: taskSystemText(task.title) ?? task.title,
            })),
            templates: templateItems.map((template) => ({
              id: template.id,
              label: template.name,
            })),
          }),
        },
      },
    });
    await queryClient.invalidateQueries({
      queryKey: ['harness', 'decision', createdWork.id],
    });
    setHarnessLaunchFailureWorkId(undefined);
    setHarnessLaunchFailureType('retry');
    return true;
  };

  const retryHarnessForCurrentWork = async () => {
    if (!currentWork) return;
    setHarnessLaunchPendingWorkId(currentWork.id);
    try {
      await launchHarnessForWork(currentWork, currentHarnessPackage);
    } catch (error) {
      recordHarnessLaunchFailure(currentWork.id, error);
    } finally {
      setHarnessLaunchPendingWorkId(undefined);
    }
  };

  // D-046: free-text steering in result stage. One revise turn = one derived
  // Work; delivery/approval truth stays on workflow + package revisions.
  const [reviseDirection, setReviseDirection] = useState('');
  const reviseWork = useMutation({
    mutationFn: async (direction: string) => {
      if (!currentWork) throw new Error(workbench_work_required());
      const composed = workbench_revise_intent({
        direction,
        intent: currentWork.intent,
      });
      const overflow = composed.length - 2_000;
      const intent =
        overflow > 0
          ? workbench_revise_intent({
              direction,
              intent: currentWork.intent.slice(
                0,
                Math.max(2, currentWork.intent.length - overflow)
              ),
            })
          : composed;
      const briefField = (field: 'scene' | 'tone' | 'audience') =>
        currentWork.brief?.fields[field]?.current.trim();
      return operationsCommand<CreativeWorkbenchProjection['works'][number]>(
        'derive_creative_work',
        {
          ...autoConfirmedCreativeBrief({
            audience: briefField('audience') || briefDrafts.audience,
            scene: briefField('scene') || briefDrafts.scene,
            tone: briefField('tone') || briefDrafts.tone,
          }),
          contentModules,
          intent,
          sessionId: sessionId(),
          sourceWorkId: currentWork.id,
        },
        `revise-${currentWork.id}-${crypto.randomUUID()}`
      );
    },
    onSuccess: async (derivedWork) => {
      setReviseDirection('');
      if (shouldLaunchAgentHarness(derivedWork.mode, operation)) {
        try {
          await launchHarnessForWork(derivedWork);
        } catch (error) {
          recordHarnessLaunchFailure(derivedWork.id, error);
        }
      }
      await onWorkIdChange?.(derivedWork.id);
      await refreshProjection();
    },
    onError: () => {
      toast.error(workbench_operation_failed());
    },
  });

  const createWork = useMutation({
    mutationFn: () => {
      const excludedAssetIds = new Set([
        ...entryExcludedAssetIds,
        ...readExcludedEntryAssetIds(),
      ]);
      const selectedReferences: CreativeSourceReference[] = sourceOptions
        .filter(
          (source) =>
            selectedSourceKeys.has(`${source.kind}:${source.id}`) &&
            (source.kind !== 'asset' || !excludedAssetIds.has(source.id))
        )
        .map(({ id, kind }) => ({ id, kind }));
      const sourceReferences = [
        ...selectedReferences,
        ...[...entryAssetIds].map(
          (id): CreativeSourceReference => ({ id, kind: 'asset' })
        ),
        ...(selectedPreset
          ? [
              {
                id: selectedPreset.id,
                inheritanceFields: [...DEFAULT_INHERITANCE_FIELDS],
                kind: 'template' as const,
              },
            ]
          : []),
      ].filter(
        (reference, index, references) =>
          references.findIndex(
            (candidate) =>
              candidate.kind === reference.kind && candidate.id === reference.id
          ) === index
      );
      const nextModules = selectedPreset?.defaultContentModules?.length
        ? selectedPreset.defaultContentModules
        : (['social_cover'] as CreativeContentModuleId[]);
      return operationsCommand<CreativeWorkbenchProjection['works'][number]>(
        'create_creative_work',
        {
          ...autoConfirmedCreativeBrief({
            audience: creative_brief_safe_audience_draft(),
            scene: sourceReferences.some(
              (reference) => reference.kind === 'asset'
            )
              ? creative_brief_safe_scene_with_asset_draft()
              : creative_brief_safe_scene_without_asset_draft(),
            tone:
              productQuery.data?.store?.confirmedAt &&
              productQuery.data.store.brandVoice.trim()
                ? productQuery.data.store.brandVoice
                : creative_brief_safe_tone_draft(),
          }),
          contentModules: nextModules,
          intent, // Z1: never overwrite user intent with preset internalIntent
          mode,
          operation,
          sessionId: sessionId(),
          sourceReferences,
        },
        `create-work-${crypto.randomUUID()}`
      );
    },
    onSuccess: async (createdWork) => {
      if (shouldLaunchAgentHarness(createdWork.mode, operation)) {
        try {
          await launchHarnessForWork(createdWork);
        } catch (error) {
          recordHarnessLaunchFailure(createdWork.id, error);
        }
      }
      await queryClient.prefetchQuery({
        queryKey: p1QueryKeys.request('model-supply', 'catalog', {
          operation,
        }),
        queryFn: ({ signal }) =>
          queryP1<RawCatalog>(
            'model-supply',
            { action: 'catalog', payload: { operation } },
            signal
          ),
      });
      await onWorkIdChange?.(createdWork.id);
      await refreshProjection();
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
      setContentModules(
        selectedPreset?.defaultContentModules?.length
          ? [...selectedPreset.defaultContentModules]
          : ['social_cover']
      );
      setShowOnboarding(false);
      toast.success(workbench_work_created());
    },
    onError: () => {
      cancelFirstUsableDraftMeasurement();
      toast.error(workbench_work_create_failed());
    },
  });

  const submitWork = useMutation({
    mutationFn: async (acceptedAtOverride?: string) => {
      const { contract, workId } = creativeContract(acceptedAtOverride);
      return runWithStableSubmissionAttempt(
        'creative-work:submit',
        { contract, workId },
        (idempotencyKey) =>
          operationsCommand<CreativeResult>(
            'submit_creative_work',
            {
              contract,
              submissionKey: idempotencyKey,
              workId,
            },
            idempotencyKey
          )
      );
    },
    onSuccess: async () => {
      setSubmissionBlocker(undefined);
      emitTelemetry('quote_state', { operation, state: 'submitted' });
      await refreshProjection();
    },
    onError: (error) => {
      const errorCode = p1ErrorCode(error);
      const referenceDetails =
        error && typeof error === 'object' && 'details' in error
          ? error.details
          : undefined;
      const referenceFailures = referenceFailuresFromDetails(referenceDetails);
      if (
        referenceFailures.length > 0 ||
        errorCode === 'REFERENCE_ASSET_UNRESOLVED'
      ) {
        setSubmissionBlocker({ details: referenceDetails, kind: 'reference' });
        toast.error(workbench_reference_submit_blocked());
        return;
      }
      if (errorCode === 'CREATIVE_QUOTE_CHANGED') {
        setSubmissionBlocker({ kind: 'quote_changed' });
        toast.error(workbench_quote_changed());
        return;
      }
      if (
        errorCode === 'INSUFFICIENT_ENTITLEMENT' ||
        errorCode === 'ENTITLEMENT_INSUFFICIENT' ||
        (error instanceof Error &&
          /insufficient|allowance|quota/i.test(error.message))
      ) {
        setSubmissionBlocker({ kind: 'quota' });
        toast.error(workbench_quota_insufficient());
        return;
      }
      const description =
        errorCode === 'CREATIVE_GROUNDING_INCOMPLETE' ||
        (error instanceof Error &&
          error.message.includes('Confirmed Product grounding is incomplete'))
          ? creative_grounding_server_blocked()
          : errorCode === 'video_reference_limit'
            ? workbench_reference_multi_not_supported()
            : workbench_submit_failed();
      setSubmissionBlocker({ description, kind: 'message' });
      toast.error(description);
    },
  });

  const submitCopyStream = (acceptedAtOverride?: string) => {
    if (copySubmissionKeyRef.current || copyStream.isLoading) return;
    try {
      setCopyStreamInterruption(undefined);
      setSubmissionBlocker(undefined);
      if (!ensureQuotaOrBlock()) return;
      const { contract, workId } = creativeContract(acceptedAtOverride);
      const submissionKey = `copy-stream-${crypto.randomUUID()}`;
      copySubmissionKeyRef.current = submissionKey;
      copyStream.submit({
        catalogModelId: contract.catalogModelId,
        contract,
        submissionKey,
        workId,
      });
      emitTelemetry('quote_state', { operation, state: 'submitted' });
    } catch {
      toast.error(workbench_contract_check_required());
    }
  };

  useEffect(() => {
    if (
      !quoteRecovery ||
      !quoteRecoveryReady(
        quoteRecovery.previousQuoteRevision,
        currentQuoteRevision,
        quoteRecovery.targetCatalogRevision,
        catalogQuery.data?.revisionId
      )
    ) {
      return;
    }
    setQuoteRecovery(undefined);
    setSubmissionBlocker(undefined);
    const acceptedAt = acceptQuoteNow();
    if (operation === 'copy.generate') {
      submitCopyStream(acceptedAt);
    } else {
      submitWork.mutate(acceptedAt);
    }
  }, [catalogQuery.data?.revisionId, currentQuoteRevision, quoteRecovery]);

  const recoverQuoteChangedAndResubmit = () => {
    if (!currentQuoteRevision || quoteRecovery) return;
    setQuoteRecovery({ previousQuoteRevision: currentQuoteRevision });
    void catalogQuery
      .refetch()
      .then((result) => {
        if (!result.data?.revisionId) throw new Error('Quote refresh failed.');
        setQuoteRecovery((current) =>
          current
            ? {
                ...current,
                targetCatalogRevision: result.data.revisionId,
              }
            : current
        );
      })
      .catch(() => {
        setQuoteRecovery(undefined);
      });
  };

  const insertReference = useMutation({
    mutationFn: async (reference: CreativeSourceReference) => {
      if (!currentWork) throw new Error(workbench_work_required());
      if (
        currentWork.sourceReferences.some(
          (item) => item.id === reference.id && item.kind === reference.kind
        )
      ) {
        return { outcome: 'already_present' as const };
      }
      const derivedWork = await operationsCommand<
        CreativeWorkbenchProjection['works'][number]
      >(
        'derive_creative_work',
        {
          intent: currentWork.intent,
          contentModules,
          sessionId: currentWork.sessionId,
          sourceReferences: [reference],
          sourceWorkId: currentWork.id,
        },
        `insert-reference-${currentWork.id}-${reference.kind}-${reference.id}`
      );
      return { outcome: 'derived' as const, work: derivedWork };
    },
    onSuccess: async (result) => {
      if (result.outcome === 'already_present') {
        toast.info(workbench_source_already_present());
        return;
      }
      await onWorkIdChange?.(result.work.id);
      await refreshProjection();
      toast.success(workbench_source_inserted());
    },
    onError: () => toast.error(workbench_source_insert_failed()),
  });

  const updateDraft = useMutation({
    mutationFn: (nextModules: CreativeContentModuleId[]) => {
      if (!currentWork) throw new Error(workbench_work_required());
      return operationsCommand(
        'update_creative_work_draft',
        {
          contentModules: nextModules,
          workId: currentWork.id,
        },
        `update-creative-draft-${currentWork.id}-${crypto.randomUUID()}`
      );
    },
    onSuccess: async () => {
      await refreshProjection();
    },
    onError: () => {
      setContentModules(
        currentWork?.contentModules?.length
          ? [...currentWork.contentModules]
          : ['social_cover']
      );
      toast.error(workbench_modules_save_failed());
    },
  });

  const briefCommand = useMutation({
    mutationFn: async (
      input:
        | { kind: 'confirm' }
        | { kind: 'update'; update: CreativeBriefUpdate }
    ) => {
      if (!currentWork) throw new Error(workbench_work_required());
      if (input.kind === 'confirm') {
        return operationsCommand(
          'confirm_creative_work_brief',
          { workId: currentWork.id },
          `confirm-creative-brief-${currentWork.id}-${crypto.randomUUID()}`
        );
      }
      return operationsCommand(
        'update_creative_work_brief',
        { ...input.update, workId: currentWork.id },
        `update-creative-brief-${currentWork.id}-${input.update.field}-${crypto.randomUUID()}`
      );
    },
    onSuccess: refreshProjection,
    onError: () => {
      setBriefAutoConfirming(false);
      toast.error(workbench_operation_failed());
    },
  });

  // T1 · 0-click Brief: when core has not auto-confirmed at create time,
  // adopt missing AI drafts once and confirm without merchant clicks.
  useEffect(() => {
    if (!currentWork || currentWork.brief?.confirmedAt) {
      if (currentWork?.brief?.confirmedAt) setBriefAutoConfirming(false);
      return;
    }
    if (briefAutoConfirmWorkIdRef.current === currentWork.id) return;
    if (briefCommand.isPending) return;
    const missing = missingBriefAdoptFields(currentWork.brief, briefDrafts);
    // Intent draft is required for confirm; skip until we have one.
    if (!currentWork.brief?.fields.intent && !briefDrafts.intent.trim()) {
      return;
    }
    briefAutoConfirmWorkIdRef.current = currentWork.id;
    setBriefAutoConfirming(true);
    void (async () => {
      try {
        for (const item of missing) {
          await briefCommand.mutateAsync({
            kind: 'update',
            update: {
              action: 'adopt',
              aiDraft: item.aiDraft,
              field: item.field,
            },
          });
        }
        await briefCommand.mutateAsync({ kind: 'confirm' });
      } catch {
        // Error toast handled by mutation; allow a later retry after refresh.
        briefAutoConfirmWorkIdRef.current = undefined;
      } finally {
        setBriefAutoConfirming(false);
      }
    })();
  }, [
    briefCommand.isPending,
    briefDrafts,
    currentWork?.brief,
    currentWork?.id,
  ]);

  const executionControlsBusy =
    submitWork.isPending || copyStream.isLoading || briefCommand.isPending;
  const currentCopyCandidateModel =
    currentJob?.contract.operation === 'copy.generate'
      ? buildCopyCandidateSelectorModel({
          assets: currentAssets,
          contents: currentContents,
          job: currentJob,
          packages: contentPackages,
        })
      : undefined;
  const hasPersistedResult =
    currentJob?.status === 'completed' &&
    (currentJob.contract.operation === 'copy.generate'
      ? currentCopyCandidateModel?.status !== 'invalid'
      : currentAssets.length > 0 || currentContents.length > 0);
  const hasHarnessResult = Boolean(currentHarnessPackage?.currentVersionId);
  const compactHarnessResult = currentHarnessPackage
    ? compactDeliveredCopyResult(currentHarnessPackage)
    : null;
  const harnessCandidateResult = currentHarnessPackage
    ? harnessCandidateResultModel(currentHarnessPackage)
    : null;
  const harnessWorkflowStream = useWorkflowEventStream({
    enabled: Boolean(
      currentWork?.mode === 'agent' &&
        currentHarnessPackage &&
        !hasHarnessResult
    ),
    latestQueryKey: p1QueryKeys.request('operations', 'content_packages'),
    workflowId: currentWork?.id ?? '',
    workflowQueryKey: ['harness', 'workflow', currentWork?.id ?? 'idle'],
  });
  const harnessCopyCandidates = harnessWorkflowStream.copyCandidates;
  const harnessPrimaryCandidate = harnessCopyCandidates[0];
  const harnessAlternativeCandidates = harnessCopyCandidates.slice(1);
  const hasFirstUsableDraftToken =
    harnessCopyCandidates.some((candidate) => candidateHasToken(candidate)) ||
    Boolean(
      copyStream.object?.candidates?.some((candidate) =>
        candidateHasToken(candidate)
      )
    );
  useEffect(() => {
    if (!currentWork || !hasFirstUsableDraftToken) return;
    const metric = finishFirstUsableDraftMeasurement();
    if (!metric) return;
    void recordFirstUsableDraftMetric(currentWork.id, {
      idempotencyKey: `first-usable-draft-v1:${currentWork.id}`,
      ...metric,
    }).catch(() => {
      // Product telemetry is best-effort at the browser boundary. The Core
      // audit + Langfuse outbox remain durable once this request is accepted.
    });
  }, [currentWork?.id, hasFirstUsableDraftToken]);
  // Honest status: a suspended workflow is waiting on the merchant, not
  // drafting — never show the "drafting your copy" label while blocked.
  const harnessAwaitingUser =
    harnessCopyStreamPhase(harnessWorkflowStream.latestProgress?.state) ===
    'awaiting_confirmation';
  const harnessCopyStreamLabel = harnessAwaitingUser
    ? workbench_harness_copy_awaiting()
    : workbench_harness_copy_streaming();
  const harnessStreaming =
    Boolean(
      currentWork?.mode === 'agent' &&
        currentHarnessPackage &&
        !hasHarnessResult
    ) &&
    (harnessWorkflowStream.transportStatus === 'open' ||
      harnessWorkflowStream.transportStatus === 'connecting' ||
      harnessCopyCandidates.length > 0);
  const workbenchStage: WorkbenchStage = hasHarnessResult
    ? 'result'
    : currentHarnessPackage
      ? 'running'
      : hasPersistedResult
        ? 'result'
        : executionControlsBusy || currentJob
          ? 'running'
          : 'empty';
  const showDetailsDrawer =
    workbenchStage === 'running' || workbenchStage === 'result';

  const command = useMutation({
    mutationFn: (input: {
      action: string;
      payload: Record<string, unknown>;
      key: string;
    }) => operationsCommand(input.action, input.payload, input.key),
    onSuccess: async (result, input) => {
      if (
        input.action === 'resume_creative_job' ||
        input.action === 'retry_creative_job'
      ) {
        emitTelemetry('recovery_action', {
          action: input.action,
          objectKind: 'creative_job',
          outcome: 'succeeded',
        });
      }
      if (
        input.action === 'derive_creative_work' &&
        result &&
        typeof result === 'object' &&
        'id' in result &&
        typeof result.id === 'string'
      ) {
        await onWorkIdChange?.(result.id);
      }
      if (input.action === 'attach_content_package_generation') {
        toast.success(workbench_result_attached_to_content());
      }
      await refreshProjection();
    },
    onError: (_error, input) => {
      if (
        input.action === 'resume_creative_job' ||
        input.action === 'retry_creative_job'
      ) {
        emitTelemetry('recovery_action', {
          action: input.action,
          objectKind: 'creative_job',
          outcome: 'failed',
        });
      }
      toast.error(workbench_operation_failed());
    },
  });
  const imageAttachmentTarget =
    currentWork && currentJob?.contract.operation === 'image.generate'
      ? contentPackageGenerationAttachmentTarget({
          contentPackages,
          currentWork,
          works: projection.works,
        })
      : undefined;
  const imageAttachmentCompleted = Boolean(
    imageAttachmentTarget &&
      currentJob &&
      imageAttachmentTarget.generated.childRuns.some(
        (childRun) => childRun.runId === currentJob.id
      ) &&
      currentAssets.every((asset) =>
        imageAttachmentTarget.generated.assetIds.includes(asset.id)
      )
  );
  const imageAttachmentCommand =
    imageAttachmentTarget &&
    currentJob?.status === 'completed' &&
    currentAssets.length > 0 &&
    !imageAttachmentCompleted
      ? createContentPackageGenerationAttachmentCommand({
          assetIds: currentAssets.map((asset) => asset.id),
          expectedRevision: imageAttachmentTarget.revision,
          job: currentJob,
          packageId: imageAttachmentTarget.id,
        })
      : undefined;

  const uploadComposerImage = async (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => {
    const body = new FormData();
    body.append('file', file);
    body.append('uploadId', identity.uploadId);
    body.append('contentHash', identity.contentHash);
    const receipt = await uploadProductAsset({ data: body });
    const result = await executeProductCommand(
      {
        asset: {
          category: facts.category,
          consentScope: 'internal_only',
          containsPerson: facts.containsPerson,
          containsSensitiveData: facts.containsSensitiveData,
          id: identity.assetId,
          mediaType: 'image',
          minorStatus: facts.minorStatus,
          objectKey: receipt.key,
          rightsOwner:
            productQuery.data?.store?.name ??
            productQuery.data?.workspaceId ??
            identity.assetId,
          sourceType: 'real',
          tags: file.name.trim() ? [file.name.slice(0, 40)] : [],
        },
        type: 'add_asset',
      },
      `composer-asset-${identity.contentHash}`
    );
    if (facts.consentScope === 'internal_only') {
      queryClient.setQueryData(['product', 'creative-sources'], result.state);
      return { attached: false };
    }
    const authorized = await executeProductCommand(
      {
        assetId: identity.assetId,
        consentScope: facts.consentScope,
        rightsEvidence: facts.rightsEvidence,
        rightsNoFixedExpiry: facts.rightsNoFixedExpiry,
        rightsPlatforms: facts.rightsPlatforms,
        rightsValidUntil: facts.rightsValidUntil,
        type: 'authorize_asset',
      },
      `composer-asset-${identity.contentHash}-authorize`
    );
    queryClient.setQueryData(['product', 'creative-sources'], authorized.state);
    return { attached: true };
  };

  const authorizeComposerImage = async (
    assetId: string,
    facts: ConfirmedAssetFacts
  ) => {
    if (facts.consentScope !== 'public_marketing') return;
    const currentAsset = productQuery.data?.assets.find(
      (asset) => asset.id === assetId
    );
    const authorized = await executeAssetAuthorization(
      (command) =>
        executeProductCommand(
          command,
          `composer-asset-${assetId}-${command.type}-${crypto.randomUUID()}`
        ),
      composerAssetAuthorizationDraft({
        assetId,
        currentAsset,
        facts,
        fallbackRightsOwner:
          productQuery.data?.store?.name ??
          productQuery.data?.workspaceId ??
          assetId,
      })
    );
    queryClient.setQueryData(['product', 'creative-sources'], authorized.state);
  };

  const exampleEligibility = exampleStoreVisibility({
    assetCount:
      (productQuery.data?.assets.length ?? 0) + projection.assets.length,
    contentCount: unifiedCreationWorkbenchContentCount(
      productQuery.data?.contents ?? [],
      projection.contents,
      contentPackages
    ),
    hidden: false,
    queriesReady:
      projectionQuery.isSuccess &&
      inboxQuery.isSuccess &&
      productQuery.isSuccess &&
      contentPackagesQuery.isSuccess,
    taskCount: inboxQuery.data?.tasks.length ?? 0,
    workCount: projection.works.length,
  });
  const exampleVisibility = exampleOpened ? exampleEligibility : 'hidden';

  const onboardingVisible =
    showOnboarding ||
    (projection.works.length === 0 &&
      (Boolean(pendingAction) ||
        (!skipped && !onboardingDismissed) ||
        exampleVisibility === 'visible'));
  const projectionPreparing = isWorkbenchProjectionPreparing(
    projectionQuery.data !== undefined,
    projectionQuery.isPending
  );
  const projectionFailure =
    projectionQuery.isError && projectionQuery.data === undefined
      ? friendlyProductError(
          projectionQuery.error,
          workbench_projection_failure_description()
        )
      : undefined;
  const catalogFailure = catalogQuery.isError
    ? friendlyProductError(
        catalogQuery.error,
        workbench_catalog_failure_description()
      )
    : undefined;
  const sourceFailure = productQuery.isError
    ? friendlyProductError(
        productQuery.error,
        workbench_source_failure_description()
      )
    : undefined;
  const inboxFailure = inboxQuery.isError
    ? friendlyProductError(
        inboxQuery.error,
        workbench_inbox_failure_description()
      )
    : undefined;
  const availableContentModules = currentPreset?.availableContentModules ?? [
    'social_cover',
  ];
  const operationsRail =
    inboxQuery.data && !inboxQuery.isError ? (
      <OperationsRail inbox={inboxQuery.data} />
    ) : (
      <aside aria-label={operations_rail_aria()}>
        <StatePanel
          kind={inboxQuery.isError ? 'error' : 'loading'}
          title={
            inboxQuery.isError
              ? workbench_inbox_failure_title()
              : workbench_inbox_loading_title()
          }
          description={
            inboxFailure?.description ?? workbench_inbox_description()
          }
          actionLabel={inboxFailure ? workbench_reload_inbox() : undefined}
          onAction={inboxFailure ? () => void inboxQuery.refetch() : undefined}
        />
      </aside>
    );
  const recordVisible = Boolean(
    !projectionFailure &&
      !projectionPreparing &&
      !onboardingVisible &&
      currentWork
  );
  const heroVisible =
    onboardingVisible && !projectionFailure && !projectionPreparing;
  const greetingName = workbenchGreetingName(
    productQuery.data?.store?.name,
    productQuery.data?.storeDraft?.extracted?.name,
    accountNameQuery.data
  );

  return (
    <>
      {!heroVisible ? (
        <DashboardHeader
          breadcrumbs={[
            { label: product_navigation_workbench(), isCurrentPage: true },
          ]}
          actions={<Badge variant="outline">{workbench_header_badge()}</Badge>}
        />
      ) : null}
      {heroVisible ? (
        <section className="relative -mb-24 h-72 sm:h-80">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-neutral-900 bg-[url(/seed/hero/hero-ambient.webp)] bg-cover bg-center"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/5 to-surface-0"
          />
          <h1 className="relative mx-auto w-full max-w-3xl px-4 pt-14 text-center text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight font-extralight text-white [text-wrap:balance]">
            {greetingName
              ? workbench_greeting({ name: greetingName })
              : workbench_greeting_fallback()}
          </h1>
        </section>
      ) : null}
      <div
        data-layer={heroVisible ? 'sticky' : undefined}
        className={cn(
          'mx-auto w-full flex-1 px-4 lg:px-8',
          heroVisible
            ? 'relative max-w-3xl pb-6'
            : 'grid max-w-7xl gap-6 py-6 xl:grid-cols-[minmax(0,1fr)_300px]'
        )}
      >
        {!heroVisible ? (
          recordVisible && workbenchStage === 'empty' ? (
            <div className="flex flex-wrap items-center justify-end gap-3 xl:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetNewCreationState}
              >
                {workbench_new_creation()}
              </Button>
            </div>
          ) : !recordVisible ? (
            <div className="flex flex-wrap items-start justify-between gap-4 xl:col-span-2">
              <div className="meiye-ambient-copy">
                <h1 className="meiye-type-title">{workbench_title()}</h1>
                <p className="meiye-type-aux mt-2 max-w-2xl">
                  {workbench_description()}
                </p>
              </div>
            </div>
          ) : null
        ) : null}

        {projectionFailure ? (
          <StatePanel
            kind="error"
            title={workbench_projection_failure_title()}
            description={projectionFailure.description}
            actionLabel={workbench_reload()}
            onAction={() => void projectionQuery.refetch()}
          />
        ) : null}
        {!projectionFailure && projectionPreparing ? (
          <div data-testid="workbench-projection-preparing">
            <StatePanel
              kind="loading"
              title={workbench_loading_title()}
              description={workbench_loading_description()}
            />
          </div>
        ) : projectionFailure || onboardingVisible ? (
          <div className="space-y-4">
            {productQuery.isLoading ? (
              <StatePanel
                kind="loading"
                title={workbench_sources_loading_title()}
                description={workbench_sources_loading_description()}
              />
            ) : sourceFailure ? (
              <StatePanel
                actionLabel={workbench_reload_sources()}
                description={sourceFailure.description}
                kind="error"
                onAction={() => void productQuery.refetch()}
                title={workbench_sources_failure_title()}
              />
            ) : null}
            {inboxFailure ? (
              <StatePanel
                actionLabel={workbench_reload_tasks()}
                description={inboxFailure.description}
                kind="error"
                onAction={() => void inboxQuery.refetch()}
                title={workbench_tasks_failure_title()}
              />
            ) : null}
            <TodayRecommendationCard
              onStart={() =>
                window.requestAnimationFrame(() => intentRef.current?.focus())
              }
            />
            <CreationEntry
              assistedScreenshotAssetIds={[...entryAssetIds]}
              assistedStoreId={productQuery.data?.workspaceId ?? ''}
              assetSignals={(productQuery.data?.assets ?? []).map((asset) => ({
                id: asset.id,
                label: asset.tags[0] ?? workbench_store_asset(),
              }))}
              createPending={createWork.isPending || Boolean(projectionFailure)}
              intent={intent}
              intentRef={intentRef}
              marketingEntryCapabilities={productionMarketingEntryCapabilities()}
              mode={mode}
              operation={
                operation === 'video.generate'
                  ? 'video.generate'
                  : 'copy.generate'
              }
              onCreate={() => {
                beginFirstUsableDraftMeasurement();
                createWork.mutate();
              }}
              onConfirmAssistedFact={(payload) =>
                commandP1(
                  'asset-memory',
                  { action: 'confirm_asset_intake_fact', payload },
                  `confirm-assisted-${payload.batchId}`
                )
              }
              onIntentChange={updateIntent}
              onModeChange={setMode}
              onOperationChange={selectOperation}
              onPresetChange={setSelectedPresetId}
              onPrepareAssistedPriceIntake={(payload) =>
                commandP1(
                  'asset-memory',
                  { action: 'prepare_assisted_price_intake', payload },
                  `prepare-assisted-${payload.batchId}`
                )
              }
              onSkip={() => {
                setShowOnboarding(false);
                setOnboardingDismissed(true);
                command.mutate(
                  {
                    action: 'record_onboarding_skip',
                    key: 'onboarding-skip-v1',
                    payload: {},
                  },
                  {
                    onError: () => setOnboardingDismissed(false),
                  }
                );
              }}
              onSourceToggle={(key) => {
                setSelectedSourceKeys((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              onUpload={uploadComposerImage}
              onUploadAuthorize={authorizeComposerImage}
              onUploadAssetAdded={(assetId) => {
                setEntryAssetIds((current) => new Set(current).add(assetId));
                setEntryExcludedAssetIds((current) => {
                  const next = new Set(current);
                  next.delete(assetId);
                  writeExcludedEntryAssetIds(next);
                  return next;
                });
              }}
              onUploadAssetRemoved={(assetId) => {
                setEntryAssetIds((current) => {
                  const next = new Set(current);
                  next.delete(assetId);
                  return next;
                });
                setEntryExcludedAssetIds((current) => {
                  const next = new Set(current).add(assetId);
                  writeExcludedEntryAssetIds(next);
                  return next;
                });
                setSelectedSourceKeys((current) => {
                  const next = new Set(current);
                  next.delete(`asset:${assetId}`);
                  return next;
                });
              }}
              onUploadQueueChange={setEntryUploads}
              presets={namedPresets}
              quotaBlocked={quotaInsufficient}
              quotaLine={
                typeof usageAvailable === 'number'
                  ? workbench_quota_line({
                      available: usageAvailable,
                      cost: usageCost,
                    })
                  : undefined
              }
              selectedPresetId={selectedPresetId}
              selectedSourceKeys={selectedSourceKeys}
              sourceOptions={sourceOptions}
              taskSignals={(inboxQuery.data?.tasks ?? []).map((task) => ({
                id: task.id,
                title: taskSystemText(task.title) ?? task.title,
              }))}
              uploadsReady={canCreateFromUploads(entryUploads)}
            />
            {quotaInsufficient ? (
              <div
                className="meiye-porcelain space-y-3 rounded-2xl border border-destructive/20 p-4"
                data-testid="day0-quota-blocker"
                role="alert"
              >
                <p className="text-sm font-medium">
                  {workbench_quota_insufficient()}
                </p>
                <p className="text-sm text-muted-foreground">
                  {workbench_quota_insufficient_description()}
                </p>
                {typeof usageAvailable === 'number' ? (
                  <p className="text-xs text-muted-foreground">
                    {workbench_quota_line({
                      available: usageAvailable,
                      cost: usageCost,
                    })}
                  </p>
                ) : null}
                <Link
                  className="inline-flex text-sm font-medium underline underline-offset-4"
                  to="/settings/credits"
                >
                  {workbench_quota_open_plans()}
                </Link>
              </div>
            ) : null}
            {exampleVisibility === 'visible' &&
            productQuery.data?.exampleStore ? (
              <div className="meiye-porcelain rounded-2xl px-5 pb-5 sm:px-6">
                <ExampleStorePreview
                  example={productQuery.data.exampleStore}
                  hiding={false}
                  onHide={() => setExampleOpened(false)}
                  onRemix={(nextIntent) => {
                    setSelectedPresetId(undefined);
                    updateIntent(nextIntent);
                    window.requestAnimationFrame(() =>
                      intentRef.current?.focus()
                    );
                  }}
                />
              </div>
            ) : null}
            {exampleEligibility === 'visible' && !exampleOpened ? (
              <div className="text-center">
                <Button
                  onClick={() => setExampleOpened(true)}
                  type="button"
                  variant="ghost"
                >
                  {workbench_show_example()}
                </Button>
              </div>
            ) : null}
          </div>
        ) : !currentWork ? (
          <WarmEmptyState
            action={
              <Button type="button" onClick={() => setShowOnboarding(true)}>
                {workbench_start_first_creation()}
              </Button>
            }
            description={workbench_empty_description()}
            media={<IconSparkles />}
            title={workbench_empty_title()}
          />
        ) : (
          <WorkbenchStageShell
            articleLabel={
              currentWork.mode === 'agent'
                ? workbench_record_aria()
                : workbench_record_direct_aria()
            }
            jobCount={projection.jobs.length}
            rail={operationsRail}
            stage={workbenchStage}
          >
            <WorkbenchPrimarySurface sticky={workbenchStage !== 'empty'}>
              {operation === 'copy.generate' &&
              currentWork.mode === 'agent' &&
              !hasHarnessResult &&
              (harnessPrimaryCandidate || harnessStreaming) ? (
                <RecordSection
                  hero
                  testId="workbench-result-stream"
                  title={workbench_section_results()}
                >
                  <p className="text-sm text-muted-foreground">
                    运行态已迁移至结果中心。
                  </p>
                  <a
                    className="inline-flex min-h-touch-target items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                    data-testid="workbench-open-result-center-stream"
                    href={resultCenterPath(currentWork.id)}
                  >
                    打开结果中心
                  </a>
                </RecordSection>
              ) : null}

              {operation === 'copy.generate' &&
              shouldShowCopyStreamPanel({
                completed: currentJob?.status === 'completed',
                hasError: Boolean(copyStream.error),
                hasObject: Boolean(copyStream.object),
                interrupted: Boolean(copyStreamInterruption),
                loading: copyStream.isLoading,
              }) ? (
                <RecordSection
                  roseGlow={copyStream.isLoading}
                  title={workbench_stream_title()}
                >
                  <div className="space-y-3">
                    <CopyCandidateStream
                      candidates={copyStream.object?.candidates?.map(
                        (candidate) => candidate ?? {}
                      )}
                      streaming={copyStream.isLoading}
                    />
                    {copyStream.isLoading ? (
                      <Button
                        onClick={() => {
                          copySubmissionKeyRef.current = undefined;
                          setCopyStreamInterruption('stopped');
                          copyStream.stop();
                        }}
                        type="button"
                        variant="outline"
                      >
                        {workbench_stop_stream()}
                      </Button>
                    ) : null}
                    {copyStream.error || copyStreamInterruption ? (
                      <div className="space-y-2" role="alert">
                        <p className="text-sm text-destructive">
                          {copyStreamInterruption === 'stopped'
                            ? workbench_stream_stopped()
                            : workbench_stream_interrupted()}{' '}
                          {workbench_stream_guardrail()}
                        </p>
                        {!copyStream.isLoading ? (
                          <Button
                            onClick={() => submitCopyStream()}
                            type="button"
                            variant="outline"
                          >
                            {workbench_resubmit_stream()}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </RecordSection>
              ) : null}

              {submitWork.isPending && operation === 'image.generate' ? (
                <RecordSection roseGlow title={workbench_progress_title()}>
                  <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
                    <ProductStatus
                      announce
                      showExplanation
                      status="submitting"
                    />
                    <GenerationAccent label={workbench_submitting_accent()} />
                    <div>
                      <p className="font-medium">
                        {workbench_submitting_title()}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedModel?.displayName ??
                          workbench_selected_model()}{' '}
                        · {quote.outputLabel}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {workbench_progress_help()}
                      </p>
                    </div>
                  </div>
                </RecordSection>
              ) : currentJob && !hasPersistedResult ? (
                <RecordSection
                  roseGlow={['submitting', 'running'].includes(
                    currentJobObserver.status ?? currentJob.status
                  )}
                  title={workbench_progress_title()}
                >
                  <div className="space-y-3 rounded-md bg-surface-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="mt-1 text-sm">
                          {workbench_expected_output({
                            output: creativeOutputLabel(
                              currentJob.contract.operation,
                              currentJob.contract.outputCount,
                              currentJob.contract.aspectRatio
                            ),
                          })}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {workbench_progress_help()}
                        </p>
                      </div>
                      <ProductStatus
                        announce
                        showExplanation
                        status={currentJobObserver.status ?? currentJob.status}
                      />
                    </div>
                    {['submitting', 'running'].includes(
                      currentJobObserver.status ?? currentJob.status
                    ) ? (
                      <GenerationAccent
                        label={
                          currentJob.contract.operation === 'video.generate'
                            ? workbench_generating_video()
                            : workbench_generating_content()
                        }
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {currentJob.status === 'recoverable' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            command.mutate({
                              action: 'resume_creative_job',
                              key: `resume-${currentJob.id}-${crypto.randomUUID()}`,
                              payload: { jobId: currentJob.id },
                            })
                          }
                        >
                          {workbench_resume_job()}
                        </Button>
                      ) : null}
                      {(currentJob.status === 'unknown' ||
                        currentJob.status === 'running') &&
                      !currentJobObserver.enabled ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            command.mutate({
                              action: 'resume_creative_job',
                              key: `verify-${currentJob.id}-${crypto.randomUUID()}`,
                              payload: { jobId: currentJob.id },
                            })
                          }
                        >
                          <ProductIcon icon={IconRefresh} size={16} />
                          {currentJob.status === 'unknown'
                            ? workbench_verify_only()
                            : workbench_verify_job()}
                        </Button>
                      ) : null}
                      {currentJobObserver.error ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void currentJobObserver.refetch();
                            void currentJobObserver.retryRecovery();
                          }}
                        >
                          <ProductIcon icon={IconRefresh} size={16} />
                          {workbench_retry_updates()}
                        </Button>
                      ) : null}
                      {currentJob.status === 'failed' ? (
                        <div className="space-y-2">
                          <CreativeJobFailureNotice
                            currentAssets={productQuery.data?.assets ?? []}
                            job={currentJob}
                            sourceAssetIds={currentWork.sourceReferences
                              .filter((source) => source.kind === 'asset')
                              .map((source) => source.id)}
                          />
                          <p className="text-xs text-muted-foreground">
                            {workbench_technical_failure_usage()}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              command.mutate({
                                action: 'retry_creative_job',
                                key: `retry-command-${crypto.randomUUID()}`,
                                payload: {
                                  jobId: currentJob.id,
                                  submissionKey: `retry-${crypto.randomUUID()}`,
                                },
                              })
                            }
                          >
                            {workbench_regenerate()}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {currentJobObserver.error ? (
                      <p className="text-sm text-destructive">
                        {workbench_updates_failed()}
                      </p>
                    ) : null}
                  </div>
                </RecordSection>
              ) : null}

              {workbenchStage === 'result' || workbenchStage === 'running' ? (
                <RecordSection
                  hero
                  testId="workbench-result-retired"
                  title={workbench_section_results()}
                >
                  <p className="text-sm text-muted-foreground">
                    结果已迁移至结果中心。
                  </p>
                  {currentWork ? (
                    <a
                      className="inline-flex min-h-touch-target items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                      data-testid="workbench-open-result-center"
                      href={resultCenterPath(currentWork.id)}
                    >
                      打开结果中心
                    </a>
                  ) : null}
                </RecordSection>
              ) : null}
            </WorkbenchPrimarySurface>

            <WorkbenchStatusStrip>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="meiye-type-body truncate font-medium">
                  {currentDisplay?.title ?? currentWork.intent}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {currentJob ? (
                    <ProductStatus
                      announce={false}
                      status={currentJobObserver.status ?? currentJob.status}
                    />
                  ) : (
                    <ProductStatus announce={false} status="draft" />
                  )}
                  {currentWork.derivedFrom ? (
                    <span className="text-xs text-muted-foreground">
                      {workbench_derived_work()}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DeviceRelayPopover
                  target={{ kind: 'work', workId: currentWork.id }}
                />
                {workbenchStage === 'result' ? (
                  <Button
                    onClick={() => resetNewCreationState()}
                    size="sm"
                    type="button"
                  >
                    {workbench_new_creation()}
                  </Button>
                ) : null}
              </div>
            </WorkbenchStatusStrip>

            <WorkbenchComposerAxis sticky={workbenchStage === 'empty'}>
              {shouldLaunchAgentHarness(currentWork.mode, operation) ? (
                <>
                  <HarnessQuestionCard
                    onMissing={() => {
                      setHarnessLaunchFailureType('retry');
                      setHarnessLaunchFailureWorkId(currentWork.id);
                    }}
                    taskId={currentWork.id}
                  />
                  {harnessLaunchFailureWorkId === currentWork.id ? (
                    <div
                      className="meiye-porcelain space-y-3 rounded-2xl border border-destructive/20 p-5"
                      data-testid={
                        harnessLaunchFailureType === 'quota'
                          ? 'harness-quota-blocker'
                          : harnessLaunchFailureType === 'grounding'
                            ? 'harness-grounding-blocker'
                            : harnessLaunchFailureType === 'authorization'
                              ? 'harness-authorization-blocker'
                              : 'harness-retry-blocker'
                      }
                      role="alert"
                    >
                      <p className="text-sm font-medium text-destructive">
                        {harnessLaunchFailureType === 'quota'
                          ? workbench_quota_insufficient()
                          : harnessLaunchFailureType === 'grounding'
                            ? creative_grounding_server_blocked()
                            : harnessLaunchFailureType === 'authorization'
                              ? workbench_reference_submit_blocked()
                              : workbench_updates_failed()}
                      </p>
                      {harnessLaunchFailureType === 'quota' ? (
                        <>
                          <p className="text-sm text-muted-foreground">
                            {workbench_quota_insufficient_description()}
                          </p>
                          <Link
                            className="inline-flex text-sm font-medium underline underline-offset-4"
                            to="/settings/credits"
                          >
                            {workbench_quota_open_plans()}
                          </Link>
                        </>
                      ) : null}
                      {harnessLaunchFailureType === 'grounding' ? (
                        <div className="flex flex-wrap gap-3 text-sm">
                          <Link
                            className="font-medium underline underline-offset-4"
                            to="/dashboard/store"
                          >
                            {creative_grounding_open_store()}
                          </Link>
                          <Link
                            className="font-medium underline underline-offset-4"
                            to="/dashboard/assets"
                          >
                            {creative_grounding_open_assets()}
                          </Link>
                        </div>
                      ) : null}
                      {harnessLaunchFailureType === 'authorization' ? (
                        <Link
                          className="inline-flex text-sm font-medium underline underline-offset-4"
                          to="/dashboard/assets"
                        >
                          {creative_grounding_open_assets()}
                        </Link>
                      ) : null}
                      <Button
                        disabled={harnessLaunchPendingWorkId === currentWork.id}
                        onClick={() => void retryHarnessForCurrentWork()}
                        type="button"
                        variant="outline"
                      >
                        <ProductIcon icon={IconRefresh} size={16} />
                        {workbench_retry_updates()}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {showDetailsDrawer ? (
                <Collapsible onOpenChange={setDetailsOpen} open={detailsOpen}>
                  <div className="meiye-porcelain rounded-2xl">
                    <CollapsibleTrigger
                      className="flex min-h-touch-target w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium"
                      data-testid="workbench-details-drawer"
                    >
                      <span>{workbench_details_drawer()}</span>
                      <IconChevronDown aria-hidden="true" className="size-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 border-t border-[oklch(0_0_0/0.06)] px-5 pb-5 pt-4">
                      <CreativeBriefEditor
                        autoConfirming={briefAutoConfirming}
                        brief={currentWork.brief}
                        busy={briefCommand.isPending || executionControlsBusy}
                        drafts={briefDrafts}
                        onConfirm={async () => {
                          await briefCommand.mutateAsync({ kind: 'confirm' });
                        }}
                        onUpdate={async (update) => {
                          await briefCommand.mutateAsync({
                            kind: 'update',
                            update,
                          });
                        }}
                      />
                      <p className="text-sm text-muted-foreground">
                        {workbench_settings_summary({
                          model:
                            selectedModel?.displayName ??
                            workbench_model_not_selected(),
                          output: quote.outputLabel,
                          price:
                            quote.estimatedAmount !== undefined &&
                            quote.currency
                              ? merchantUsageQuoteLabel(operation)
                              : workbench_quote_missing_short(),
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {workbench_compliance_summary({
                          aigc: aigcLabelEnabled
                            ? workbench_switch_on()
                            : workbench_switch_off(),
                          watermark: watermarkEnabled
                            ? workbench_switch_on()
                            : workbench_switch_off(),
                        })}
                      </p>
                      {typeof usageAvailable === 'number' ? (
                        <p className="text-xs text-muted-foreground">
                          {workbench_quota_line({
                            available: usageAvailable,
                            cost: usageCost,
                          })}
                        </p>
                      ) : null}
                      <Button
                        onClick={revealModelPicker}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {workbench_view_model_details()}
                      </Button>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ) : null}

              <RecordSection
                className={workbenchStage === 'empty' ? undefined : 'hidden'}
                title={workbench_section_composer()}
              >
                <div className="space-y-5">
                  <CreationModePicker
                    disabled={executionControlsBusy}
                    onChange={(nextOperation) => {
                      selectOperation(nextOperation);
                      setProfessionalOpen(false);
                    }}
                    operation={
                      operation === 'video.generate'
                        ? 'video.generate'
                        : 'copy.generate'
                    }
                  />
                  <ContentModuleBuilder
                    availableModules={availableContentModules}
                    disabled={updateDraft.isPending || executionControlsBusy}
                    onChange={(nextModules) => {
                      setContentModules(nextModules);
                      setQuoteAccepted(false);
                      setQuoteAcceptedAt(undefined);
                      quoteAcceptedAtRef.current = undefined;
                      updateDraft.mutate(nextModules);
                    }}
                    presetName={currentPreset?.name}
                    selectedModules={contentModules}
                  />

                  {catalogQuery.isLoading ? (
                    <StatePanel
                      kind="loading"
                      title={workbench_catalog_loading_title()}
                      description={workbench_catalog_loading_description()}
                    />
                  ) : catalogFailure ? (
                    <StatePanel
                      kind="error"
                      title={workbench_catalog_failure_title()}
                      description={catalogFailure.description}
                      actionLabel={workbench_reload_catalog()}
                      onAction={() => void catalogQuery.refetch()}
                    />
                  ) : null}

                  <Collapsible
                    onOpenChange={setProfessionalOpen}
                    open={professionalOpen}
                  >
                    <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-3 rounded-md bg-surface-2 px-4 text-left text-sm font-medium">
                      <span>{workbench_professional_settings()}</span>
                      {professionalOpen ? (
                        <IconChevronUp aria-hidden="true" className="size-4" />
                      ) : (
                        <IconChevronDown
                          aria-hidden="true"
                          className="size-4"
                        />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 rounded-b-md bg-surface-2 p-4">
                      <section
                        aria-labelledby="workbench-model-picker-title"
                        ref={modelPickerRef}
                        tabIndex={-1}
                      >
                        <p
                          className="mb-2 text-sm font-medium"
                          id="workbench-model-picker-title"
                        >
                          {workbench_explicit_model()}
                        </p>
                        <ModelCardPicker
                          busy={executionControlsBusy}
                          models={catalog.models}
                          onChange={selectCurrentModel}
                          selectedModelId={selectedModel?.id ?? ''}
                          usage={modelUsage}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {workbench_model_guardrail()}
                        </p>
                      </section>

                      {operation !== 'copy.generate' ? (
                        <label className="grid gap-1.5 text-sm font-medium">
                          {workbench_aspect_ratio()}
                          <select
                            aria-label={workbench_aspect_ratio()}
                            className="h-touch-target rounded-md border border-divider bg-surface-0 px-3 text-sm"
                            disabled={executionControlsBusy}
                            onChange={(event) =>
                              setAspectRatio(
                                event.target.value as '1:1' | '3:4' | '9:16'
                              )
                            }
                            value={aspectRatio}
                          >
                            <option value="1:1">
                              {workbench_aspect_square()}
                            </option>
                            <option value="3:4">
                              {workbench_aspect_portrait_post()}
                            </option>
                            <option value="9:16">
                              {workbench_aspect_vertical_video()}
                            </option>
                          </select>
                        </label>
                      ) : null}

                      <div className="grid divide-y divide-divider overflow-hidden rounded-md bg-surface-1 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        <div className="flex min-h-touch-target items-center justify-between gap-3 px-3 text-sm">
                          <span>{workbench_watermark()}</span>
                          <Switch
                            aria-label={workbench_watermark()}
                            checked={watermarkEnabled}
                            disabled={
                              executionControlsBusy ||
                              complianceDefaults.isPending
                            }
                            onCheckedChange={(checked) => {
                              complianceDefaultsTouched.current = true;
                              setWatermarkEnabled(checked);
                            }}
                          />
                        </div>
                        <div className="space-y-1 px-3 py-2 text-sm">
                          <div className="flex min-h-touch-target items-center justify-between gap-3">
                            <span>{workbench_aigc_label()}</span>
                            <Switch
                              aria-label={workbench_aigc_label()}
                              checked={aigcLabelEnabled}
                              data-testid="workbench-aigc-switch"
                              disabled={
                                executionControlsBusy ||
                                complianceDefaults.isPending
                              }
                              onCheckedChange={(checked) => {
                                complianceDefaultsTouched.current = true;
                                setAigcLabelEnabled(checked);
                              }}
                            />
                          </div>
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid="workbench-aigc-burn-hint"
                          >
                            {workbench_aigc_follows_switch()}
                          </p>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Only show "model not selected" when no platform/catalog
                      default binding can resolve an executable model. */}
                  {!catalogQuery.isLoading &&
                  !catalogFailure &&
                  !selectedModel &&
                  !modelSelection ? (
                    <div
                      className="meiye-porcelain space-y-2 rounded-2xl border border-divider p-4 text-sm"
                      data-testid="workbench-model-not-selected"
                    >
                      <p className="font-medium">
                        {workbench_model_not_selected()}
                      </p>
                      <Button
                        onClick={revealModelPicker}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {workbench_view_model_details()}
                      </Button>
                    </div>
                  ) : selectedModel?.availabilityKind === 'local_fixture' ? (
                    <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                      <p className="font-medium">
                        {workbench_local_fixture_title()}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {workbench_local_fixture_description()}
                      </p>
                    </div>
                  ) : selectedModel?.availabilityKind === 'production' ? (
                    <Badge variant="secondary">
                      {model_settings_production_available()}
                    </Badge>
                  ) : null}

                  {selectedModel && !selectedModel.available ? (
                    <div className="meiye-porcelain space-y-2 rounded-2xl border border-divider p-4 text-sm">
                      <p className="font-medium">
                        {workbench_model_unavailable_title()}
                      </p>
                      <p className="text-muted-foreground">
                        {workbench_model_unavailable_description()}
                      </p>
                      <Button
                        onClick={revealModelPicker}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {workbench_view_model_details()}
                      </Button>
                    </div>
                  ) : null}

                  {selectedModel?.available && !selectedModel.unitPrice ? (
                    <div className="meiye-porcelain space-y-2 rounded-2xl border border-divider p-4 text-sm">
                      <p className="font-medium">
                        {workbench_quote_missing_title()}
                      </p>
                      <p className="text-muted-foreground">
                        {workbench_quote_missing_description()}
                      </p>
                      <Button
                        onClick={revealModelPicker}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {workbench_view_model_details()}
                      </Button>
                    </div>
                  ) : null}

                  <p className="rounded-md bg-surface-2 p-3 text-sm">
                    {workbench_settings_summary({
                      model:
                        selectedModel?.displayName ??
                        workbench_model_not_selected(),
                      output: quote.outputLabel,
                      price:
                        quote.estimatedAmount !== undefined && quote.currency
                          ? merchantUsageQuoteLabel(operation)
                          : workbench_quote_missing_short(),
                    })}
                  </p>
                  <Collapsible>
                    <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-3 rounded-md bg-surface-1 px-4 text-left text-sm font-medium">
                      <span>{workbench_view_settings()}</span>
                      <IconChevronDown aria-hidden="true" className="size-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-3 rounded-b-md bg-surface-1 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {workbench_summary_starting_card()}
                        </p>
                        <p className="mt-1 font-semibold">
                          {operationOptions
                            .find((option) => option.operation === operation)
                            ?.label() ?? operation}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {workbench_module_count({
                            count: contentModules.length,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {workbench_summary_model_spec()}
                        </p>
                        <p className="mt-1 font-semibold">
                          {selectedModel?.displayName ??
                            workbench_model_not_selected()}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {operation === 'copy.generate'
                            ? creation_catalog_copy_label()
                            : aspectRatio}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {workbench_summary_output_duration()}
                        </p>
                        <p className="mt-1 font-semibold">
                          {quote.outputLabel}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {durationEstimate.label} ·{' '}
                          {durationEstimate.description}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {workbench_summary_quote_labels()}
                        </p>
                        <p className="mt-1 font-semibold">
                          {quote.estimatedAmount !== undefined && quote.currency
                            ? merchantUsageQuoteLabel(operation)
                            : workbench_quote_missing_short()}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {workbench_compliance_summary({
                            aigc: aigcLabelEnabled
                              ? workbench_switch_on()
                              : workbench_switch_off(),
                            watermark: watermarkEnabled
                              ? workbench_switch_on()
                              : workbench_switch_off(),
                          })}
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {operation === 'video.generate' ? (
                    selectedModel?.available &&
                    selectedModel.unitPrice &&
                    quoteAccepted &&
                    videoApprovalReceiptId &&
                    currentWork.brief?.confirmedAt &&
                    groundingMissing.length === 0 ? (
                      {null /* Z1 video result face retired */}
                    ) : selectedModel?.available &&
                      selectedModel.unitPrice &&
                      currentWork.brief?.confirmedAt &&
                      groundingMissing.length === 0 &&
                      !quoteAccepted ? (
                      <div
                        className="meiye-porcelain space-y-3 rounded-2xl border border-primary/20 p-4"
                        data-testid="video-quote-confirm"
                      >
                        <p className="text-sm font-medium">
                          {workbench_video_quote_confirm()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {workbench_video_quote_confirm_hint()}
                        </p>
                        {typeof usageAvailable === 'number' ? (
                          <p className="text-xs text-muted-foreground">
                            {workbench_quota_line({
                              available: usageAvailable,
                              cost: usageCost,
                            })}
                          </p>
                        ) : null}
                        <Button
                          disabled={quotaInsufficient || executionControlsBusy}
                          onClick={() => {
                            if (!ensureQuotaOrBlock()) return;
                            const acceptedAt = acceptQuoteNow();
                            const { contract, workId } =
                              creativeContract(acceptedAt);
                            const approvalKey = `creative-generation-approval-${crypto.randomUUID()}`;
                            void operationsCommand<CreativeGenerationApprovalReceipt>(
                              'approve_creative_generation',
                              { approvalKey, contract, workId },
                              approvalKey
                            )
                              .then((receipt) => {
                                setVideoApprovalReceiptId(receipt.id);
                              })
                              .catch(() => {
                                setQuoteAccepted(false);
                                setQuoteAcceptedAt(undefined);
                                quoteAcceptedAtRef.current = undefined;
                                toast.error(workbench_operation_failed());
                              });
                          }}
                          type="button"
                        >
                          {workbench_video_quote_confirm()}
                        </Button>
                      </div>
                    ) : (
                      <p className="rounded-2xl border border-dashed border-divider p-3 text-sm text-muted-foreground">
                        {workbench_video_contract_required()}
                      </p>
                    )
                  ) : (
                    <div className="space-y-2">
                      <Button
                        className="min-h-touch-target w-full sm:w-auto"
                        data-testid="execute-tool-action"
                        disabled={
                          !selectedModel?.available ||
                          !selectedModel.unitPrice ||
                          !currentWork.brief?.confirmedAt ||
                          groundingMissing.length > 0 ||
                          quotaInsufficient ||
                          updateDraft.isPending ||
                          submitWork.isPending ||
                          copyStream.isLoading ||
                          briefAutoConfirming ||
                          currentJob?.status === 'running' ||
                          currentJob?.status === 'submitting'
                        }
                        onClick={() => {
                          if (!ensureQuotaOrBlock()) return;
                          // Accept quote synchronously before submit so the
                          // same call stack can freeze quoteAcceptedAt.
                          const acceptedAt = quoteAccepted
                            ? (quoteAcceptedAtRef.current ??
                              quoteAcceptedAt ??
                              acceptQuoteNow())
                            : acceptQuoteNow();
                          if (operation === 'copy.generate') {
                            // Direct-mode escape hatch: /copy/stream only when
                            // mode is direct. Agent path uses harness auto-launch.
                            if (currentWork.mode === 'direct') {
                              submitCopyStream(acceptedAt);
                            } else {
                              submitWork.mutate(acceptedAt);
                            }
                          } else {
                            submitWork.mutate(acceptedAt);
                          }
                        }}
                        type="button"
                      >
                        <ProductIcon icon={IconBolt} size={18} />
                        {quote.estimatedAmount !== undefined && quote.currency
                          ? workbench_submit_with_price({
                              price: merchantUsageQuoteLabel(operation),
                            })
                          : workbench_submit_job()}
                      </Button>
                      {typeof usageAvailable === 'number' ? (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid="workbench-quota-line"
                        >
                          {workbench_quota_line({
                            available: usageAvailable,
                            cost: usageCost,
                          })}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {workbench_accept_contract_label()}
                          {' · '}
                          {workbench_accept_contract_hint()}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Brief chips (confirmed) or auto-confirm status + grounding checklist */}
                  {workbenchStage === 'empty' ? (
                    <div
                      className="space-y-4 rounded-2xl border border-divider bg-surface-2/50 p-4"
                      data-testid="creative-generate-checklist"
                    >
                      <p className="text-sm font-medium">
                        {creative_brief_title()}
                      </p>
                      <CreativeBriefEditor
                        autoConfirming={briefAutoConfirming}
                        brief={currentWork.brief}
                        busy={briefCommand.isPending || executionControlsBusy}
                        drafts={briefDrafts}
                        onConfirm={async () => {
                          await briefCommand.mutateAsync({ kind: 'confirm' });
                        }}
                        onUpdate={async (update) => {
                          await briefCommand.mutateAsync({
                            kind: 'update',
                            update,
                          });
                        }}
                      />
                      {groundingMissing.length > 0 ? (
                        <div
                          className="text-sm"
                          data-testid="creative-grounding-readiness"
                          aria-live="polite"
                        >
                          <p className="font-medium">
                            {creative_grounding_title()}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {creative_grounding_description()}
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                            {groundingMissing.map((requirement) => (
                              <li key={requirement}>
                                {groundingLabels[requirement]()}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {groundingMissing.some((requirement) =>
                              [
                                'confirmed_store',
                                'confirmed_project',
                                'confirmed_qualification',
                              ].includes(requirement)
                            ) ? (
                              <Link
                                className="font-medium underline underline-offset-4"
                                to="/dashboard/store"
                              >
                                {creative_grounding_open_store()}
                              </Link>
                            ) : null}
                            {groundingMissing.includes(
                              'real_authorized_asset'
                            ) ? (
                              <Link
                                className="font-medium underline underline-offset-4"
                                to="/dashboard/assets"
                              >
                                {creative_grounding_open_assets()}
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <p
                          className="text-sm text-muted-foreground"
                          data-testid="creative-grounding-ready"
                        >
                          {creative_grounding_ready()}
                        </p>
                      )}
                    </div>
                  ) : null}

                  {submissionBlocker?.kind === 'reference' ? (
                    <CreativeSubmissionFailureNotice
                      currentAssets={productQuery.data?.assets ?? []}
                      details={submissionBlocker.details}
                    />
                  ) : submissionBlocker?.kind === 'quote_changed' ? (
                    <div
                      className="meiye-porcelain space-y-3 rounded-2xl border border-primary/20 p-4"
                      data-testid="creative-quote-changed"
                      role="alert"
                    >
                      <p className="text-sm font-medium">
                        {workbench_quote_changed()}
                      </p>
                      <Button
                        disabled={Boolean(quoteRecovery)}
                        onClick={recoverQuoteChangedAndResubmit}
                        size="sm"
                        type="button"
                      >
                        {workbench_quote_changed_retry()}
                      </Button>
                    </div>
                  ) : submissionBlocker?.kind === 'quota' ||
                    quotaInsufficient ? (
                    <div
                      className="meiye-porcelain space-y-3 rounded-2xl border border-destructive/20 p-4"
                      data-testid="creative-quota-blocker"
                      role="alert"
                    >
                      <p className="text-sm font-medium">
                        {workbench_quota_insufficient()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {workbench_quota_insufficient_description()}
                      </p>
                      {typeof usageAvailable === 'number' ? (
                        <p className="text-xs text-muted-foreground">
                          {workbench_quota_line({
                            available: usageAvailable,
                            cost: usageCost,
                          })}
                        </p>
                      ) : null}
                      <Link
                        className="inline-flex text-sm font-medium underline underline-offset-4"
                        to="/settings/credits"
                      >
                        {workbench_quota_open_plans()}
                      </Link>
                    </div>
                  ) : submissionBlocker ? (
                    <p
                      className="rounded-2xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
                      data-testid="creative-submission-blocker"
                      role="alert"
                    >
                      {submissionBlocker.description}
                    </p>
                  ) : briefAutoConfirming ? (
                    <p className="text-sm text-muted-foreground">
                      {creative_brief_auto_confirming()}
                    </p>
                  ) : !currentWork.brief?.confirmedAt ? (
                    <p className="text-sm text-muted-foreground">
                      {creative_brief_submit_blocked()}
                    </p>
                  ) : groundingMissing.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {creative_grounding_submit_blocked()}
                    </p>
                  ) : null}
                </div>
              </RecordSection>
            </WorkbenchComposerAxis>

            {/* Soft refine: expression assistant only — never force-open */}
            {workbenchStage === 'empty' &&
            currentWork.mode === 'agent' &&
            operation === 'copy.generate' &&
            selectedModel ? (
              <Collapsible onOpenChange={setRefineOpen} open={refineOpen}>
                <div className="meiye-porcelain rounded-2xl">
                  <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium">
                    <span>{workbench_refine_expression()}</span>
                    <IconChevronDown aria-hidden="true" className="size-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t border-[oklch(0_0_0/0.06)] px-5 pb-5 pt-4">
                    <CreationAssistant
                      catalogModelId={selectedModel.id}
                      context={{
                        intent: currentWork.intent,
                        sourceSummaries: currentSourceSummaries,
                        workId: currentWork.id,
                      }}
                    />
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ) : null}

            {/* Advanced: power path only — deep links, shelf, intent dump */}
            {workbenchStage === 'empty' || workbenchStage === 'result' ? (
              <Collapsible onOpenChange={setAdvancedOpen} open={advancedOpen}>
                <div className="meiye-porcelain rounded-2xl">
                  <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium">
                    <span>{workbench_advanced_details()}</span>
                    <IconChevronDown aria-hidden="true" className="size-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 border-t border-[oklch(0_0_0/0.06)] px-5 pb-5 pt-4">
                    <RecordSection title={workbench_section_intent()}>
                      {currentPreset ? (
                        <div className="rounded-md bg-surface-2 p-4">
                          <p className="font-semibold">
                            {workbench_selected_preset({
                              name: currentPreset.name,
                            })}
                          </p>
                          <p className="mt-2 text-sm">
                            {creation_entry_input_guide({
                              guide: currentPreset.inputGuide,
                            })}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {workbench_preset_identity_description()}
                          </p>
                        </div>
                      ) : currentDisplay?.kind === 'unresolved' ? (
                        <div className="rounded-md bg-surface-2 p-4">
                          <p className="font-semibold">
                            {workbench_preset_loading_title()}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {workbench_preset_loading_description()}
                          </p>
                        </div>
                      ) : (
                        <p className="text-base leading-7">
                          {currentDisplay?.title ?? currentWork.intent}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {currentWork.mode === 'agent'
                            ? workbench_mode_agent()
                            : creation_catalog_mode_direct()}
                        </Badge>
                        <Badge variant="outline">
                          {workbench_current_work()}
                        </Badge>
                        {currentWork.derivedFrom ? (
                          <Badge variant="outline">
                            {workbench_derived_work()}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        <Link
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          to="/dashboard/sessions/$sessionId"
                          params={{ sessionId: currentWork.sessionId }}
                        >
                          {workbench_open_session()}
                        </Link>
                        <Link
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          to="/dashboard/works/$workId"
                          params={{ workId: currentWork.id }}
                        >
                          {workbench_open_work()}
                        </Link>
                      </div>
                    </RecordSection>

                    <RecordSection title={workbench_section_references()}>
                      {operation === 'image.generate' &&
                      currentWork.sourceReferences.some(
                        (source) => source.kind === 'asset'
                      ) ? (
                        <p className="mb-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                          {workbench_reference_assets_will_be_used()}
                        </p>
                      ) : null}
                      {currentWork.sourceReferences.length > 0 ? (
                        <ul className="flex flex-wrap gap-2">
                          {currentWork.sourceReferences.map((source, index) => {
                            const sourceAsset =
                              source.kind === 'asset'
                                ? productQuery.data?.assets.find(
                                    (asset) => asset.id === source.id
                                  )
                                : undefined;
                            return (
                              <li key={`${source.kind}:${source.id}`}>
                                <div className="rounded-md bg-surface-2 p-2 text-sm">
                                  <Badge variant="secondary">
                                    {currentSourceSummaries[index] ??
                                      workbench_selected_source()}
                                  </Badge>
                                  {sourceAsset ? (
                                    <>
                                      <CanonicalMediaGallery
                                        className="mt-2 w-28"
                                        media={canonicalMediaForAssetIds(
                                          projection.assets,
                                          productQuery.data?.assets ?? [],
                                          [source.id]
                                        )}
                                      />
                                      <p className="mt-2 max-w-40 truncate text-xs text-muted-foreground">
                                        {sourceAsset.tags.at(-1) ??
                                          workbench_uploaded_image()}
                                      </p>
                                    </>
                                  ) : null}
                                  {source.inheritanceFields?.length ? (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      {workbench_inherited_fields()}
                                      {source.inheritanceFields
                                        .map(
                                          (fieldId) =>
                                            INHERITANCE_FIELD_OPTIONS.find(
                                              (field) => field.id === fieldId
                                            )?.label ?? fieldId
                                        )
                                        .join(workbench_list_separator())}
                                    </p>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {workbench_no_references()}
                        </p>
                      )}
                    </RecordSection>

                    {workbenchStage === 'empty' ? null : (
                      <>
                        <RecordSection title={creative_brief_title()}>
                          <CreativeBriefEditor
                            brief={currentWork.brief}
                            busy={
                              briefCommand.isPending || executionControlsBusy
                            }
                            drafts={briefDrafts}
                            onConfirm={async () => {
                              await briefCommand.mutateAsync({
                                kind: 'confirm',
                              });
                            }}
                            onUpdate={async (update) => {
                              await briefCommand.mutateAsync({
                                kind: 'update',
                                update,
                              });
                            }}
                          />
                          {groundingMissing.length > 0 ? (
                            <div
                              className="mt-4 rounded-2xl border border-divider bg-surface-2/60 p-4 text-sm"
                              data-testid="creative-grounding-readiness"
                              aria-live="polite"
                            >
                              <p className="font-medium">
                                {creative_grounding_title()}
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                {creative_grounding_description()}
                              </p>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                                {groundingMissing.map((requirement) => (
                                  <li key={requirement}>
                                    {groundingLabels[requirement]()}
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-3 flex flex-wrap gap-3">
                                {groundingMissing.some((requirement) =>
                                  [
                                    'confirmed_store',
                                    'confirmed_project',
                                    'confirmed_qualification',
                                  ].includes(requirement)
                                ) ? (
                                  <Link
                                    className="font-medium underline underline-offset-4"
                                    to="/dashboard/store"
                                  >
                                    {creative_grounding_open_store()}
                                  </Link>
                                ) : null}
                                {groundingMissing.includes(
                                  'real_authorized_asset'
                                ) ? (
                                  <Link
                                    className="font-medium underline underline-offset-4"
                                    to="/dashboard/assets"
                                  >
                                    {creative_grounding_open_assets()}
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          ) : !currentJob ? (
                            <p
                              className="mt-4 text-sm text-muted-foreground"
                              data-testid="creative-grounding-ready"
                            >
                              {creative_grounding_ready()}
                            </p>
                          ) : null}
                        </RecordSection>

                        {hasPersistedResult && currentJob ? (
                          <RecordSection title={workbench_section_job()}>
                            <div className="space-y-3 rounded-md bg-surface-2 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="mt-1 text-sm">
                                    {workbench_expected_output({
                                      output: creativeOutputLabel(
                                        currentJob.contract.operation,
                                        currentJob.contract.outputCount,
                                        currentJob.contract.aspectRatio
                                      ),
                                    })}
                                  </p>
                                  <Link
                                    className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                                    to="/dashboard/jobs/$jobId"
                                    params={{ jobId: currentJob.id }}
                                  >
                                    {workbench_open_job()}
                                  </Link>
                                </div>
                                <ProductStatus
                                  announce
                                  showExplanation
                                  status={
                                    currentJobObserver.status ??
                                    currentJob.status
                                  }
                                />
                              </div>
                              {['submitting', 'running'].includes(
                                currentJobObserver.status ?? currentJob.status
                              ) ? (
                                <GenerationAccent
                                  label={
                                    currentJob.contract.operation ===
                                    'video.generate'
                                      ? workbench_generating_video()
                                      : workbench_generating_content()
                                  }
                                />
                              ) : null}
                              {currentJob.retryOf ? (
                                <p className="text-xs text-muted-foreground">
                                  {workbench_job_retry_description()}
                                </p>
                              ) : null}
                              {currentJob.recoveredAt ? (
                                <p className="text-xs text-muted-foreground">
                                  {workbench_job_recovered({
                                    time: currentJob.recoveredAt,
                                  })}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                {currentJob.status === 'recoverable' ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      command.mutate({
                                        action: 'resume_creative_job',
                                        key: `resume-${currentJob.id}-${crypto.randomUUID()}`,
                                        payload: { jobId: currentJob.id },
                                      })
                                    }
                                  >
                                    {workbench_resume_job()}
                                  </Button>
                                ) : null}
                                {(currentJob.status === 'unknown' ||
                                  currentJob.status === 'running') &&
                                !currentJobObserver.enabled ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      command.mutate({
                                        action: 'resume_creative_job',
                                        key: `verify-${currentJob.id}-${crypto.randomUUID()}`,
                                        payload: { jobId: currentJob.id },
                                      })
                                    }
                                  >
                                    <ProductIcon icon={IconRefresh} size={16} />
                                    {currentJob.status === 'unknown'
                                      ? workbench_verify_only()
                                      : workbench_verify_job()}
                                  </Button>
                                ) : null}
                                {currentJobObserver.error ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void currentJobObserver.refetch();
                                      void currentJobObserver.retryRecovery();
                                    }}
                                  >
                                    <ProductIcon icon={IconRefresh} size={16} />
                                    {workbench_retry_updates()}
                                  </Button>
                                ) : null}
                                {currentJob.status === 'failed' ? (
                                  <div className="space-y-2">
                                    <CreativeJobFailureNotice
                                      currentAssets={
                                        productQuery.data?.assets ?? []
                                      }
                                      job={currentJob}
                                      sourceAssetIds={currentWork.sourceReferences
                                        .filter(
                                          (source) => source.kind === 'asset'
                                        )
                                        .map((source) => source.id)}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      {workbench_technical_failure_usage()}
                                    </p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        command.mutate({
                                          action: 'retry_creative_job',
                                          key: `retry-command-${crypto.randomUUID()}`,
                                          payload: {
                                            jobId: currentJob.id,
                                            submissionKey: `retry-${crypto.randomUUID()}`,
                                          },
                                        })
                                      }
                                    >
                                      {workbench_regenerate()}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                              {currentJobObserver.error ? (
                                <p className="text-sm text-destructive">
                                  {workbench_updates_failed()}
                                </p>
                              ) : null}
                            </div>
                          </RecordSection>
                        ) : null}
                      </>
                    )}
                    <RecordSection title={workbench_section_reuse()}>
                      <CreationShelf
                        onInsertReference={async (reference) => {
                          await insertReference.mutateAsync(reference);
                        }}
                        onSelectTool={(nextOperation) => {
                          if (!executionControlsBusy) {
                            selectOperation(nextOperation);
                          }
                        }}
                      />
                    </RecordSection>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ) : null}

            {workbenchStage === 'result' &&
            (currentWork.status === 'completed' ||
              currentWork.status === 'accepted') ? (
              <RecordSection title={workbench_section_next()}>
                <div className="space-y-2">
                  <Textarea
                    data-testid="workbench-revise-direction"
                    value={reviseDirection}
                    maxLength={200}
                    rows={2}
                    placeholder={workbench_revise_direction_placeholder()}
                    onChange={(event) => setReviseDirection(event.target.value)}
                  />
                  <Button
                    type="button"
                    data-testid="workbench-revise-submit"
                    disabled={
                      reviseWork.isPending || reviseDirection.trim().length < 2
                    }
                    onClick={() => reviseWork.mutate(reviseDirection.trim())}
                  >
                    {workbench_revise_submit()}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    command.mutate({
                      action: 'derive_creative_work',
                      key: `derive-${crypto.randomUUID()}`,
                      payload: {
                        contentModules,
                        intent: currentWork.intent,
                        sessionId: sessionId(),
                        sourceWorkId: currentWork.id,
                      },
                    })
                  }
                >
                  {workbench_derive_new_work()}
                </Button>
              </RecordSection>
            ) : null}
          </WorkbenchStageShell>
        )}
        {recordVisible ? null : operationsRail}
      </div>
    </>
  );
}

function HarnessCandidateResultCard({
  adoptedCandidateId,
  busy,
  candidate,
  label,
  onAdopt,
  primary = false,
}: {
  adoptedCandidateId?: string;
  busy: boolean;
  candidate: NonNullable<
    ReturnType<typeof harnessCandidateResultModel>
  >['primary'];
  label: string;
  onAdopt: (candidateId: string) => void;
  primary?: boolean;
}) {
  const adopted = adoptedCandidateId === candidate.candidateId;
  return (
    <section
      className="space-y-3 rounded-lg bg-surface-2 p-4 text-sm"
      data-testid="harness-persisted-candidate"
    >
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {label}
          {` · ${candidate.score}`}
        </p>
        <h3 className="text-base leading-snug font-medium">
          {candidate.title}
        </h3>
      </header>
      <div className="space-y-3">
        <AiMarkdown
          className="prose prose-sm max-w-none dark:prose-invert"
          content={candidate.body}
        />
        {candidate.conversionHook ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            {copy_candidate_conversion_hook_label()}
            {candidate.conversionHook}
          </p>
        ) : null}
        <Button
          disabled={
            !canAdoptHarnessCandidate(
              busy,
              adoptedCandidateId,
              candidate.candidateId
            )
          }
          onClick={() => onAdopt(candidate.candidateId)}
          size="sm"
          type="button"
          variant={harnessCandidateActionVariant(adopted, primary)}
        >
          {adopted ? copy_candidate_accepted_badge() : copy_candidate_accept()}
        </Button>
      </div>
    </section>
  );
}

export function harnessCandidateActionVariant(
  adopted: boolean,
  primary: boolean
) {
  if (adopted) return 'secondary' as const;
  return primary ? ('default' as const) : ('outline' as const);
}

export function canAdoptHarnessCandidate(
  busy: boolean,
  adoptedCandidateId: string | undefined,
  candidateId: string
) {
  return !busy && adoptedCandidateId !== candidateId;
}
