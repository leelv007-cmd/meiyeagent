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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import {
  canonical_canvas_job_actual_model,
  common_correlation_id,
  creation_assistant_title,
  creation_catalog_copy_label,
  creation_catalog_image_detail,
  creation_catalog_image_label,
  creation_catalog_mode_direct,
  creation_entry_input_guide,
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
  p1_common_unknown_error,
  product_navigation_workbench,
  workbench_accept_contract_aria,
  workbench_accept_contract_hint,
  workbench_accept_contract_label,
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
  workbench_empty_description,
  workbench_empty_title,
  workbench_expected_output,
  workbench_explicit_model,
  workbench_eyebrow,
  workbench_generating_content,
  workbench_generating_video,
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
  workbench_mode_agent,
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
  workbench_organization_label,
  workbench_organization_label_aria,
  workbench_preset_identity_description,
  workbench_preset_loading_description,
  workbench_preset_loading_title,
  workbench_professional_settings,
  workbench_projection_failure_description,
  workbench_projection_failure_title,
  workbench_quick_start,
  workbench_quick_start_description,
  workbench_quick_start_legend,
  workbench_quote_missing_description,
  workbench_quote_missing_short,
  workbench_quote_missing_title,
  workbench_record_aria,
  workbench_record_assistant,
  workbench_record_composer,
  workbench_record_direct_aria,
  workbench_record_intent,
  workbench_record_job,
  workbench_record_next,
  workbench_record_references,
  workbench_record_results,
  workbench_record_reuse,
  workbench_record_streaming,
  workbench_reference_assets_need_attention,
  workbench_reference_assets_will_be_used,
  workbench_reference_failure_action,
  workbench_reference_failure_authorization,
  workbench_reference_failure_deleted,
  workbench_reference_failure_description,
  workbench_reference_failure_fallback_photo,
  workbench_reference_failure_title,
  workbench_reference_failure_unreadable,
  workbench_regenerate,
  workbench_reload,
  workbench_reload_catalog,
  workbench_reload_inbox,
  workbench_reload_sources,
  workbench_reload_tasks,
  workbench_resubmit_stream,
  workbench_result_saved_as_asset,
  workbench_result_saved_description,
  workbench_resume_job,
  workbench_retry_updates,
  workbench_section_composer,
  workbench_section_intent,
  workbench_section_job,
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
  workbench_submitting_accent,
  workbench_submitting_description,
  workbench_submitting_title,
  workbench_summary_model_spec,
  workbench_summary_output_duration,
  workbench_summary_quote_labels,
  workbench_summary_starting_card,
  workbench_switch_off,
  workbench_switch_on,
  workbench_tag_local,
  workbench_tag_project,
  workbench_tag_review,
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
import { getLocale, localeConfig } from '@/lib/locale';
import { durationEstimateView } from '@/lib/uiux/duration-estimate';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import {
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
import type { ComposerImageIdentity } from '@/product/composer-image-input';
import { ContentModuleBuilder } from '@/product/content-module-builder';
import { CreationEntry } from '@/product/creation-entry';
import {
  canCreateFromUploads,
  CREATION_DRAFT_INTENT_STORAGE_KEY,
  exampleStoreVisibility,
  primaryCreationOperations,
  readCreationDraftIntent,
  writeCreationDraftIntent,
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
  missingCreativeGrounding,
  type CreativeBriefDrafts,
  type CreativeGroundingRequirement,
} from '@/product/creative-brief-editor';
import { CanonicalMediaGallery } from '@/product/canonical-media-gallery';
import { isContentPackageEligibleAsset } from '@/product/canonical-asset-governance-model';
import { canonicalMediaForAssetIds } from '@/product/canonical-history-model';
import { CopyCandidateSelector } from '@/product/copy-candidate-selector';
import { buildCopyCandidateSelectorModel } from '@/product/copy-candidate-selector-model';
import { executeProductCommand, readProductEnvelope } from '@/product/client';
import { useGlobalCommand } from '@/product/global-command-palette';
import {
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
  quoteFor,
} from '@/product/creative-quote';
import { creativeWorkDisplay } from '@/product/creative-work-display';
import { VideoWorkflowPanel } from '@/product/video-workflow-panel';
import {
  WorkbenchStageShell,
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
  CreativeBriefUpdate,
  CreativeContentModuleId,
  CreativeExecutionContract,
  CreativeJob,
  CreativeSourceReference,
  CreativeWorkbenchProjection,
  ProductState,
} from '@meiye/contracts';
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
  title: () => string;
  unreadable: (input: { photo: string }) => string;
}

const referenceAssetFailureCodes = new Set([
  'REFERENCE_ASSET_UNRESOLVED',
  'reference_asset_resolution_required',
]);

function localizedCreativeJobFailureMessages(): CreativeJobFailureMessages {
  return {
    action: workbench_reference_failure_action,
    authorization: workbench_reference_failure_authorization,
    deleted: workbench_reference_failure_deleted,
    description: workbench_reference_failure_description,
    fallbackPhoto: workbench_reference_failure_fallback_photo,
    title: workbench_reference_failure_title,
    unreadable: workbench_reference_failure_unreadable,
  };
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

  return (
    <section
      className="rounded-md border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      data-testid="creative-job-reference-failure"
      role="alert"
    >
      <p className="font-semibold">{messages.title()}</p>
      <p className="mt-1">{messages.description()}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {referenceAssets.map((snapshotAsset, index) => {
          const currentAsset = currentById.get(snapshotAsset.id);
          const photo =
            currentAsset?.tags.at(-1) ??
            snapshotAsset.tags.at(-1) ??
            messages.fallbackPhoto({ index: index + 1 });
          const reason = !currentAsset
            ? 'deleted'
            : currentAsset.authorizationStatus !== 'authorized' ||
                !currentAsset.rightsEvidence?.trim()
              ? 'authorization'
              : 'unreadable';
          return (
            <li data-reference-photo={reason} key={snapshotAsset.id}>
              {messages[reason]({ photo })}
            </li>
          );
        })}
      </ul>
      <a
        className="mt-3 inline-block font-medium underline underline-offset-4"
        href="/dashboard/assets"
      >
        {messages.action()}
      </a>
    </section>
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

function formatQuote(amount: number, currency: string) {
  return new Intl.NumberFormat(localeConfig[getLocale()].hreflang, {
    currency,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
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
  testId,
  title,
}: {
  children: ReactNode;
  className?: string;
  eyebrow: string;
  hero?: boolean;
  testId?: string;
  title: string;
}) {
  return (
    <section
      className={`${
        hero
          ? 'order-first my-4 rounded-xl bg-surface-0 p-4 shadow-sm sm:p-6'
          : 'grid gap-4 border-t border-divider py-6 md:grid-cols-[132px_minmax(0,1fr)]'
      }${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      <div>
        <p className="meiye-type-aux font-mono tracking-[0.12em] uppercase">
          {eyebrow}
        </p>
        <h2 className="meiye-type-body mt-1 font-semibold">{title}</h2>
      </div>
      <div className={hero ? 'mt-5 min-w-0' : 'min-w-0'}>{children}</div>
    </section>
  );
}

function ResultProvenance({ job }: { job: CreativeJob }) {
  const frozen = job.executionProvenance;
  const provenance =
    frozen?.activationStatus === 'recorded'
      ? 'local_fixture'
      : frozen?.activationStatus === 'live_verified'
        ? 'production'
        : 'unknown';
  const localFixture = provenance === 'local_fixture';
  return (
    <div
      className="mb-4 space-y-2 rounded-md bg-surface-2 p-3"
      data-catalog-model-id={
        frozen?.actualCatalogModelId ?? job.contract.catalogModelId
      }
      data-provider-model={frozen?.providerModel ?? ''}
      data-provenance={provenance}
      data-route-snapshot-id={job.routeSnapshotId ?? ''}
      data-testid="result-provenance"
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {canonical_canvas_job_actual_model({
            model:
              frozen?.modelDisplayName ??
              frozen?.actualCatalogModelId ??
              job.contract.catalogModelId,
          })}
        </Badge>
        {frozen?.apiCounterparty ? (
          <Badge variant="outline">{frozen.apiCounterparty}</Badge>
        ) : null}
        {job.routeSnapshotId ? (
          <Badge variant="outline">RouteSnapshot · {job.routeSnapshotId}</Badge>
        ) : null}
        {localFixture ? (
          <Badge variant="outline">{workbench_local_fixture_title()}</Badge>
        ) : null}
      </div>
      {localFixture ? (
        <p className="text-xs text-muted-foreground">
          {workbench_local_fixture_description()}
        </p>
      ) : null}
    </div>
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
    setWatermarkEnabled(
      complianceDefaults.data['compliance.watermark.default']
    );
    setAigcLabelEnabled(
      complianceDefaults.data['compliance.aigc_label.default']
    );
  }, [complianceDefaults.data]);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '3:4' | '9:16'>('3:4');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [exampleOpened, setExampleOpened] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [professionalOpen, setProfessionalOpen] = useState(false);
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
  const [submissionBlocker, setSubmissionBlocker] = useState<string>();

  const updateIntent = useCallback((nextIntent: string) => {
    setIntent(nextIntent);
    if (!writeCreationDraftIntent(window.sessionStorage, nextIntent)) {
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    }
  }, []);

  const resetNewCreationState = useCallback(() => {
    setIntent('');
    window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    setSelectedPresetId(undefined);
    setEntryAssetIds(new Set());
    setEntryExcludedAssetIds(new Set());
    window.sessionStorage.removeItem(EXCLUDED_ENTRY_ASSET_IDS_STORAGE_KEY);
    setEntryUploads([]);
    setSelectedSourceKeys(new Set());
    setQuoteAccepted(false);
    setQuoteAcceptedAt(undefined);
    setProfessionalOpen(false);
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
    retry: false,
  });
  const inboxQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'inbox', { ui: 'creative' }),
    queryFn: ({ signal }) => operationsQuery<RawInbox>('inbox', {}, signal),
  });
  const productQuery = useQuery({
    queryKey: ['product', 'creative-sources'],
    queryFn: ({ signal }) => productState(signal),
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
  const usageQuery = useQuery({
    enabled: Boolean(currentWork) && professionalOpen,
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
  });

  const currentJob = currentWork?.currentJobId
    ? projection.jobs.find((job) => job.id === currentWork.currentJobId)
    : undefined;
  const currentJobObserver = useCreativeJobObserver(
    creativeJobObservation(currentJob)
  );
  useEffect(() => {
    if (!currentJob) return;
    setOperation((current) =>
      current === currentJob.contract.operation
        ? current
        : currentJob.contract.operation
    );
  }, [currentJob?.contract.operation, currentJob?.id]);
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
        .filter(isContentPackageEligibleAsset)
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
  const namedPresets = templateItems.filter(
    (
      template
    ): template is TemplateCatalogItemView & {
      inputGuide: string;
      internalIntent: string;
    } =>
      Boolean(
        template.inputGuide && template.internalIntent && template.canCreate
      )
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
        .filter(isContentPackageEligibleAsset)
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

  useEffect(() => {
    setQuoteAccepted(false);
    setQuoteAcceptedAt(undefined);
  }, [selectedModel?.id, operation, aspectRatio, contentModules]);

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
      projection.works.length > 0 ||
      inboxQuery.isLoading ||
      productQuery.isLoading
    ) {
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
      setSubmissionBlocker(
        error.message.includes('Confirmed Product grounding is incomplete')
          ? creative_grounding_server_blocked()
          : workbench_submit_failed()
      );
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

  const creativeContract = () => {
    if (
      !currentWork ||
      !selectedModel?.unitPrice ||
      !catalogQuery.data?.revisionId ||
      quote.estimatedAmount === undefined ||
      !quote.currency ||
      !quote.priceRevision ||
      !quoteAcceptedAt
    ) {
      throw new Error(workbench_contract_incomplete());
    }
    const contract: CreativeExecutionContract = {
      aigcLabelEnabled,
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
      quoteAcceptedAt,
      quoteRevision: creativeQuoteRevision({
        aspectRatio,
        catalogModelId: selectedModel.id,
        catalogRevision: catalogQuery.data.revisionId,
        operation,
        priceRevision: quote.priceRevision,
      }),
      watermarkEnabled,
    };
    return { contract, workId: currentWork.id };
  };

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
          contentModules: nextModules,
          intent: selectedPreset?.internalIntent ?? intent,
          mode,
          sessionId: sessionId(),
          sourceReferences,
        },
        `create-work-${crypto.randomUUID()}`
      );
    },
    onSuccess: async (createdWork) => {
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
    onError: () => toast.error(workbench_work_create_failed()),
  });

  const submitWork = useMutation({
    mutationFn: async () => {
      const { contract, workId } = creativeContract();
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
        error instanceof Error
          ? error.message.match(
              /Reference assets need attention: (.+)\. Re-authorize/u
            )?.[1]
          : undefined;
      const description =
        errorCode === 'CREATIVE_GROUNDING_INCOMPLETE' ||
        (error instanceof Error &&
          error.message.includes('Confirmed Product grounding is incomplete'))
          ? creative_grounding_server_blocked()
          : errorCode === 'REFERENCE_ASSET_UNRESOLVED' ||
              (error instanceof Error &&
                error.message.includes('Reference assets need attention'))
            ? workbench_reference_assets_need_attention({
                details: referenceDetails ?? p1_common_unknown_error(),
              })
            : workbench_submit_failed();
      setSubmissionBlocker(description);
      toast.error(description);
    },
  });

  const submitCopyStream = () => {
    if (copySubmissionKeyRef.current || copyStream.isLoading) return;
    try {
      setCopyStreamInterruption(undefined);
      setSubmissionBlocker(undefined);
      const { contract, workId } = creativeContract();
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
    onError: () => toast.error(workbench_operation_failed()),
  });

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
  const workbenchStage: WorkbenchStage = hasPersistedResult
    ? 'result'
    : executionControlsBusy || currentJob
      ? 'running'
      : 'empty';

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

  const uploadComposerImage = async (
    file: File,
    facts: {
      containsPerson: boolean;
      containsSensitiveData: boolean;
      minorStatus: 'none' | 'minor';
    },
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
          category: 'other',
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
    queryClient.setQueryData(['product', 'creative-sources'], result.state);
  };

  const exampleEligibility = exampleStoreVisibility({
    assetCount:
      (productQuery.data?.assets.length ?? 0) + projection.assets.length,
    contentCount:
      (productQuery.data?.contents.length ?? 0) + projection.contents.length,
    hidden: false,
    queriesReady:
      projectionQuery.isSuccess &&
      inboxQuery.isSuccess &&
      productQuery.isSuccess,
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
  const projectionFailure = projectionQuery.isError
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
      !projectionQuery.isLoading &&
      !onboardingVisible &&
      currentWork
  );

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_workbench(), isCurrentPage: true },
        ]}
        actions={<Badge variant="outline">{workbench_header_badge()}</Badge>}
      />
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-wrap items-start justify-between gap-4 xl:col-span-2">
          <div>
            <p className="text-sm font-medium text-primary">
              {workbench_eyebrow()}
            </p>
            <h1 className="meiye-type-title mt-1">{workbench_title()}</h1>
            <p className="meiye-type-aux mt-2 max-w-2xl">
              {workbench_description()}
            </p>
          </div>
          {currentWork ? (
            <Button
              type="button"
              variant="outline"
              onClick={resetNewCreationState}
            >
              {workbench_new_creation()}
            </Button>
          ) : null}
        </div>

        {projectionFailure ? (
          <StatePanel
            kind="error"
            title={workbench_projection_failure_title()}
            description={projectionFailure.description}
            actionLabel={workbench_reload()}
            onAction={() => void projectionQuery.refetch()}
          >
            {projectionFailure.correlationId ? (
              <p className="text-xs text-muted-foreground">
                {common_correlation_id({
                  id: projectionFailure.correlationId,
                })}
              </p>
            ) : null}
          </StatePanel>
        ) : null}
        {!projectionFailure && projectionQuery.isLoading ? (
          <StatePanel
            kind="loading"
            title={workbench_loading_title()}
            description={workbench_loading_description()}
          />
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
            <CreationEntry
              assetSignals={(productQuery.data?.assets ?? []).map((asset) => ({
                id: asset.id,
                label: asset.tags[0] ?? workbench_store_asset(),
              }))}
              createPending={createWork.isPending || Boolean(projectionFailure)}
              example={
                exampleVisibility === 'visible'
                  ? productQuery.data?.exampleStore
                  : undefined
              }
              exampleHiding={false}
              intent={intent}
              intentRef={intentRef}
              mode={mode}
              onCreate={() => createWork.mutate()}
              onHideExample={() => setExampleOpened(false)}
              onIntentChange={updateIntent}
              onModeChange={setMode}
              onPresetChange={setSelectedPresetId}
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
              selectedPresetId={selectedPresetId}
              selectedSourceKeys={selectedSourceKeys}
              sourceOptions={sourceOptions}
              taskSignals={(inboxQuery.data?.tasks ?? []).map((task) => ({
                id: task.id,
                title: taskSystemText(task.title) ?? task.title,
              }))}
              uploadsReady={canCreateFromUploads(entryUploads)}
            />
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
            <RecordSection
              eyebrow={workbench_record_intent()}
              title={workbench_section_intent()}
            >
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
                <Badge variant="outline">{workbench_current_work()}</Badge>
                {currentWork.derivedFrom ? (
                  <Badge variant="outline">{workbench_derived_work()}</Badge>
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

            <RecordSection
              className={workbenchStage === 'empty' ? undefined : 'hidden'}
              eyebrow={workbench_record_composer()}
              title={workbench_quick_start()}
            >
              <p className="text-xs text-muted-foreground">
                {workbench_quick_start_description()}
              </p>
              <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">
                  {workbench_quick_start_legend()}
                </legend>
                {operationOptions
                  .filter((option) =>
                    primaryCreationOperations().includes(
                      option.operation as 'copy.generate' | 'video.generate'
                    )
                  )
                  .map((option) => (
                    <Button
                      aria-pressed={operation === option.operation}
                      className="h-auto justify-start py-4 text-left"
                      disabled={executionControlsBusy}
                      key={option.operation}
                      onClick={() => {
                        selectOperation(option.operation);
                        setProfessionalOpen(false);
                      }}
                      type="button"
                      variant={
                        operation === option.operation ? 'secondary' : 'outline'
                      }
                    >
                      <ProductIcon icon={option.icon} size={20} />
                      <span>
                        <span className="block font-semibold">
                          {option.label()}
                        </span>
                        <span className="block text-xs font-normal opacity-75">
                          {option.description()}
                        </span>
                      </span>
                    </Button>
                  ))}
              </fieldset>
            </RecordSection>

            <RecordSection
              eyebrow={workbench_record_references()}
              title={workbench_section_references()}
            >
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

            <RecordSection
              eyebrow={workbench_record_assistant()}
              title={creative_brief_title()}
            >
              <CreativeBriefEditor
                brief={currentWork.brief}
                busy={briefCommand.isPending || executionControlsBusy}
                drafts={briefDrafts}
                onConfirm={async () => {
                  await briefCommand.mutateAsync({ kind: 'confirm' });
                }}
                onUpdate={async (update) => {
                  await briefCommand.mutateAsync({ kind: 'update', update });
                }}
              />
              {groundingMissing.length > 0 ? (
                <div
                  className="mt-4 rounded-md border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                  data-testid="creative-grounding-readiness"
                  aria-live="polite"
                >
                  <p className="font-semibold">{creative_grounding_title()}</p>
                  <p className="mt-1">{creative_grounding_description()}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
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
                    {groundingMissing.includes('real_authorized_asset') ? (
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

            {currentWork.mode === 'agent' &&
            operation === 'copy.generate' &&
            selectedModel ? (
              <RecordSection
                eyebrow={workbench_record_assistant()}
                title={creation_assistant_title()}
              >
                <CreationAssistant
                  catalogModelId={selectedModel.id}
                  context={{
                    intent: currentWork.intent,
                    sourceSummaries: currentSourceSummaries,
                    workId: currentWork.id,
                  }}
                />
              </RecordSection>
            ) : null}

            <RecordSection
              eyebrow={workbench_record_reuse()}
              title={workbench_section_reuse()}
            >
              <CreationShelf
                onInsertReference={async (reference) => {
                  await insertReference.mutateAsync(reference);
                }}
                onSelectTool={(nextOperation) => {
                  if (!executionControlsBusy) selectOperation(nextOperation);
                }}
              />
            </RecordSection>

            <RecordSection
              className={workbenchStage === 'empty' ? undefined : 'hidden'}
              eyebrow={workbench_record_composer()}
              title={workbench_section_composer()}
            >
              <div className="space-y-5">
                <ContentModuleBuilder
                  availableModules={availableContentModules}
                  disabled={updateDraft.isPending || executionControlsBusy}
                  onChange={(nextModules) => {
                    setContentModules(nextModules);
                    setQuoteAccepted(false);
                    setQuoteAcceptedAt(undefined);
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
                      <IconChevronDown aria-hidden="true" className="size-4" />
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

                    <div className="grid gap-4 md:grid-cols-2">
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
                      ) : (
                        <label className="grid gap-1.5 text-sm font-medium">
                          {workbench_organization_label()}
                          <select
                            aria-label={workbench_organization_label_aria()}
                            className="h-touch-target rounded-md border border-divider bg-surface-0 px-3 text-sm"
                            disabled={executionControlsBusy}
                          >
                            <option>{workbench_tag_project()}</option>
                            <option>{workbench_tag_review()}</option>
                            <option>{workbench_tag_local()}</option>
                          </select>
                        </label>
                      )}
                    </div>

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
                      <div className="flex min-h-touch-target items-center justify-between gap-3 px-3 text-sm">
                        <span>{workbench_aigc_label()}</span>
                        <Switch
                          aria-label={workbench_aigc_label()}
                          checked={aigcLabelEnabled}
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
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {!catalogQuery.isLoading &&
                !catalogFailure &&
                !selectedModel ? (
                  <div className="rounded-md border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-semibold">
                      {workbench_model_not_selected()}
                    </p>
                    <Button
                      className="mt-2"
                      onClick={revealModelPicker}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {workbench_view_model_details()}
                    </Button>
                  </div>
                ) : selectedModel?.availabilityKind === 'local_fixture' ? (
                  <div className="rounded-md bg-surface-2 p-3 text-sm">
                    <p className="font-semibold">
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
                  <div className="rounded-md border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-semibold">
                      {workbench_model_unavailable_title()}
                    </p>
                    <p className="mt-1">
                      {workbench_model_unavailable_description()}
                    </p>
                    <Button
                      className="mt-2"
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
                  <div className="rounded-md border border-amber-700/25 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-semibold">
                      {workbench_quote_missing_title()}
                    </p>
                    <p className="mt-1">
                      {workbench_quote_missing_description()}
                    </p>
                    <Button
                      className="mt-2"
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
                        ? formatQuote(quote.estimatedAmount, quote.currency)
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
                      <p className="mt-1 font-semibold">{quote.outputLabel}</p>
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
                          ? formatQuote(quote.estimatedAmount, quote.currency)
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

                <div className="flex min-h-touch-target items-start gap-3 rounded-md border border-divider bg-surface-0 p-3 text-sm leading-6">
                  <Checkbox
                    aria-label={workbench_accept_contract_aria()}
                    checked={quoteAccepted}
                    disabled={executionControlsBusy}
                    id="creative-contract-acceptance"
                    onCheckedChange={(checked) => {
                      setQuoteAccepted(checked);
                      emitTelemetry('quote_state', {
                        operation,
                        state: checked ? 'accepted' : 'revoked',
                      });
                      setQuoteAcceptedAt(
                        checked ? new Date().toISOString() : undefined
                      );
                    }}
                  />
                  <label htmlFor="creative-contract-acceptance">
                    {workbench_accept_contract_label()}
                  </label>
                </div>
                {!quoteAccepted ? (
                  <p className="text-xs text-muted-foreground">
                    {workbench_accept_contract_hint()}
                  </p>
                ) : null}
                {operation === 'video.generate' ? (
                  selectedModel?.available &&
                  selectedModel.unitPrice &&
                  quoteAccepted &&
                  currentWork.brief?.confirmedAt &&
                  groundingMissing.length === 0 ? (
                    <VideoWorkflowPanel
                      aigcLabelEnabled={aigcLabelEnabled}
                      brandWatermarkText={
                        watermarkEnabled
                          ? productQuery.data?.store?.name.trim() ||
                            p1_canvas_export_brand_fallback()
                          : undefined
                      }
                      catalogModelId={selectedModel.id}
                      catalogModelNames={Object.fromEntries(
                        catalog.models.map((model) => [
                          model.id,
                          model.displayName,
                        ])
                      )}
                      catalogModelName={selectedModel.displayName}
                      dataClass={videoDataClass}
                      intent={currentWork.intent}
                      key={currentWork.id}
                      referenceAssetIds={videoReferenceAssetIds}
                      workId={currentWork.id}
                    />
                  ) : (
                    <p className="rounded-md border border-dashed border-divider p-3 text-sm text-muted-foreground">
                      {workbench_video_contract_required()}
                    </p>
                  )
                ) : (
                  <Button
                    data-testid="execute-tool-action"
                    disabled={
                      !selectedModel?.available ||
                      !selectedModel.unitPrice ||
                      !quoteAccepted ||
                      !currentWork.brief?.confirmedAt ||
                      groundingMissing.length > 0 ||
                      updateDraft.isPending ||
                      submitWork.isPending ||
                      copyStream.isLoading ||
                      currentJob?.status === 'running' ||
                      currentJob?.status === 'submitting'
                    }
                    onClick={() =>
                      operation === 'copy.generate'
                        ? submitCopyStream()
                        : submitWork.mutate()
                    }
                    type="button"
                  >
                    <ProductIcon icon={IconBolt} size={18} />
                    {workbench_submit_job()}
                  </Button>
                )}
                {submissionBlocker ? (
                  <p
                    className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
                    data-testid="creative-submission-blocker"
                    role="alert"
                  >
                    {submissionBlocker}
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

            {operation === 'copy.generate' &&
            shouldShowCopyStreamPanel({
              completed: currentJob?.status === 'completed',
              hasError: Boolean(copyStream.error),
              hasObject: Boolean(copyStream.object),
              interrupted: Boolean(copyStreamInterruption),
              loading: copyStream.isLoading,
            }) ? (
              <RecordSection
                className={
                  workbenchStage === 'running' ? 'order-first' : undefined
                }
                eyebrow={workbench_record_streaming()}
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
                          onClick={submitCopyStream}
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
              <RecordSection
                className="order-first"
                eyebrow={workbench_record_job()}
                title={workbench_section_job()}
              >
                <div className="space-y-3 rounded-md bg-surface-2 p-4">
                  <ProductStatus announce showExplanation status="submitting" />
                  <GenerationAccent label={workbench_submitting_accent()} />
                  <div>
                    <p className="font-medium">
                      {workbench_submitting_title()}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedModel?.displayName ?? workbench_selected_model()}{' '}
                      · {quote.outputLabel}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {workbench_submitting_description()}
                    </p>
                  </div>
                </div>
              </RecordSection>
            ) : currentJob ? (
              <RecordSection
                className={
                  workbenchStage === 'running' ? 'order-first' : undefined
                }
                eyebrow={workbench_record_job()}
                title={workbench_section_job()}
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

            {hasPersistedResult &&
            currentJob?.contract.operation === 'copy.generate' ? (
              <RecordSection
                eyebrow={workbench_record_results()}
                hero
                testId="workbench-result-hero"
                title={workbench_section_results()}
              >
                <ResultProvenance job={currentJob} />
                <CopyCandidateSelector
                  assets={currentSessionAssets}
                  contents={currentContents}
                  job={currentJob}
                  onChanged={refreshProjection}
                  packages={contentPackages}
                  productVisualAssets={(currentWork.sourceReferences ?? [])
                    .flatMap((source) =>
                      source.kind === 'asset'
                        ? (productQuery.data?.assets ?? []).filter(
                            (asset) =>
                              asset.id === source.id &&
                              asset.mediaType === 'image' &&
                              isContentPackageEligibleAsset(asset)
                          )
                        : []
                    )
                    .map((asset) => ({
                      id: asset.id,
                      title: asset.tags.at(-1) ?? workbench_uploaded_image(),
                    }))}
                />
              </RecordSection>
            ) : hasPersistedResult && currentAssets.length > 0 ? (
              <RecordSection
                eyebrow={workbench_record_results()}
                hero
                testId="workbench-result-hero"
                title={workbench_section_results()}
              >
                <ResultProvenance job={currentJob} />
                <div className="grid gap-3 md:grid-cols-2">
                  {currentAssets.map((asset) => {
                    return (
                      <Card key={asset.id}>
                        <CardHeader>
                          <CardTitle className="text-base">
                            {asset.title}
                          </CardTitle>
                          <CardDescription>
                            {asset.kind === 'video'
                              ? workbench_video_result()
                              : workbench_image_result()}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <CanonicalMediaGallery
                            media={canonicalMediaForAssetIds(
                              projection.assets,
                              productQuery.data?.assets ?? [],
                              [asset.id]
                            )}
                            presentation="hero"
                          />
                          {asset.body ? (
                            <AiMarkdown
                              className="prose prose-sm max-w-none dark:prose-invert"
                              content={asset.body}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {workbench_result_saved_description()}
                            </p>
                          )}
                          <Badge variant="secondary">
                            {workbench_result_saved_as_asset()}
                          </Badge>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </RecordSection>
            ) : null}

            {currentWork.status === 'completed' ||
            currentWork.status === 'accepted' ? (
              <RecordSection
                eyebrow={workbench_record_next()}
                title={workbench_section_next()}
              >
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
