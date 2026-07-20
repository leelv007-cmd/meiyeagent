import { uploadProductAsset } from '@/api/product-assets';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { buildRelayLocation } from '@/product/device-relay';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AiMarkdown } from '@/components/markdown/ai-markdown';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  common_cancel,
  composer_image_confirm_facts,
  composer_image_confirm_upload,
  composer_image_contains_minor,
  composer_image_contains_person,
  composer_image_contains_sensitive_data,
  composer_image_facts_confirmed,
  composer_image_no,
  composer_image_preview_alt,
  composer_image_yes,
  content_package_detail_title,
  content_package_download_export,
  content_package_legacy_history,
  content_package_recreate_with_assets,
  copy_candidate_accept,
  copy_candidate_accepted_badge,
  copy_candidate_conversion_hook_label,
  creation_entry_all_scenes,
  creation_entry_create,
  creation_entry_guidance_title,
  creation_entry_intent_aria,
  creation_entry_intent_placeholder_short,
  creation_entry_platform_douyin,
  creation_entry_scene_legend,
  integration_douyin_not_integrated_badge,
  integration_douyin_not_integrated_description,
  mobile_action_accept_content,
  mobile_action_acceptance_accepted,
  mobile_action_acceptance_pending,
  mobile_action_acceptance_rejected,
  mobile_action_acceptance_unknown,
  mobile_action_accepted_content,
  mobile_action_camera_denied_description,
  mobile_action_camera_denied_title,
  mobile_action_capture_camera,
  mobile_action_capture_library,
  mobile_action_capture_material,
  mobile_action_capture_title,
  mobile_action_confirm_asset,
  mobile_action_content_body,
  mobile_action_content_title,
  mobile_action_desktop_continue,
  mobile_action_desktop_relay_description,
  mobile_action_desktop_relay_title,
  mobile_action_example_remix_saved,
  mobile_action_generation_task,
  mobile_action_handoff_description,
  mobile_action_handoff_pending,
  mobile_action_handoff_published,
  mobile_action_job_action_failed,
  mobile_action_job_output,
  mobile_action_job_output_audio,
  mobile_action_job_output_copy,
  mobile_action_job_output_image,
  mobile_action_job_output_video,
  mobile_action_l1_acceptance,
  mobile_action_l1_confirm_submit,
  mobile_action_l1_status_title,
  mobile_action_l3_create_handoff,
  mobile_action_l3_created,
  mobile_action_l3_handoff_title,
  mobile_action_legacy_read_only,
  mobile_action_next_eyebrow,
  mobile_action_no_accepted_content_description,
  mobile_action_no_accepted_content_title,
  mobile_action_no_job_description,
  mobile_action_no_job_title,
  mobile_action_one_action_at_a_time,
  mobile_action_open_handoff,
  mobile_action_open_job,
  mobile_action_open_task,
  mobile_action_precise_layout_desktop,
  mobile_action_prepare_publish,
  mobile_action_processing,
  mobile_action_publish_confirmed_manual,
  mobile_action_publish_confirmed_platform,
  mobile_action_publish_failed,
  mobile_action_publish_l3_description,
  mobile_action_regenerate,
  mobile_action_resume_generation,
  mobile_action_resume_job,
  mobile_action_retry_updates,
  mobile_action_return_description,
  mobile_action_returned_from_feishu,
  mobile_action_returned_from_notification,
  mobile_action_save_text_edit,
  mobile_action_stage_action,
  mobile_action_stage_handoff,
  mobile_action_stage_progress,
  mobile_action_stages_aria,
  mobile_action_status_failed,
  mobile_action_status_manual_required,
  mobile_action_status_published,
  mobile_action_status_reviewing,
  mobile_action_status_submitted,
  mobile_action_status_submitting,
  mobile_action_status_unknown,
  mobile_action_sync_error_description,
  mobile_action_sync_error_title,
  mobile_action_task_open_description,
  mobile_action_task_title,
  mobile_action_technical_failure_usage,
  mobile_action_title,
  mobile_action_update_failed,
  mobile_action_upload_failed,
  mobile_action_upload_interrupted_status,
  mobile_action_upload_local_status,
  mobile_action_upload_not_saved,
  mobile_action_upload_persisted_status,
  mobile_action_upload_resume_description,
  mobile_action_upload_same_file,
  mobile_action_upload_saved,
  mobile_action_upload_stored_status,
  mobile_action_upload_success,
  mobile_action_upload_video_preview,
  mobile_action_uploading_status,
  mobile_action_verify_job,
  mobile_action_verify_only,
  product_navigation_workbench,
  mobile_package_composition_images,
  mobile_package_composition_title,
  mobile_package_composition_video,
  video_workflow_launcher_catalog_loading,
  workbench_compliance_summary,
  workbench_no_references,
  workbench_record_intent,
  workbench_record_references,
  workbench_section_intent,
  workbench_source_insert_failed,
  workbench_show_example,
  workbench_switch_off,
  workbench_switch_on,
  workbench_uploaded_image,
  workbench_work_create_failed,
  workbench_work_created,
  workbench_harness_alternatives,
  workbench_harness_primary,
} from '@/locale/paraglide/messages';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { emitTelemetry } from '@/lib/product-telemetry';
import { getLocale } from '@/lib/locale';
import { getPathWithLocale } from '@/lib/urls';
import {
  taskView,
  templateViews,
  type RawInbox,
} from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  type ComplianceDefaults,
  useComplianceDefaults,
} from '@/p1/use-compliance-defaults';
import { useIntegrationSettings } from '@/p1/use-integration-settings';
import type {
  ContentPackage,
  ContentItem,
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
  CreativeWorkbenchProjection,
  ProductState,
} from '@meiye/contracts';
import {
  contentPackageActions,
  contentPackageStatusLabel,
} from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBell,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCloudUpload,
  IconDeviceDesktop,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Ref, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProductStatus } from '@/components/uiux/product-status';
import { PublishCelebration } from '@/components/uiux/publish-celebration';
import { useProductState } from './client';
import { CopyCandidateSelector } from './copy-candidate-selector';
import {
  buildCopyCandidateSelectorModel,
  currentCreativeJobForWork,
} from './copy-candidate-selector-model';
import {
  creativeJobObservation,
  useCreativeJobObserver,
} from './creative-job-observer';
import {
  createMobileUploadSession,
  identifyMobileUploadFile,
  markMobileUploadPersisted,
  markMobileUploadStored,
  readMobileUploadSession,
  resumeMobileUploadSession,
  type MobileUploadSession,
  writeMobileUploadSession,
} from './mobile-upload-session';
import { publishedTransitions } from './published-transition';
import { VideoWorkflowPanel } from './video-workflow-panel';
import { ExampleStorePreview } from './example-store-preview';
import {
  CREATION_DRAFT_INTENT_STORAGE_KEY,
  confirmedAssetFacts,
  exampleStoreVisibility,
  openingSuggestions,
  readCreationDraftIntent,
  type AssetFactAnswers,
  type ConfirmedAssetFacts
  writeCreationDraftIntent,
} from './creation-entry-model';
import { assistantSourceSummaries } from './creation-assistant-context';
import type { CreationCatalogResponse } from './creation-catalog-model';
import { CanonicalMediaGallery } from './canonical-media-gallery';
import { canonicalMediaForAssetIds } from './canonical-history-model';
import { contentCount, type LegacyContentCountItem } from './content-count';
import { mobileContentPackage } from './mobile-content-package';
import { CreationModePicker } from './creation-entry';
import { VideoWorkflowLauncher } from './video-workflow-launcher';
import { harnessCandidateResultModel } from './workbench-state-model';

type MobileStage = 'action' | 'progress' | 'handoff';
type MobileCreationOperation = 'copy.generate' | 'video.generate';

interface PendingMobileUpload {
  answers: AssetFactAnswers;
  confirmed: boolean;
  file: File;
  previewUrl: string;
}

export function mobileCreationPlan({
  intent,
  operation,
  referenceAssetIds,
  sessionId,
}: {
  intent: string;
  operation: MobileCreationOperation;
  referenceAssetIds: readonly string[];
  sessionId: string;
}) {
  return {
    operation,
    startsVideoWorkflow: operation === 'video.generate',
    work: {
      contentModules: ['social_cover'] as const,
      intent: intent.trim(),
      mode: 'agent' as const,
      sessionId,
      sourceReferences: referenceAssetIds.map((id) => ({
        id,
        kind: 'asset' as const,
      })),
    },
  };
}

export function mobileVideoCompliance(defaults?: Partial<ComplianceDefaults>) {
  return {
    aigcLabelEnabled: defaults?.['compliance.aigc_label.default'] ?? true,
    watermarkEnabled: defaults?.['compliance.watermark.default'] ?? false,
  };
}

export type MobileVideoComplianceState =
  | { kind: 'pending' }
  | {
      compliance: ReturnType<typeof mobileVideoCompliance>;
      kind: 'fallback' | 'ready';
    };

export function mobileVideoComplianceState({
  defaults,
  status,
}: {
  defaults?: Partial<ComplianceDefaults>;
  status: 'error' | 'pending' | 'success';
}): MobileVideoComplianceState {
  if (defaults) {
    return {
      compliance: mobileVideoCompliance(defaults),
      kind: 'ready',
    };
  }
  if (status !== 'error') {
    return { kind: 'pending' };
  }
  return {
    compliance: mobileVideoCompliance(),
    kind: 'fallback',
  };
}

export function MobileVideoComplianceNotice({
  state,
}: {
  state: MobileVideoComplianceState;
}) {
  if (state.kind === 'pending') {
    return (
      <Button aria-busy="true" className="w-full" disabled type="button">
        {video_workflow_launcher_catalog_loading()}
      </Button>
    );
  }
  if (state.kind === 'fallback') {
    return (
      <Alert variant="destructive">
        <AlertTitle>{mobile_action_sync_error_title()}</AlertTitle>
        <AlertDescription>
          {mobile_action_sync_error_description()}{' '}
          {workbench_compliance_summary({
            aigc: workbench_switch_on(),
            watermark: workbench_switch_off(),
          })}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function mobileCreationSessionId() {
  const key = 'meiye:creative-session-id';
  const stored = window.sessionStorage.getItem(key);
  if (stored) return stored;
  const created = `session-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

const emptyProjection: CreativeWorkbenchProjection = {
  assets: [],
  contents: [],
  events: [],
  jobs: [],
  works: [],
};

const STAGE_LABELS: Record<MobileStage, () => string> = {
  action: mobile_action_stage_action,
  progress: mobile_action_stage_progress,
  handoff: mobile_action_stage_handoff,
};

const UPLOAD_PHASE_LABELS: Record<MobileUploadSession['phase'], () => string> =
  {
    interrupted: mobile_action_upload_interrupted_status,
    local: mobile_action_upload_local_status,
    persisted: mobile_action_upload_persisted_status,
    stored: mobile_action_upload_stored_status,
    uploading: mobile_action_uploading_status,
  };

const L1_STATUS_LABELS: Record<string, () => string> = {
  failed: mobile_action_status_failed,
  manual_required: mobile_action_status_manual_required,
  published: mobile_action_status_published,
  reviewing: mobile_action_status_reviewing,
  submitted: mobile_action_status_submitted,
  submitting: mobile_action_status_submitting,
  unknown: mobile_action_status_unknown,
};

const L1_ACCEPTANCE_LABELS: Record<string, () => string> = {
  acceptance_unknown: mobile_action_acceptance_unknown,
  accepted: mobile_action_acceptance_accepted,
  rejected_before_accept: mobile_action_acceptance_rejected,
};

export function mobileHarnessPackage(
  contentPackages: readonly ContentPackage[],
  work: CreativeWorkbenchProjection['works'][number] | undefined
) {
  if (work?.mode !== 'agent') return undefined;
  return contentPackages.find(
    (contentPackage) =>
      contentPackage.kind === 'image_text' &&
      contentPackage.source.workId === work.id &&
      contentPackage.source.workflowId === work.id
  );
}

export function mobileHarnessAdoptionRequest(
  contentPackage: Pick<ContentPackage, 'id' | 'revision'>,
  candidateId: string
) {
  return {
    action: 'adopt_harness_candidate' as const,
    key: `mobile-adopt-harness-candidate-${contentPackage.id}-${contentPackage.revision}-${candidateId}`,
    payload: {
      candidateId,
      expectedRevision: contentPackage.revision,
      packageId: contentPackage.id,
    },
  };
}

export function MobileHarnessCandidateResults({
  busy,
  contentPackage,
  onAdopt,
}: {
  busy: boolean;
  contentPackage: ContentPackage;
  onAdopt: (candidateId: string) => void;
}) {
  const result = harnessCandidateResultModel(contentPackage);
  if (!result) return null;
  const candidates = [result.primary, ...result.alternatives];
  return (
    <section
      aria-label={mobile_action_accept_content()}
      className="grid gap-3"
      data-testid="mobile-harness-candidates"
    >
      {candidates.map((candidate, index) => {
        const adopted = result.adoptedCandidateId === candidate.candidateId;
        return (
          <Card
            data-adopted={adopted}
            data-harness-candidate-id={candidate.candidateId}
            key={candidate.candidateId}
            size="sm"
          >
            <CardHeader>
              <CardDescription>
                {index === 0
                  ? workbench_harness_primary()
                  : workbench_harness_alternatives()}
                {` · ${candidate.score}`}
              </CardDescription>
              <CardTitle className="text-base">{candidate.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                aria-pressed={adopted}
                className="min-h-touch-target w-full"
                data-harness-priority={index === 0 ? 'primary' : 'alternative'}
                disabled={busy || adopted}
                onClick={() => onAdopt(candidate.candidateId)}
                type="button"
                variant={
                  adopted ? 'secondary' : index === 0 ? 'default' : 'outline'
                }
              >
                {adopted
                  ? copy_candidate_accepted_badge()
                  : copy_candidate_accept()}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

export function MobileTaskHeader({
  description,
  nextAction,
}: {
  description: string;
  nextAction: string;
}) {
  return (
    <section className="meiye-ambient-copy">
      <h1 className="meiye-type-title">{mobile_action_title()}</h1>
      <p className="meiye-type-aux">{mobile_action_next_eyebrow()}</p>
      <h2 className="meiye-type-aux mt-1 font-semibold">{nextAction}</h2>
      <p className="meiye-type-aux mt-1">{description}</p>
    </section>
  );
}

function l1StatusLabel(status: string) {
  return L1_STATUS_LABELS[status]?.() ?? mobile_action_status_unknown();
}

function l1AcceptanceLabel(acceptance?: string) {
  return acceptance
    ? (L1_ACCEPTANCE_LABELS[acceptance]?.() ??
        mobile_action_acceptance_unknown())
    : mobile_action_acceptance_pending();
}

function MobileFactChoice({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: boolean) => void;
  value: boolean | undefined;
}) {
  return (
    <fieldset className="space-y-2 bg-surface-1 p-3">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            [false, composer_image_no()],
            [true, composer_image_yes()],
          ] as const
        ).map(([next, text]) => (
          <Button
            aria-pressed={value === next}
            key={text}
            onClick={() => onChange(next)}
            size="sm"
            type="button"
            variant={value === next ? 'secondary' : 'outline'}
          >
            {text}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

export function MobileCreationControls({
  intent,
  intentRef,
  onIntentChange,
  onOperationChange,
  onSubmit,
  operation,
  pending,
}: {
  intent: string;
  intentRef?: Ref<HTMLTextAreaElement>;
  onIntentChange: (intent: string) => void;
  onOperationChange: (operation: MobileCreationOperation) => void;
  onSubmit: () => void;
  operation: MobileCreationOperation;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <CreationModePicker
        disabled={pending}
        onChange={onOperationChange}
        operation={operation}
      />
      <Textarea
        aria-label={creation_entry_intent_aria()}
        className="resize-none text-base"
        disabled={pending}
        onChange={(event) => onIntentChange(event.target.value)}
        placeholder={creation_entry_intent_placeholder_short()}
        ref={intentRef}
        rows={4}
        value={intent}
      />
      <Button
        className="w-full"
        disabled={pending || intent.trim().length < 2}
        onClick={onSubmit}
        type="button"
      >
        <IconPlayerPlay />
        {pending ? mobile_action_processing() : creation_entry_create()}
      </Button>
    </div>
  );
}

function jobOutputLabel(
  operation:
    | 'copy.adapt'
    | 'copy.generate'
    | 'image.edit'
    | 'image.generate'
    | 'video.generate'
    | 'audio.speech'
    | 'audio.sfx',
  count: number
) {
  if (operation.startsWith('copy.')) {
    return mobile_action_job_output_copy({ count });
  }
  if (operation === 'video.generate') {
    return mobile_action_job_output_video({ count });
  }
  if (operation.startsWith('audio.')) {
    return mobile_action_job_output_audio({ count });
  }
  return mobile_action_job_output_image({ count });
}

function currentVersion(
  content: ContentItem,
  platform?: 'xiaohongshu' | 'douyin'
) {
  const variant =
    content.variants.find((candidate) => candidate.platform === platform) ??
    content.variants[0];
  return variant?.versions.find(
    (candidate) => candidate.id === variant.currentVersionId
  );
}

function currentPackageVersion(contentPackage: ContentPackage) {
  return contentPackage.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
}

function mobileIdempotencyHash(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

function mobileEditIdempotencyKey(value: string) {
  return `mobile-content-package-edit-${mobileIdempotencyHash(value)}`;
}

export function mobileRetryIdempotencyKeys(
  job: Pick<CreativeJob, 'failureCode' | 'id' | 'updatedAt'>
) {
  const failureFingerprint = mobileIdempotencyHash(
    JSON.stringify([job.id, job.failureCode ?? null, job.updatedAt])
  );
  return {
    idempotencyKey: `mobile-retry-command-${failureFingerprint}`,
    submissionKey: `mobile-retry-${failureFingerprint}`,
  };
}

function latest<T extends { updatedAt: string }>(items: T[]) {
  return items.reduce<T | undefined>(
    (current, item) =>
      !current || item.updatedAt >= current.updatedAt ? item : current,
    undefined
  );
}

export function selectMobileCreativeWork({
  createdWork,
  creatingNew,
  workId,
  works,
}: {
  createdWork?: CreativeWorkbenchProjection['works'][number];
  creatingNew: boolean;
  workId?: string;
  works: CreativeWorkbenchProjection['works'];
}) {
  if (creatingNew) return undefined;
  return (
    createdWork ??
    (workId ? works.find((work) => work.id === workId) : latest(works))
  );
}

function initialUploadSession() {
  const session = readMobileUploadSession();
  if (!session) return undefined;
  return session.phase === 'uploading' || session.phase === 'stored'
    ? { ...session, phase: 'interrupted' as const }
    : session;
}

export function MobilePackageComposition({
  contentPackage,
  creativeAssets,
  productAssets,
}: {
  contentPackage: ContentPackage;
  creativeAssets: CreativeAssetProjection[];
  productAssets: ProductState['assets'];
}) {
  const version = currentPackageVersion(contentPackage);
  if (!version) return null;
  const isVideo = contentPackage.kind === 'video';
  const media = isVideo
    ? []
    : version.orderedAssetIds.flatMap((assetId) => {
        const ownedAsset = contentPackage.generated.ownedAssets?.find(
          (asset) => asset.id === assetId
        );
        if (ownedAsset) {
          return ownedAsset.contentType.startsWith('image/')
            ? [
                {
                  assetId: ownedAsset.id,
                  href: `/dashboard/assets/${encodeURIComponent(ownedAsset.id)}`,
                  kind: 'image' as const,
                  src: `/api/core/p1/assets?objectKey=${encodeURIComponent(ownedAsset.objectKey)}`,
                  title: version.title,
                },
              ]
            : [];
        }
        return canonicalMediaForAssetIds(creativeAssets, productAssets, [
          assetId,
        ]).filter((asset) => asset.kind === 'image');
      });

  return (
    <section className="rounded-lg border border-divider p-3">
      <h3 className="text-sm font-medium">
        {mobile_package_composition_title()}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {isVideo
          ? mobile_package_composition_video()
          : mobile_package_composition_images({
              count: version.orderedAssetIds.length,
            })}
      </p>
      {media.length > 0 ? (
        <CanonicalMediaGallery
          className="mt-3 grid-cols-3 sm:grid-cols-4"
          media={media}
          showMeta={false}
        />
      ) : null}
    </section>
  );
}

export function MobilePackageSharedActions({
  contentPackage,
  onCancel,
  pending,
}: {
  contentPackage: ContentPackage;
  onCancel(): void;
  pending: boolean;
}) {
  const actions = contentPackageActions(contentPackage.status);

  return (
    <div className="flex flex-wrap gap-2">
      <a
        className={buttonVariants({
          className: 'min-h-touch-target',
          variant: 'outline',
        })}
        href={getPathWithLocale(
          buildRelayLocation({
            kind: 'package',
            packageId: contentPackage.id,
            stage: 'action',
          }).pathWithSearch
        )}
      >
        <IconDeviceDesktop />
        {mobile_action_desktop_continue()}
      </a>
      {actions.includes('recreate') ? (
        <a
          className={buttonVariants({
            className: 'min-h-touch-target',
            variant: 'outline',
          })}
          href={getPathWithLocale(
            contentPackage.source.workId
              ? buildRelayLocation({
                  kind: 'work',
                  workId: contentPackage.source.workId,
                }).pathWithSearch
              : '/dashboard'
          )}
        >
          {content_package_recreate_with_assets()}
        </a>
      ) : null}
      {actions.includes('cancel') ? (
        <Button
          className="min-h-touch-target"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          {common_cancel()}
        </Button>
      ) : null}
    </div>
  );
}

export function MobilePackageStatusCard({
  contentPackage,
  onCancel,
  pending,
}: {
  contentPackage: ContentPackage;
  onCancel(): void;
  pending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{content_package_detail_title()}</span>
          <Badge variant="outline">
            {contentPackageStatusLabel(contentPackage.status)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <MobilePackageSharedActions
          contentPackage={contentPackage}
          onCancel={onCancel}
          pending={pending}
        />
      </CardContent>
    </Card>
  );
}

export function MobileLegacyContentHistory({
  creativeContents,
  productContents,
}: {
  creativeContents: CreativeContent[];
  productContents: ContentItem[];
}) {
  const items = [
    ...productContents.map((content) => {
      const version = currentVersion(content);
      return {
        body: version?.body ?? '',
        id: content.id,
        source: 'product',
        title: version?.title ?? content.scenario,
      };
    }),
    ...creativeContents.map((content) => ({
      body: content.body,
      id: content.id,
      source: 'creative',
      title: content.title,
    })),
  ];
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {content_package_legacy_history({ count: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-divider">
          {items.map((item) => (
            <article
              className="space-y-2 py-3 first:pt-0 last:pb-0"
              data-legacy-source={item.source}
              key={`${item.source}:${item.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-medium">{item.title}</h3>
                <Badge variant="outline">
                  {mobile_action_legacy_read_only()}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function MobileExampleStore({
  assetCount,
  contentPackages,
  example,
  hideError,
  hiding,
  legacyContents,
  onHide,
  onOpen,
  onRemix,
  opened,
  queriesReady,
  taskCount,
  workCount,
}: {
  assetCount: number;
  contentPackages: ContentPackage[];
  example: ProductState['exampleStore'];
  hideError?: string;
  hiding: boolean;
  legacyContents: readonly LegacyContentCountItem[];
  onHide: () => void;
  onOpen: () => void;
  onRemix: (intent: string) => void;
  opened: boolean;
  queriesReady: boolean;
  taskCount: number;
  workCount: number;
}) {
  const visibility = exampleStoreVisibility({
    assetCount,
    contentCount: contentCount(legacyContents, contentPackages),
    hidden: false,
    queriesReady,
    taskCount,
    workCount,
  });
  if (visibility !== 'visible') return null;
  if (!opened) {
    return (
      <div className="text-center">
        <Button onClick={onOpen} type="button" variant="ghost">
          {workbench_show_example()}
        </Button>
      </div>
    );
  }

  return (
    <ExampleStorePreview
      example={example}
      hideError={hideError}
      hiding={hiding}
      onHide={onHide}
      onRemix={onRemix}
    />
  );
}

export function MobilePublishRoutes({
  canCreateL3,
  creatingL3 = false,
  downloadHref,
  douyinIntegrated,
  onCreateL3,
}: {
  canCreateL3: boolean;
  creatingL3?: boolean;
  downloadHref?: string;
  douyinIntegrated: boolean;
  onCreateL3: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mobile_action_prepare_publish()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2 rounded-lg border border-divider p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {creation_entry_platform_douyin()} · L1
            </span>
            {!douyinIntegrated ? (
              <Badge variant="outline">
                {integration_douyin_not_integrated_badge()}
              </Badge>
            ) : null}
          </div>
          {!douyinIntegrated ? (
            <p className="text-muted-foreground">
              {integration_douyin_not_integrated_description()}
            </p>
          ) : null}
          <Button className="min-h-touch-target" disabled type="button">
            {mobile_action_l1_confirm_submit()}
          </Button>
        </div>
        <div className="space-y-2 rounded-lg border border-divider p-3">
          <p className="font-medium">L3</p>
          <p className="text-muted-foreground">
            {mobile_action_publish_l3_description()}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-touch-target"
              disabled={!canCreateL3 || creatingL3}
              onClick={onCreateL3}
              type="button"
              variant="outline"
            >
              {creatingL3
                ? mobile_action_processing()
                : mobile_action_l3_create_handoff()}
            </Button>
            {downloadHref ? (
              <a
                className={buttonVariants({
                  className: 'min-h-touch-target',
                  variant: 'outline',
                })}
                href={downloadHref}
              >
                {content_package_download_export()}
              </a>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MobileActionBook({
  entry,
  onWorkIdChange,
  stage: requestedStage,
  packageId,
  workId,
}: {
  entry?: 'feishu' | 'notification';
  onWorkIdChange?: (workId: string) => Promise<void> | void;
  stage?: MobileStage;
  packageId?: string;
  workId?: string;
}) {
  const product = useProductState();
  const queryClient = useQueryClient();
  const complianceDefaults = useComplianceDefaults();
  const videoComplianceState = mobileVideoComplianceState({
    defaults: complianceDefaults.data,
    status: complianceDefaults.isPending
      ? 'pending'
      : complianceDefaults.isError
        ? 'error'
        : 'success',
  });
  const [stage, setStage] = useState<MobileStage>(requestedStage ?? 'action');
  const integrationsEnabled = stage !== 'action' || Boolean(entry);
  const integrations = useIntegrationSettings(integrationsEnabled);
  const [uploadSession, setUploadSession] = useState<
    MobileUploadSession | undefined
  >(initialUploadSession);
  const [pendingUpload, setPendingUpload] = useState<PendingMobileUpload>();
  const [cameraDenied, setCameraDenied] = useState(false);
  const publishedSnapshotRef = useRef<Record<string, string> | undefined>(
    undefined
  );
  const [celebratedPublishId, setCelebratedPublishId] = useState<string>();
  const [draftIntent, setDraftIntent] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (readCreationDraftIntent(window.sessionStorage) ?? '')
  );
  const [creationOperation, setCreationOperation] =
    useState<MobileCreationOperation>('copy.generate');
  const [creatingNew, setCreatingNew] = useState(false);
  const [createdWork, setCreatedWork] =
    useState<CreativeWorkbenchProjection['works'][number]>();
  const [videoComposerWorkId, setVideoComposerWorkId] = useState<string>();
  const [exampleOpened, setExampleOpened] = useState(false);
  const [selectedGuidanceId, setSelectedGuidanceId] = useState<string>();
  const draftIntentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previewUrl = pendingUpload?.previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [pendingUpload?.previewUrl]);

  const inboxQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'inbox', { ui: 'mobile' }),
    queryFn: ({ signal }) => operationsQuery<RawInbox>('inbox', {}, signal),
  });
  const creativeQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
  });
  const creationCatalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  const creative = creativeQuery.data ?? emptyProjection;
  const contentPackagesQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackage[]>('content_packages', {}, signal),
  });
  const contentPackages = contentPackagesQuery.data ?? [];
  const boundWorkId = creatingNew ? undefined : (createdWork?.id ?? workId);
  const currentPackage = creatingNew
    ? undefined
    : mobileContentPackage(contentPackages, {
        packageId,
        workId: boundWorkId,
      });
  const currentPackageVersionValue = currentPackage
    ? currentPackageVersion(currentPackage)
    : undefined;
  const [packageTitle, setPackageTitle] = useState('');
  const [packageBody, setPackageBody] = useState('');
  useEffect(() => {
    setPackageTitle(currentPackageVersionValue?.title ?? '');
    setPackageBody(currentPackageVersionValue?.body ?? '');
  }, [currentPackageVersionValue?.body, currentPackageVersionValue?.title]);
  const currentWork = selectMobileCreativeWork({
    createdWork,
    creatingNew,
    workId: boundWorkId,
    works: creative.works,
  });
  const currentHarnessPackage = mobileHarnessPackage(
    contentPackages,
    currentWork
  );
  const templateItems = templateViews(
    creationCatalogQuery.data?.templates ?? [],
    creationCatalogQuery.data?.userTemplates ?? [],
    creationCatalogQuery.data?.shortcuts ?? []
  );
  const sourceLabels = assistantSourceSummaries({
    assets: (product.state?.assets ?? []).map((asset) => ({
      id: asset.id,
      label: asset.tags[0] ?? asset.mediaType,
    })),
    contents: creative.contents.map((content) => ({
      id: content.id,
      label: content.title,
    })),
    references: currentWork?.sourceReferences ?? [],
    tasks: (inboxQuery.data?.tasks ?? []).map((task) => ({
      id: task.id,
      label: taskView(task).title,
    })),
    templates: templateItems.map((template) => ({
      id: template.id,
      label: template.name,
    })),
    works: creative.works.map((work) => ({
      id: work.id,
      label: work.intent,
    })),
  });
  const currentSourceReferences = (currentWork?.sourceReferences ?? []).map(
    (source, index) => ({ ...source, label: sourceLabels[index] })
  );
  const currentJob = currentCreativeJobForWork(currentWork, creative.jobs);
  const currentJobAssets = currentJob
    ? creative.assets.filter((asset) => asset.jobId === currentJob.id)
    : [];
  const currentJobContents = currentJob
    ? creative.contents.filter((content) => content.jobId === currentJob.id)
    : [];
  const currentCopyCandidateModel =
    currentJob?.contract.operation === 'copy.generate'
      ? buildCopyCandidateSelectorModel({
          assets: currentJobAssets,
          contents: currentJobContents,
          job: currentJob,
          packages: contentPackages,
        })
      : undefined;
  const hasCompleteCopyCandidates =
    currentCopyCandidateModel?.status !== undefined &&
    currentCopyCandidateModel.status !== 'invalid';
  const hasPendingCopyDecision = currentCopyCandidateModel?.status === 'ready';
  const hasAcceptedCopyDecision =
    currentCopyCandidateModel?.status === 'accepted';
  const currentJobObserver = useCreativeJobObserver(
    creativeJobObservation(currentJob)
  );

  useEffect(() => {
    if (!requestedStage && hasPendingCopyDecision) {
      setStage('progress');
    }
  }, [hasPendingCopyDecision, requestedStage]);
  const nextRawTask = inboxQuery.data?.tasks.find(
    (task) => task.status !== 'done' && task.status !== 'archived'
  );
  const nextTask = nextRawTask ? taskView(nextRawTask) : undefined;
  const suggestions = openingSuggestions({
    assets: (product.state?.assets ?? []).map((asset) => ({
      id: asset.id,
      label: asset.tags[0] ?? asset.mediaType,
    })),
    tasks: (inboxQuery.data?.tasks ?? []).map((task) => ({
      id: task.id,
      title: taskView(task).title,
    })),
  });
  const updateDraftIntent = (
    nextIntent: string,
    source?: { guidanceId?: string }
  ) => {
    setDraftIntent(nextIntent);
    setSelectedGuidanceId(source?.guidanceId);
    if (!writeCreationDraftIntent(window.sessionStorage, nextIntent)) {
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    }
    window.requestAnimationFrame(() => draftIntentRef.current?.focus());
  };
  const acceptedContents =
    product.state?.contents.filter(
      (content) => content.selected && content.status !== 'published'
    ) ?? [];
  const candidateContents =
    product.state?.contents.filter(
      (content) => !content.selected && content.status === 'candidate'
    ) ?? [];
  const currentContent = acceptedContents.at(-1) ?? candidateContents.at(-1);
  const currentHandoff = product.state?.handoffPackages.at(-1);
  const l1Jobs = Object.values(integrations.douyinProducts).flatMap(
    (snapshot) => snapshot.publishJobs
  );
  const currentL1Job = latest(l1Jobs);
  const persistedUploadAsset = uploadSession?.persistedAssetId
    ? product.state?.assets.find(
        (asset) => asset.id === uploadSession.persistedAssetId
      )
    : undefined;
  const legacyContents: LegacyContentCountItem[] = [
    ...(product.state?.contents ?? []).map((content) => ({
      id: content.id,
      sourceType: 'product_content_item' as const,
    })),
    ...creative.contents.map((content) => ({
      id: content.id,
      sourceType: 'creative_content' as const,
    })),
  ];

  useEffect(() => {
    const values = [
      ...(currentL1Job
        ? [{ id: `l1:${currentL1Job.id}`, status: currentL1Job.status }]
        : []),
      ...(currentHandoff
        ? [{ id: `l3:${currentHandoff.id}`, status: currentHandoff.status }]
        : []),
    ];
    const transition = publishedTransitions(
      publishedSnapshotRef.current,
      values
    );
    publishedSnapshotRef.current = transition.snapshot;
    if (transition.newlyPublished[0]) {
      setCelebratedPublishId(transition.newlyPublished[0]);
    }
  }, [
    currentHandoff?.id,
    currentHandoff?.status,
    currentL1Job?.id,
    currentL1Job?.status,
  ]);

  useEffect(() => {
    if (!celebratedPublishId) return;
    const timeout = window.setTimeout(
      () => setCelebratedPublishId(undefined),
      4_000
    );
    return () => window.clearTimeout(timeout);
  }, [celebratedPublishId]);

  useEffect(() => {
    if (!requestedStage) return;
    setStage(requestedStage);
  }, [requestedStage]);

  useEffect(() => {
    const startCapture = () => {
      setStage('action');
      setCreatingNew(true);
      setCreatedWork(undefined);
      setVideoComposerWorkId(undefined);
      setCreationOperation('copy.generate');
      setDraftIntent('');
      setSelectedGuidanceId(undefined);
      setSelectedScene(undefined);
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
    };
    window.addEventListener('meiye:new-content', startCapture);
    return () => window.removeEventListener('meiye:new-content', startCapture);
  }, []);

  useEffect(() => {
    if (!uploadSession?.assetId || !product.state) return;
    if (
      uploadSession.phase !== 'persisted' &&
      product.state.assets.some(
        (asset) => asset.id === uploadSession.assetId
      ) &&
      uploadSession.objectKey
    ) {
      const persisted = markMobileUploadPersisted(
        uploadSession,
        uploadSession.objectKey
      );
      setUploadSession(persisted);
      writeMobileUploadSession(persisted);
    }
  }, [product.state, uploadSession]);

  useEffect(() => {
    const permissions = navigator.permissions;
    if (!permissions) return;
    void permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        setCameraDenied(status.state === 'denied');
        if (status.state === 'denied') {
          emitTelemetry('permission_denied', {
            capability: 'camera',
            surface: 'mobile_capture',
          });
        }
        status.addEventListener('change', () => {
          const denied = status.state === 'denied';
          setCameraDenied(denied);
          if (denied) {
            emitTelemetry('permission_denied', {
              capability: 'camera',
              surface: 'mobile_capture',
            });
          }
        });
      })
      .catch(() => undefined);
  }, []);

  const refreshCreative = async () => {
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
  const createWork = useMutation({
    mutationFn: (plan: ReturnType<typeof mobileCreationPlan>) =>
      operationsCommand<CreativeWorkbenchProjection['works'][number]>(
        'create_creative_work',
        plan.work,
        `mobile-create-work-${crypto.randomUUID()}`
      ),
    onSuccess: async (work, plan) => {
      setCreatedWork(work);
      setCreatingNew(false);
      setVideoComposerWorkId(plan.startsVideoWorkflow ? work.id : undefined);
      await onWorkIdChange?.(work.id);
      await refreshCreative();
      window.sessionStorage.removeItem(CREATION_DRAFT_INTENT_STORAGE_KEY);
      toast.success(workbench_work_created());
    },
    onError: () => toast.error(workbench_work_create_failed()),
  });
  const jobCommand = useMutation({
    mutationFn: (
      request:
        | { action: 'resume_creative_job'; jobId: string }
        | {
            action: 'retry_creative_job';
            jobId: string;
            retryKeys: ReturnType<typeof mobileRetryIdempotencyKeys>;
          }
    ) =>
      operationsCommand(
        request.action,
        request.action === 'retry_creative_job'
          ? {
              jobId: request.jobId,
              submissionKey: request.retryKeys.submissionKey,
            }
          : { jobId: request.jobId },
        request.action === 'retry_creative_job'
          ? request.retryKeys.idempotencyKey
          : `mobile-${request.action}-${request.jobId}-${crypto.randomUUID()}`
      ),
    onSuccess: (_result, request) => {
      emitTelemetry('recovery_action', {
        action: request.action,
        objectKind: 'creative_job',
        outcome: 'succeeded',
      });
      void refreshCreative();
    },
    onError: (_cause, request) => {
      emitTelemetry('recovery_action', {
        action: request.action,
        objectKind: 'creative_job',
        outcome: 'failed',
      });
      toast.error(mobile_action_job_action_failed());
    },
  });
  const harnessAdoption = useMutation({
    mutationFn: (request: ReturnType<typeof mobileHarnessAdoptionRequest>) =>
      operationsCommand(request.action, request.payload, request.key),
    onSuccess: () => refreshCreative(),
    onError: () => toast.error(mobile_action_job_action_failed()),
  });
  const packageEdit = useMutation({
    mutationFn: async () => {
      if (!currentPackage || !currentPackageVersionValue) return;
      const changes = {
        body: packageBody,
        ...(currentPackageVersionValue.conversionHook
          ? { conversionHook: currentPackageVersionValue.conversionHook }
          : {}),
        orderedAssetIds: currentPackageVersionValue.orderedAssetIds,
        title: packageTitle,
        topics: currentPackageVersionValue.topics,
      };
      return operationsCommand(
        'edit_content_package_version',
        {
          baseVersionId: currentPackageVersionValue.id,
          changes,
          expectedRevision: currentPackage.revision,
          packageId: currentPackage.id,
        },
        mobileEditIdempotencyKey(
          JSON.stringify({
            baseVersionId: currentPackageVersionValue.id,
            changes,
            packageId: currentPackage.id,
          })
        )
      );
    },
    onSuccess: () => void refreshCreative(),
    onError: () => toast.error(mobile_action_job_action_failed()),
  });
  const packageCancel = useMutation({
    mutationFn: async () => {
      if (!currentPackage) return;
      return operationsCommand(
        'cancel_content_package',
        {
          expectedRevision: currentPackage.revision,
          packageId: currentPackage.id,
        },
        `mobile-cancel-content-package-${mobileIdempotencyHash(
          JSON.stringify([currentPackage.id, currentPackage.updatedAt])
        )}`
      );
    },
    onSuccess: () => void refreshCreative(),
    onError: () => toast.error(mobile_action_job_action_failed()),
  });
  const douyinVariant = currentPackage?.variants.find(
    (variant) => variant.platform === 'douyin'
  );
  const createL3Package = useMutation({
    mutationFn: async () => {
      if (!currentPackage || !douyinVariant) return;
      return operationsCommand<ContentPackage>(
        'export_content_package',
        {
          expectedRevision: currentPackage.revision,
          packageId: currentPackage.id,
          platform: 'douyin',
        },
        mobileEditIdempotencyKey(
          JSON.stringify({
            packageId: currentPackage.id,
            packageUpdatedAt: currentPackage.updatedAt,
            platform: 'douyin',
            variantVersionId: douyinVariant.currentVersionId,
          })
        )
      );
    },
    onSuccess: () => {
      void refreshCreative();
      toast.success(mobile_action_l3_created());
    },
    onError: () => toast.error(mobile_action_publish_failed()),
  });

  const updateUploadSession = (session: MobileUploadSession) => {
    setUploadSession(session);
    writeMobileUploadSession(session);
  };

  const selectUpload = (file: File) => {
    setPendingUpload({
      answers: {
        category: 'other',
        consentScope: 'internal_only',
        containsPerson: undefined,
        containsSensitiveData: undefined,
        minorStatus: undefined,
        rightsEvidence: '',
        rightsNoFixedExpiry: false,
        rightsPlatforms: [],
        rightsValidUntil: '',
      },
      confirmed: false,
      file,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const upload = async (file: File, facts: ConfirmedAssetFacts) => {
    if (!product.state) return;
    if (boundWorkId && !currentWork) {
      toast.error(workbench_source_insert_failed());
      return;
    }
    let session: MobileUploadSession;
    let assetPersisted = false;
    try {
      const identity = await identifyMobileUploadFile(file);
      session = uploadSession
        ? resumeMobileUploadSession(uploadSession, identity)
        : { ...createMobileUploadSession(identity), phase: 'uploading' };
    } catch {
      toast.error(mobile_action_upload_same_file());
      return;
    }
    updateUploadSession(session);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('uploadId', session.uploadId);
      body.append('contentHash', session.file.sha256);
      const receipt = await uploadProductAsset({ data: body });
      session = markMobileUploadStored(session, receipt.key);
      updateUploadSession(session);
      await product.execute(
        {
          type: 'add_asset',
          asset: {
            id: session.assetId,
            objectKey: receipt.key,
            mediaType: file.type.startsWith('video/') ? 'video' : 'image',
            sourceType: 'real',
            category: facts.category,
            tags: [],
            rightsOwner: product.state.store?.name ?? product.state.workspaceId,
            consentScope: 'internal_only',
            containsPerson: facts.containsPerson,
            containsSensitiveData: facts.containsSensitiveData,
            minorStatus: facts.minorStatus,
          },
        },
        `mobile-asset-${session.uploadId}`
      );
      assetPersisted = true;
      if (
        boundWorkId &&
        currentWork &&
        !currentWork.sourceReferences.some(
          (reference) =>
            reference.kind === 'asset' && reference.id === session.assetId
        )
      ) {
        const derivedWork = await operationsCommand<
          CreativeWorkbenchProjection['works'][number]
        >(
          'derive_creative_work',
          {
            contentModules: currentWork.contentModules,
            intent: currentWork.intent,
            sessionId: currentWork.sessionId,
            sourceReferences: [{ id: session.assetId, kind: 'asset' }],
            sourceWorkId: currentWork.id,
          },
          `mobile-insert-reference-${currentWork.id}-${session.assetId}`
        );
        await onWorkIdChange?.(derivedWork.id);
        await refreshCreative();
      }
      updateUploadSession(markMobileUploadPersisted(session, receipt.key));
      toast.success(mobile_action_upload_success());
    } catch {
      updateUploadSession({ ...session, phase: 'interrupted' });
      toast.error(
        assetPersisted
          ? workbench_source_insert_failed()
          : mobile_action_upload_failed()
      );
    }
  };

  const loading =
    product.loading ||
    inboxQuery.isPending ||
    creativeQuery.isPending ||
    contentPackagesQuery.isPending ||
    (integrationsEnabled && integrations.loading);
  if (loading || !product.state) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const l3DownloadReceipt = currentPackage
    ? [...currentPackage.exportReceipts]
        .reverse()
        .find(
          (receipt) =>
            receipt.platform === 'douyin' &&
            receipt.status === 'succeeded' &&
            Boolean(receipt.artifactObjectKey)
        )
    : undefined;
  const actionPrimary =
    pendingUpload && !pendingUpload.confirmed
      ? 'confirm-upload'
      : !pendingUpload && nextTask
        ? 'open-task'
        : !pendingUpload && !currentWork && !currentContent?.selected
          ? 'capture'
          : undefined;

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_workbench(), isCurrentPage: true },
        ]}
      />
      <main className="mx-auto w-full max-w-xl space-y-4 p-4 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {entry ? (
          <Alert>
            {entry === 'feishu' ? <IconCloudUpload /> : <IconBell />}
            <AlertTitle>
              {entry === 'feishu'
                ? mobile_action_returned_from_feishu()
                : mobile_action_returned_from_notification()}
            </AlertTitle>
            <AlertDescription>
              {mobile_action_return_description()}
            </AlertDescription>
          </Alert>
        ) : null}
        {(product.error ||
          inboxQuery.error ||
          creativeQuery.error ||
          contentPackagesQuery.error ||
          integrations.error) && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{mobile_action_sync_error_title()}</AlertTitle>
            <AlertDescription>
              {mobile_action_sync_error_description()}
            </AlertDescription>
          </Alert>
        )}
        {celebratedPublishId ? (
          <Card className="bg-primary/5 p-4" key={celebratedPublishId}>
            <PublishCelebration
              label={
                celebratedPublishId.startsWith('l1:')
                  ? mobile_action_publish_confirmed_platform()
                  : mobile_action_publish_confirmed_manual()
              }
            />
          </Card>
        ) : null}

        <MobileTaskHeader
          description={
            hasPendingCopyDecision
              ? mobile_action_one_action_at_a_time()
              : (nextTask?.nextStep ?? mobile_action_one_action_at_a_time())
          }
          nextAction={
            hasPendingCopyDecision
              ? mobile_action_accept_content()
              : (nextTask?.title ??
                (currentJob?.status === 'recoverable'
                  ? mobile_action_resume_generation()
                  : hasAcceptedCopyDecision || currentContent?.selected
                    ? mobile_action_prepare_publish()
                    : mobile_action_capture_material()))
          }
        />

        {currentWork ? (
          <section
            aria-label={workbench_section_intent()}
            className="rounded-lg bg-surface-1 p-4"
            data-testid="mobile-work-context"
            data-work-id={currentWork.id}
          >
            <p className="meiye-type-aux">{workbench_record_intent()}</p>
            <p className="mt-2 text-sm leading-6">{currentWork.intent}</p>
            <div className="mt-4 border-t border-divider pt-3">
              <p className="meiye-type-aux">{workbench_record_references()}</p>
              {currentSourceReferences.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {currentSourceReferences.map((source) => (
                    <li
                      data-source-reference={`${source.kind}:${source.id}`}
                      key={`${source.kind}:${source.id}`}
                    >
                      <Badge variant="secondary">{source.label}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {workbench_no_references()}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <Tabs
          value={stage}
          onValueChange={(value) => setStage(value as MobileStage)}
        >
          <TabsList
            aria-label={mobile_action_stages_aria()}
            className="grid h-12 w-full grid-cols-3"
            variant="line"
          >
            {(Object.keys(STAGE_LABELS) as MobileStage[]).map((value) => (
              <TabsTrigger
                className="min-h-touch-target"
                key={value}
                value={value}
              >
                {STAGE_LABELS[value]()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {stage === 'action' ? (
          <div className="space-y-4">
            {currentHarnessPackage ? (
              <MobileHarnessCandidateResults
                busy={harnessAdoption.isPending}
                contentPackage={currentHarnessPackage}
                onAdopt={(candidateId) =>
                  harnessAdoption.mutate(
                    mobileHarnessAdoptionRequest(
                      currentHarnessPackage,
                      candidateId
                    )
                  )
                }
              />
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCamera className="size-5" />
                  {mobile_action_capture_title()}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cameraDenied ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      {mobile_action_camera_denied_title()}
                    </AlertTitle>
                    <AlertDescription>
                      {mobile_action_camera_denied_description()}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label
                    className={buttonVariants({
                      className: 'min-h-touch-target',
                      variant:
                        actionPrimary === 'capture' ? 'default' : 'outline',
                    })}
                    htmlFor="mobile-camera-input"
                  >
                    <IconCamera />
                    {mobile_action_capture_camera()}
                  </label>
                  <input
                    accept="image/*,video/*"
                    capture="environment"
                    className="sr-only"
                    id="mobile-camera-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) selectUpload(file);
                      event.target.value = '';
                    }}
                    type="file"
                  />
                  <label
                    className={buttonVariants({
                      className: 'min-h-touch-target',
                      variant: 'outline',
                    })}
                    htmlFor="mobile-library-input"
                  >
                    <IconPhoto />
                    {mobile_action_capture_library()}
                  </label>
                  <input
                    accept="image/*,video/*"
                    className="sr-only"
                    id="mobile-library-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) selectUpload(file);
                      event.target.value = '';
                    }}
                    type="file"
                  />
                </div>
                {pendingUpload ? (
                  <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                    <div className="flex items-center gap-3">
                      {pendingUpload.file.type.startsWith('video/') ? (
                        <video
                          aria-label={mobile_action_upload_video_preview({
                            name: pendingUpload.file.name,
                          })}
                          className="size-24 rounded-lg object-cover"
                          muted
                          playsInline
                          preload="metadata"
                          src={pendingUpload.previewUrl}
                        />
                      ) : (
                        <img
                          alt={composer_image_preview_alt({
                            name: pendingUpload.file.name,
                          })}
                          className="size-24 rounded-lg object-cover"
                          src={pendingUpload.previewUrl}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium">
                          {pendingUpload.file.name}
                        </p>
                        {pendingUpload.confirmed ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <IconCheck aria-hidden="true" className="size-4" />
                            {composer_image_facts_confirmed()}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {composer_image_confirm_facts()}
                          </p>
                        )}
                      </div>
                    </div>
                    {!pendingUpload.confirmed ? (
                      <div className="space-y-3">
                        <div className="grid gap-px overflow-hidden rounded-lg bg-divider">
                          <MobileFactChoice
                            label={composer_image_contains_person()}
                            onChange={(value) =>
                              setPendingUpload((current) =>
                                current
                                  ? {
                                      ...current,
                                      answers: {
                                        ...current.answers,
                                        containsPerson: value,
                                      },
                                    }
                                  : current
                              )
                            }
                            value={pendingUpload.answers.containsPerson}
                          />
                          <MobileFactChoice
                            label={composer_image_contains_sensitive_data()}
                            onChange={(value) =>
                              setPendingUpload((current) =>
                                current
                                  ? {
                                      ...current,
                                      answers: {
                                        ...current.answers,
                                        containsSensitiveData: value,
                                      },
                                    }
                                  : current
                              )
                            }
                            value={pendingUpload.answers.containsSensitiveData}
                          />
                          <MobileFactChoice
                            label={composer_image_contains_minor()}
                            onChange={(value) =>
                              setPendingUpload((current) =>
                                current
                                  ? {
                                      ...current,
                                      answers: {
                                        ...current.answers,
                                        minorStatus: value ? 'minor' : 'none',
                                      },
                                    }
                                  : current
                              )
                            }
                            value={
                              pendingUpload.answers.minorStatus === undefined
                                ? undefined
                                : pendingUpload.answers.minorStatus === 'minor'
                            }
                          />
                        </div>
                        <Button
                          className="w-full"
                          disabled={!confirmedAssetFacts(pendingUpload.answers)}
                          onClick={() => {
                            const facts = confirmedAssetFacts(
                              pendingUpload.answers
                            );
                            if (!facts) return;
                            setPendingUpload((current) =>
                              current
                                ? { ...current, confirmed: true }
                                : current
                            );
                            void upload(pendingUpload.file, facts);
                          }}
                          type="button"
                          variant={
                            actionPrimary === 'confirm-upload'
                              ? 'default'
                              : 'outline'
                          }
                        >
                          <IconUpload />
                          {composer_image_confirm_upload()}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {uploadSession ? (
                  <div
                    aria-live="polite"
                    className="rounded-lg bg-surface-2 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="line-clamp-2 font-medium">
                        {uploadSession.file.name}
                      </span>
                      <Badge
                        variant={
                          uploadSession.phase === 'persisted'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {UPLOAD_PHASE_LABELS[uploadSession.phase]()}
                      </Badge>
                    </div>
                    {uploadSession.phase === 'interrupted' ? (
                      <p className="mt-2 text-muted-foreground">
                        {mobile_action_upload_resume_description()}
                      </p>
                    ) : null}
                    {persistedUploadAsset ? (
                      <p className="mt-2 text-xs">
                        {mobile_action_upload_saved()}
                      </p>
                    ) : (
                      <p className="mt-2 text-muted-foreground">
                        {mobile_action_upload_not_saved()}
                      </p>
                    )}
                  </div>
                ) : null}
                {persistedUploadAsset ? (
                  <a
                    className="inline-flex min-h-touch-target items-center gap-2 text-sm font-medium text-primary"
                    href={getPathWithLocale(
                      `/dashboard/assets/${encodeURIComponent(persistedUploadAsset.id)}`
                    )}
                  >
                    {mobile_action_confirm_asset()}
                    <IconArrowRight className="size-4" />
                  </a>
                ) : null}
              </CardContent>
            </Card>

            {!currentWork ? (
              <Card>
                <CardContent className="space-y-4">
                  <div className="min-w-0 space-y-2">
                    <h3 className="text-sm font-medium">
                      {creation_entry_guidance_title()}
                    </h3>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {suggestions.map((suggestion) => (
                        <Button
                          aria-pressed={selectedGuidanceId === suggestion.id}
                          className="min-h-touch-target shrink-0"
                          key={suggestion.id}
                          onClick={() =>
                            updateDraftIntent(suggestion.intent, {
                              guidanceId: suggestion.id,
                            })
                          }
                          size="sm"
                          type="button"
                          variant={
                            selectedGuidanceId === suggestion.id
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {suggestion.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <MobileCreationControls
                    intent={draftIntent}
                    intentRef={draftIntentRef}
                    onIntentChange={updateDraftIntent}
                    onOperationChange={setCreationOperation}
                    onSubmit={() =>
                      createWork.mutate(
                        mobileCreationPlan({
                          intent: draftIntent,
                          operation: creationOperation,
                          referenceAssetIds: persistedUploadAsset
                            ? [persistedUploadAsset.id]
                            : [],
                          sessionId: mobileCreationSessionId(),
                        })
                      )
                    }
                    operation={creationOperation}
                    pending={createWork.isPending}
                  />
                </CardContent>
              </Card>
            ) : null}

            {currentWork && videoComposerWorkId === currentWork.id ? (
              <div className="space-y-3">
                <MobileVideoComplianceNotice state={videoComplianceState} />
                {videoComplianceState.kind !== 'pending' ? (
                  <VideoWorkflowLauncher
                    compliance={videoComplianceState.compliance}
                    dataClass={[
                      ...(product.state.assets.some(
                        (asset) =>
                          currentWork.sourceReferences.some(
                            (reference) =>
                              reference.kind === 'asset' &&
                              reference.id === asset.id
                          ) && asset.containsPerson
                      )
                        ? (['contains_face'] as const)
                        : []),
                      ...(product.state.assets.some(
                        (asset) =>
                          currentWork.sourceReferences.some(
                            (reference) =>
                              reference.kind === 'asset' &&
                              reference.id === asset.id
                          ) && asset.containsSensitiveData
                      )
                        ? (['pii'] as const)
                        : []),
                    ]}
                    intent={currentWork.intent}
                    referenceAssetIds={currentWork.sourceReferences.flatMap(
                      (reference) =>
                        reference.kind === 'asset' ? [reference.id] : []
                    )}
                    workId={currentWork.id}
                  />
                ) : null}
              </div>
            ) : null}

            {nextTask ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {mobile_action_task_title({ title: nextTask.title })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    {nextTask.blockedReason ??
                      nextTask.nextStep ??
                      mobile_action_task_open_description()}
                  </p>
                  <a
                    className={buttonVariants({
                      className: 'min-h-touch-target',
                      variant:
                        actionPrimary === 'open-task' ? 'default' : 'outline',
                    })}
                    href={getPathWithLocale(
                      `/dashboard/tasks/${encodeURIComponent(nextTask.id)}`
                    )}
                  >
                    {mobile_action_open_task()}
                    <IconArrowRight />
                  </a>
                </CardContent>
              </Card>
            ) : null}

            <MobileLegacyContentHistory
              creativeContents={creative.contents}
              productContents={product.state.contents}
            />

            <MobileExampleStore
              assetCount={product.state.assets.length + creative.assets.length}
              contentPackages={contentPackages}
              example={product.state.exampleStore}
              hideError={product.error}
              hiding={false}
              legacyContents={legacyContents}
              onHide={() => setExampleOpened(false)}
              onOpen={() => setExampleOpened(true)}
              onRemix={(nextIntent) => {
                writeCreationDraftIntent(window.sessionStorage, nextIntent);
                toast.success(mobile_action_example_remix_saved());
              }}
              opened={exampleOpened}
              queriesReady={
                inboxQuery.isSuccess &&
                creativeQuery.isSuccess &&
                contentPackagesQuery.isSuccess
              }
              taskCount={inboxQuery.data?.tasks.length ?? 0}
              workCount={creative.works.length}
            />
          </div>
        ) : null}

        {stage === 'progress' ? (
          <div className="flex flex-col gap-4">
            {currentHarnessPackage ? (
              <MobileHarnessCandidateResults
                busy={harnessAdoption.isPending}
                contentPackage={currentHarnessPackage}
                onAdopt={(candidateId) =>
                  harnessAdoption.mutate(
                    mobileHarnessAdoptionRequest(
                      currentHarnessPackage,
                      candidateId
                    )
                  )
                }
              />
            ) : null}
            {currentJob ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">
                      {mobile_action_generation_task()}
                    </CardTitle>
                    <ProductStatus
                      announce
                      showExplanation
                      status={currentJobObserver.status ?? currentJob.status}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    {mobile_action_job_output({
                      output: jobOutputLabel(
                        currentJob.contract.operation,
                        currentJob.contract.outputCount
                      ),
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {currentJob.status === 'recoverable' ? (
                      <Button
                        className="min-h-touch-target"
                        disabled={jobCommand.isPending}
                        onClick={() =>
                          jobCommand.mutate({
                            action: 'resume_creative_job',
                            jobId: currentJob.id,
                          })
                        }
                      >
                        <IconPlayerPlay />
                        {mobile_action_resume_job()}
                      </Button>
                    ) : null}
                    {(currentJob.status === 'running' ||
                      currentJob.status === 'unknown') &&
                    !currentJobObserver.enabled ? (
                      <Button
                        className="min-h-touch-target"
                        disabled={jobCommand.isPending}
                        onClick={() =>
                          jobCommand.mutate({
                            action: 'resume_creative_job',
                            jobId: currentJob.id,
                          })
                        }
                        variant="outline"
                      >
                        <IconRefresh />
                        {currentJob.status === 'unknown'
                          ? mobile_action_verify_only()
                          : mobile_action_verify_job()}
                      </Button>
                    ) : null}
                    {currentJobObserver.error ? (
                      <Button
                        className="min-h-touch-target"
                        onClick={() => {
                          void currentJobObserver.refetch();
                          void currentJobObserver.retryRecovery();
                        }}
                        variant="outline"
                      >
                        <IconRefresh />
                        {mobile_action_retry_updates()}
                      </Button>
                    ) : null}
                    {currentJob.status === 'failed' ? (
                      <div className="space-y-2">
                        <p className="text-muted-foreground">
                          {mobile_action_technical_failure_usage()}
                        </p>
                        <Button
                          className="min-h-touch-target"
                          disabled={jobCommand.isPending}
                          onClick={() =>
                            jobCommand.mutate({
                              action: 'retry_creative_job',
                              jobId: currentJob.id,
                              retryKeys: mobileRetryIdempotencyKeys(currentJob),
                            })
                          }
                        >
                          {mobile_action_regenerate()}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {currentJobObserver.error ? (
                    <p className="text-destructive">
                      {mobile_action_update_failed()}
                    </p>
                  ) : null}
                  <a
                    className="inline-flex min-h-touch-target items-center text-primary"
                    href={getPathWithLocale(
                      `/dashboard/jobs/${encodeURIComponent(currentJob.id)}`
                    )}
                  >
                    {mobile_action_open_job()}
                  </a>
                </CardContent>
              </Card>
            ) : !currentWork ? (
              <Alert>
                <AlertTitle>{mobile_action_no_job_title()}</AlertTitle>
                <AlertDescription>
                  {mobile_action_no_job_description()}
                </AlertDescription>
              </Alert>
            ) : null}

            {hasCompleteCopyCandidates && currentJob ? (
              <div className="order-first">
                <CopyCandidateSelector
                  assets={creative.assets.filter(
                    (asset) => asset.workId === currentJob.workId
                  )}
                  compact
                  contents={currentJobContents}
                  job={currentJob}
                  onChanged={refreshCreative}
                  packages={contentPackages}
                  productVisualAssets={(currentWork?.sourceReferences ?? [])
                    .flatMap((source) =>
                      source.kind === 'asset'
                        ? (product.state?.assets ?? []).filter(
                            (asset) =>
                              asset.id === source.id &&
                              asset.mediaType === 'image'
                          )
                        : []
                    )
                    .map((asset) => ({
                      id: asset.id,
                      title: asset.tags.at(-1) ?? workbench_uploaded_image(),
                    }))}
                />
              </div>
            ) : null}

            {currentWork ? (
              <VideoWorkflowPanel
                key={currentWork.id}
                mode="progress"
                workId={currentWork.id}
              />
            ) : null}

            {currentL1Job ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">
                      {mobile_action_l1_status_title()}
                    </CardTitle>
                    <Badge
                      variant={
                        currentL1Job.status === 'published'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {l1StatusLabel(currentL1Job.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {mobile_action_l1_acceptance({
                    status: l1AcceptanceLabel(currentL1Job.acceptance),
                  })}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {stage === 'handoff' ? (
          <div className="space-y-4">
            {currentPackage && !currentPackageVersionValue ? (
              <MobilePackageStatusCard
                contentPackage={currentPackage}
                onCancel={() => packageCancel.mutate()}
                pending={packageCancel.isPending}
              />
            ) : null}

            {currentPackage && currentPackageVersionValue ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span>
                      {mobile_action_accepted_content({
                        title: currentPackageVersionValue.title,
                      })}
                    </span>
                    <Badge variant="outline">
                      {contentPackageStatusLabel(currentPackage.status)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {contentPackageActions(currentPackage.status).includes(
                    'edit_text'
                  ) ? (
                    <div className="space-y-3">
                      <Input
                        aria-label={mobile_action_content_title()}
                        onChange={(event) =>
                          setPackageTitle(event.target.value)
                        }
                        value={packageTitle}
                      />
                      <Textarea
                        aria-label={mobile_action_content_body()}
                        onChange={(event) => setPackageBody(event.target.value)}
                        value={packageBody}
                      />
                      <Button
                        className="min-h-touch-target"
                        disabled={packageEdit.isPending}
                        onClick={() => packageEdit.mutate()}
                      >
                        {mobile_action_save_text_edit()}
                      </Button>
                    </div>
                  ) : (
                    <p className="line-clamp-4 text-sm text-muted-foreground">
                      {currentPackageVersionValue.body}
                    </p>
                  )}
                  <MobilePackageComposition
                    contentPackage={currentPackage}
                    creativeAssets={creative.assets}
                    productAssets={product.state.assets}
                  />
                  <MobilePackageSharedActions
                    contentPackage={currentPackage}
                    onCancel={() => packageCancel.mutate()}
                    pending={packageCancel.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mobile_action_precise_layout_desktop()}
                  </p>
                </CardContent>
              </Card>
            ) : !currentPackage ? (
              <Alert>
                <AlertTitle>
                  {mobile_action_no_accepted_content_title()}
                </AlertTitle>
                <AlertDescription>
                  {mobile_action_no_accepted_content_description()}
                </AlertDescription>
              </Alert>
            ) : null}

            {integrations.douyinIntegrationStatus ? (
              <MobilePublishRoutes
                canCreateL3={
                  Boolean(douyinVariant) &&
                  Boolean(
                    currentPackage &&
                      contentPackageActions(currentPackage.status).some(
                        (action) =>
                          action === 'export' || action === 'retry_export'
                      )
                  )
                }
                creatingL3={createL3Package.isPending}
                downloadHref={
                  l3DownloadReceipt?.artifactObjectKey
                    ? `/api/core/p1/assets?objectKey=${encodeURIComponent(
                        l3DownloadReceipt.artifactObjectKey
                      )}`
                    : undefined
                }
                douyinIntegrated={
                  integrations.douyinIntegrationStatus.integrated
                }
                onCreateL3={() => createL3Package.mutate()}
              />
            ) : null}

            {currentHandoff ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">
                      {mobile_action_l3_handoff_title()}
                    </CardTitle>
                    <Badge
                      variant={
                        currentHandoff.status === 'published'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {currentHandoff.status === 'published'
                        ? mobile_action_handoff_published()
                        : mobile_action_handoff_pending()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    {mobile_action_handoff_description()}
                  </p>
                  <a
                    className={buttonVariants({
                      className: 'min-h-touch-target',
                      variant: 'outline',
                    })}
                    href={getPathWithLocale(
                      `/dashboard/handoff/${encodeURIComponent(currentHandoff.token)}`
                    )}
                  >
                    {mobile_action_open_handoff()}
                    <IconArrowRight />
                  </a>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconDeviceDesktop className="size-5" />
                  {mobile_action_desktop_relay_title()}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>{mobile_action_desktop_relay_description()}</p>
                <a
                  className={buttonVariants({
                    className: 'min-h-touch-target',
                    variant: 'outline',
                  })}
                  href={getPathWithLocale(
                    currentPackage
                      ? buildRelayLocation({
                          kind: 'package',
                          packageId: currentPackage.id,
                          stage: 'handoff',
                        }).pathWithSearch
                      : currentWork?.id
                        ? buildRelayLocation({
                            kind: 'work',
                            workId: currentWork.id,
                          }).pathWithSearch
                        : '/dashboard'
                  )}
                >
                  {mobile_action_desktop_continue()}
                </a>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </>
  );
}
