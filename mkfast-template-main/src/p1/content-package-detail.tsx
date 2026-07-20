import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  content_package_asset_rights_withdrawn,
  content_package_base_version,
  content_package_compare_current,
  content_package_current_version,
  content_package_detail_title,
  content_package_download_export,
  content_package_delivery_assisted,
  content_package_delivery_assisted_hint,
  content_package_delivery_automatic,
  content_package_delivery_approval_account,
  content_package_delivery_approval_confirm,
  content_package_delivery_approval_cost,
  content_package_delivery_approval_hint,
  content_package_delivery_approval_schedule,
  content_package_delivery_approval_title,
  content_package_delivery_event_assisted,
  content_package_delivery_event_automatic,
  content_package_delivery_event_legacy,
  content_package_delivery_event_manual,
  content_package_delivery_history,
  content_package_delivery_record_published,
  content_package_delivery_status_failed,
  content_package_delivery_status_published,
  content_package_delivery_status_unknown,
  content_package_delivery_unavailable,
  content_package_delivery_url,
  content_package_edit_body,
  content_package_edit_hook,
  content_package_edit_title,
  content_package_edit_topics,
  content_package_quick_edit_action_appointment_card,
  content_package_quick_edit_action_identity_brand,
  content_package_quick_edit_action_identity_person,
  content_package_quick_edit_action_image_set,
  content_package_quick_edit_action_moments_export,
  content_package_quick_edit_action_natural_language,
  content_package_quick_edit_action_offline_export,
  content_package_quick_edit_action_platform_variant,
  content_package_quick_edit_action_poster,
  content_package_quick_edit_action_promotion_stronger,
  content_package_quick_edit_action_promotion_weaker,
  content_package_quick_edit_action_replace_assets,
  content_package_quick_edit_action_spoken_script,
  content_package_quick_edit_description,
  content_package_quick_edit_export_group,
  content_package_quick_edit_instruction,
  content_package_quick_edit_placeholder,
  content_package_quick_edit_scope,
  content_package_quick_edit_title,
  content_package_export_failed,
  content_package_export_compliance_summary,
  content_package_export_failure_unknown,
  content_package_export_platform,
  content_package_export_receipts_empty,
  content_package_export_service_unavailable,
  content_package_export_succeeded,
  content_package_field_changed,
  content_package_generate_variants_usage,
  content_package_generate_video,
  content_package_history_version,
  content_package_ledger_committed,
  content_package_ledger_content_generation,
  content_package_ledger_copy_generation,
  content_package_ledger_image_generation,
  content_package_ledger_product_usage,
  content_package_ledger_refunded,
  content_package_ledger_reserved,
  content_package_ledger_title,
  content_package_ledger_video_generation,
  content_package_lineage_children,
  content_package_lineage_children_empty,
  content_package_lineage_source,
  content_package_lineage_source_empty,
  content_package_lineage_title,
  content_package_lineage_truncated,
  content_package_platform_video_account,
  content_package_recreate_with_assets,
  content_package_replacement_required,
  content_package_retry_delivery,
  content_package_retry_export,
  content_package_rights_revoked,
  content_package_rollback_new_version,
  content_package_save_new_version,
  content_package_source_ai,
  content_package_source_merchant,
  content_package_source_rollback,
  content_package_untitled,
  content_package_variants_loading,
  content_package_variants_retry,
  content_package_variants_unavailable,
  content_package_version_history,
  content_package_visual_order,
  content_package_visual_position,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
  dashboard_content_remix,
  dashboard_handoff_aigc_label_off,
  dashboard_handoff_aigc_label_on,
  p1_canvas_aigc_label,
  p1_canvas_export_aigc_text,
  workbench_switch_off,
  workbench_switch_on,
  workbench_watermark,
} from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import type { CanonicalMediaProjection } from '@/product/canonical-history-model';
import { DeviceRelayPopover } from '@/product/device-relay-popover';
import type { RelayTarget } from '@/product/device-relay';
import { HotTopicOpportunityCardView } from '@/product/hot-topic-opportunity-card';
import { MarketingEvidenceChips } from '@/product/marketing-evidence-chips';
import { TrustedReturnAnchor } from '@/product/trusted-return';
import { VideoWorkflowPanel } from '@/product/video-workflow-panel';
import { VideoWorkflowLauncher } from '@/product/video-workflow-launcher';
import type { VideoDataClass } from '@/product/video-workflow-model';
import type {
  ContentPackageDeliveryCapability,
  ContentPackageDeliveryEvent,
  ContentPackagePlatform,
  ContentPackageVersion,
  QuickEditAction,
  QuickEditIntent,
} from '@meiye/contracts';
import {
  IconArrowBackUp,
  IconDownload,
  IconGitBranch,
  IconHistory,
  IconRepeat,
  IconSparkles,
  IconVideo,
} from '@tabler/icons-react';
import { type FormEvent, useState } from 'react';
import type { ContentPackageProjection } from './content-package-card';
import { ContentPackageExportCarrier } from './content-package-export-carrier';
import {
  ContentPackageResults,
  type ContentPackageResultsProjection,
  type ContentPackageWeeklyResultReviewProjection,
} from './content-package-results';
import {
  buildContentPackageQuickEdit,
  CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG,
  CONTENT_PACKAGE_QUICK_EDIT_EXPORT_ACTIONS,
  CONTENT_PACKAGE_QUICK_EDIT_REWRITE_ACTIONS,
} from '@/product/content-package-quick-edit';

export interface ContentPackageLineageProjection {
  ancestors: ContentPackageProjection[];
  children: ContentPackageProjection[];
  truncated: boolean;
}

export interface ContentPackageEditInput {
  baseVersionId: string;
  changes: Pick<
    ContentPackageVersion,
    'body' | 'conversionHook' | 'orderedAssetIds' | 'title' | 'topics'
  >;
  intent?: QuickEditIntent;
  platform?: ContentPackagePlatform;
}

const QUICK_EDIT_LABELS: Record<QuickEditAction, () => string> = {
  natural_language: content_package_quick_edit_action_natural_language,
  identity_brand: content_package_quick_edit_action_identity_brand,
  identity_person: content_package_quick_edit_action_identity_person,
  promotion_weaker: content_package_quick_edit_action_promotion_weaker,
  promotion_stronger: content_package_quick_edit_action_promotion_stronger,
  replace_assets: content_package_quick_edit_action_replace_assets,
  platform_variant: content_package_quick_edit_action_platform_variant,
  wechat_moments_export: content_package_quick_edit_action_moments_export,
  offline_material_export: content_package_quick_edit_action_offline_export,
  poster: content_package_quick_edit_action_poster,
  image_set: content_package_quick_edit_action_image_set,
  spoken_script: content_package_quick_edit_action_spoken_script,
  appointment_card: content_package_quick_edit_action_appointment_card,
};

interface ContentPackageDetailProps {
  contentPackage: ContentPackageProjection;
  deliveryCapabilities?: ContentPackageDeliveryCapability[];
  deliveryTimeline?: ContentPackageDeliveryEvent[];
  lineage?: ContentPackageLineageProjection;
  media?: CanonicalMediaProjection[];
  pending?: boolean;
  /** Allowlisted trusted return id only (never a free-form URL). */
  returnFrom?: unknown;
  /** Device relay target for desktop→mobile continue. */
  relayTarget?: RelayTarget;
  onEdit(input: ContentPackageEditInput): void;
  onExport(platform: ContentPackagePlatform): void;
  onGenerateVariants(): void;
  onOpenPackage(packageId: string): void;
  onApproveAndDeliver?(input: {
    accountId: string;
    actionScheduledAt: string;
    cost: { amount: number; currency: 'CNY' };
    platform: ContentPackagePlatform;
    purpose: 'publish_current_variant';
    variantVersionId: string;
  }): void;
  onRecordManualResult?(input: {
    platform: ContentPackagePlatform;
    platformUrl?: string;
    status: 'published';
    variantVersionId: string;
  }): void;
  onRetryDelivery?(input: {
    accountId: string;
    actionScheduledAt: string;
    cost: { amount: number; currency: 'CNY' | 'USD' };
    platform: ContentPackagePlatform;
    purpose: string;
    receiptId: string;
    variantVersionId: string;
  }): void;
  onRetryVariantCatalog?(): void;
  onReuse(): void;
  onRollback(versionId: string): void;
  onRecordResultSignal?(
    kind: import('@meiye/contracts').ContentPackageResultSignal['kind']
  ): void;
  onResultReviewAction?(
    action: 'change_cta' | 'continue_series' | 'stop_series'
  ): void;
  results?: ContentPackageResultsProjection;
  weeklyResultReview?: ContentPackageWeeklyResultReviewProjection;
  variantQuota?: { allowance: number; available: number };
  variantCatalogState?: 'loading' | 'unavailable';
  videoDataClass?: readonly VideoDataClass[];
}

type VersionTarget = 'package' | ContentPackagePlatform;

function platformLabel(platform: ContentPackagePlatform) {
  switch (platform) {
    case 'xiaohongshu':
      return creation_entry_platform_xiaohongshu();
    case 'douyin':
      return creation_entry_platform_douyin();
    case 'video_account':
      return content_package_platform_video_account();
  }
}

function packageTitle(contentPackage: ContentPackageProjection) {
  return (
    contentPackage.versions.find(
      (version) => version.id === contentPackage.currentVersionId
    )?.title || content_package_untitled()
  );
}

function versionSourceLabel(source: ContentPackageVersion['source']) {
  switch (source) {
    case 'ai_generated':
      return content_package_source_ai();
    case 'merchant_edited':
      return content_package_source_merchant();
    case 'rollback_restored':
      return content_package_source_rollback();
    default:
      return undefined;
  }
}

function usageStatusLabel(status: 'committed' | 'refunded' | 'reserved') {
  if (status === 'committed') return content_package_ledger_committed();
  if (status === 'refunded') return content_package_ledger_refunded();
  return content_package_ledger_reserved();
}

export function contentPackageRunCapabilityLabel(
  runType: ContentPackageProjection['generated']['childRuns'][number]['runType']
) {
  if (runType === 'durable_video_workflow') {
    return content_package_ledger_video_generation();
  }
  if (runType === 'canvas_image_job') {
    return content_package_ledger_image_generation();
  }
  if (runType === 'model_job') {
    return content_package_ledger_copy_generation();
  }
  return content_package_ledger_content_generation();
}

export function canStartVideoDerivative(
  kind: ContentPackageProjection['kind'],
  platform: ContentPackagePlatform | undefined,
  workId: string | undefined
) {
  return (
    kind !== 'video' &&
    Boolean(workId) &&
    (platform === 'douyin' || platform === 'video_account')
  );
}

export function videoDerivativeLaunchContext(
  contentPackage: ContentPackageProjection,
  platform: ContentPackagePlatform | undefined
) {
  if (
    !canStartVideoDerivative(
      contentPackage.kind,
      platform,
      contentPackage.source.workId
    )
  ) {
    return null;
  }
  const variant = contentPackage.variants.find(
    (candidate) => candidate.platform === platform
  );
  const version = variant?.versions.find(
    (candidate) => candidate.id === variant.currentVersionId
  );
  if (!version || !contentPackage.source.workId) return null;
  return {
    intent: [version.title, version.body].filter(Boolean).join('\n\n'),
    referenceAssetIds: [...contentPackage.source.assetIds],
    workId: contentPackage.source.workId,
  };
}

function exportFailureLabel(category: string | undefined) {
  return category === 'export_adapter_failed' ||
    category === 'archive_unavailable'
    ? content_package_export_service_unavailable()
    : content_package_export_failure_unknown();
}

function deliveryCapabilityLabel(
  capability: ContentPackageDeliveryCapability['mode']
) {
  if (capability === 'automatic_verified') {
    return content_package_delivery_automatic();
  }
  if (capability === 'assisted') return content_package_delivery_assisted();
  return content_package_delivery_unavailable();
}

function deliveryEventLabel(event: ContentPackageDeliveryEvent) {
  if (event.type === 'automatic_publish_result') {
    return content_package_delivery_event_automatic();
  }
  if (event.type === 'manual_publish_result') {
    return content_package_delivery_event_manual();
  }
  if (event.type === 'legacy_handoff_event') {
    return content_package_delivery_event_legacy();
  }
  return content_package_delivery_event_assisted();
}

function deliveryStatusLabel(status: 'failed' | 'published' | 'unknown') {
  if (status === 'published')
    return content_package_delivery_status_published();
  if (status === 'failed') return content_package_delivery_status_failed();
  return content_package_delivery_status_unknown();
}

type ExportComplianceSummaryMessage = (input: {
  aigc: string;
  watermark: string;
}) => string;

function exportComplianceSummary(
  compliance: ContentPackageProjection['compliance']
) {
  const enabledWatermarkLabel = compliance.watermarkEnabled
    ? dashboard_handoff_aigc_label_on()
    : dashboard_handoff_aigc_label_off();
  const enabledAigcLabel = compliance.aigcLabelEnabled
    ? dashboard_handoff_aigc_label_on()
    : dashboard_handoff_aigc_label_off();
  const watermark = compliance.watermarkEnabled
    ? workbench_switch_on()
    : workbench_switch_off();
  const aigc = compliance.aigcLabelEnabled
    ? workbench_switch_on()
    : workbench_switch_off();
  const localizedMessage: ExportComplianceSummaryMessage | undefined =
    content_package_export_compliance_summary;
  if (localizedMessage) return localizedMessage({ aigc, watermark });
  const brandWatermarkLabel = enabledWatermarkLabel.replace(
    p1_canvas_aigc_label(),
    workbench_watermark()
  );
  const aiGeneratedText = p1_canvas_export_aigc_text();
  const aiGeneratedLabel = `${aiGeneratedText}${
    /\p{Script=Han}/u.test(aiGeneratedText) ? '' : ' '
  }${enabledAigcLabel.replace(/^AIGC\s*/u, '')}`;
  return `${brandWatermarkLabel} · ${aiGeneratedLabel}`;
}

export function ContentPackageDetail({
  contentPackage,
  deliveryCapabilities = [],
  deliveryTimeline,
  lineage,
  media = [],
  pending = false,
  returnFrom,
  relayTarget,
  onEdit,
  onExport,
  onGenerateVariants,
  onOpenPackage,
  onApproveAndDeliver,
  onRecordManualResult,
  onRetryDelivery,
  onRetryVariantCatalog,
  onReuse,
  onRollback,
  onRecordResultSignal,
  onResultReviewAction,
  results,
  weeklyResultReview,
  variantQuota,
  variantCatalogState,
  videoDataClass = [],
}: ContentPackageDetailProps) {
  const [target, setTarget] = useState<VersionTarget>(
    contentPackage.variants[0]?.platform ?? 'package'
  );
  const [comparisonVersionId, setComparisonVersionId] = useState<string>();
  const [quickEditAction, setQuickEditAction] =
    useState<QuickEditAction>('natural_language');
  const [quickEditInstruction, setQuickEditInstruction] = useState('');
  const [videoDerivativePlatform, setVideoDerivativePlatform] =
    useState<ContentPackagePlatform>();
  const variant =
    target === 'package'
      ? undefined
      : contentPackage.variants.find((item) => item.platform === target);
  const versions = variant?.versions ?? contentPackage.versions;
  const currentVersionId =
    variant?.currentVersionId ?? contentPackage.currentVersionId;
  const currentVersion = versions.find(
    (version) => version.id === currentVersionId
  );
  const packageVersion = contentPackage.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
  const exportUseDelivery =
    currentVersion?.exportUseDelivery ?? packageVersion?.exportUseDelivery;
  const comparisonVersion =
    versions.find(
      (version) =>
        version.id === comparisonVersionId && version.id !== currentVersionId
    ) ?? versions.find((version) => version.id !== currentVersionId);
  const timeline = [
    ...contentPackage.exportReceipts
      .filter((receipt) => target === 'package' || receipt.platform === target)
      .map((receipt) => ({
        id: receipt.id,
        kind: 'export' as const,
        occurredAt: receipt.createdAt,
        receipt,
      })),
    ...(deliveryTimeline ?? contentPackage.deliveryEvents ?? [])
      .filter((event) => target === 'package' || event.platform === target)
      .map((event) => ({
        event,
        id: event.id,
        kind: 'delivery' as const,
        occurredAt: event.occurredAt,
      })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const deliveryCapability = variant
    ? deliveryCapabilities.find(
        (capability) => capability.platform === variant.platform
      )
    : undefined;
  const pendingApprovalRequest = variant
    ? (contentPackage.approvalRequests ?? []).find(
        (request) =>
          request.status === 'pending' &&
          request.platform === variant.platform &&
          request.variantVersionId === currentVersion?.id
      )
    : undefined;
  const approvedDeliveryReceipt =
    variant && currentVersion
      ? (contentPackage.approvalReceipts ?? []).find(
          (receipt) =>
            receipt.status === 'approved' &&
            receipt.binding.packageId === contentPackage.id &&
            receipt.binding.platform === variant.platform &&
            receipt.binding.variantVersionId === currentVersion.id
        )
      : undefined;
  const exportBlocked =
    contentPackage.rights.state === 'revoked' ||
    contentPackage.status === 'needs_replacement';
  const exportBlockedLabel = contentPackage.rights.reason?.startsWith(
    'asset_withdrawn'
  )
    ? content_package_asset_rights_withdrawn()
    : contentPackage.rights.state === 'revoked'
      ? content_package_rights_revoked()
      : content_package_replacement_required();
  const { workflowId, workId } = contentPackage.source;
  const videoWorkflow =
    contentPackage.kind === 'video' && workId ? (
      <VideoWorkflowPanel
        key={workflowId ?? workId}
        mode="progress"
        recoveryHref={getPathWithLocale(
          `/dashboard/results/${encodeURIComponent(workId)}`
        )}
        workId={workId}
        {...(workflowId ? { workflowId } : {})}
      />
    ) : null;
  const videoDerivativeContext = videoDerivativeLaunchContext(
    contentPackage,
    videoDerivativePlatform
  );
  const videoDerivativeWorkflow =
    videoDerivativeContext && videoDerivativePlatform ? (
      <VideoWorkflowLauncher
        brandWatermarkText={
          contentPackage.compliance.watermarkEnabled
            ? contentPackage.compliance.watermarkText
            : undefined
        }
        compliance={contentPackage.compliance}
        dataClass={videoDataClass}
        intent={videoDerivativeContext.intent}
        key={`${videoDerivativeContext.workId}:${videoDerivativePlatform}`}
        referenceAssetIds={videoDerivativeContext.referenceAssetIds}
        workId={videoDerivativeContext.workId}
      />
    ) : null;
  const activeVideoWorkflow = videoWorkflow ?? videoDerivativeWorkflow;

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentVersion) return;
    const form = new FormData(event.currentTarget);
    const conversionHook = String(form.get('conversionHook') ?? '').trim();
    const naturalLanguageEdit =
      quickEditInstruction.trim() && packageVersion
        ? buildContentPackageQuickEdit({
            action: 'natural_language',
            baseVersion: packageVersion,
            contentPackage,
            instruction: quickEditInstruction.trim(),
          })
        : undefined;
    onEdit({
      baseVersionId: naturalLanguageEdit
        ? packageVersion!.id
        : currentVersion.id,
      changes: naturalLanguageEdit?.changes ?? {
        body: String(form.get('body') ?? ''),
        ...(conversionHook ? { conversionHook } : {}),
        orderedAssetIds: [...currentVersion.orderedAssetIds],
        title: String(form.get('title') ?? ''),
        topics: String(form.get('topics') ?? '')
          .split(/[,，]/)
          .map((topic) => topic.trim())
          .filter(Boolean),
      },
      ...(naturalLanguageEdit ? { intent: naturalLanguageEdit.intent } : {}),
      ...(!naturalLanguageEdit && variant
        ? { platform: variant.platform }
        : {}),
    });
  }

  function runQuickEditAction(action: QuickEditAction) {
    setQuickEditAction(action);
    if (action === 'natural_language') return;
    const config = CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG[action];
    const actionVersion =
      config.target === 'platform_variant' ? currentVersion : packageVersion;
    if (!actionVersion || (config.target === 'platform_variant' && !variant)) {
      return;
    }
    const edit = buildContentPackageQuickEdit({
      action,
      baseVersion: actionVersion,
      contentPackage,
    });
    onEdit({
      baseVersionId: actionVersion.id,
      changes: edit.changes,
      intent: edit.intent,
      ...(config.target === 'platform_variant' && variant
        ? { platform: variant.platform }
        : {}),
    });
  }

  if (!currentVersion) {
    return activeVideoWorkflow;
  }

  return (
    <Card className="rounded-md border-primary/20 bg-surface-1 shadow-none">
      <CardHeader className="gap-3">
        <TrustedReturnAnchor from={returnFrom} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base leading-snug font-medium">
            {content_package_detail_title()}
          </h2>
          <Badge className="ml-auto" variant="outline">
            {contentPackage.statusLabel}
          </Badge>
          {relayTarget ? <DeviceRelayPopover target={relayTarget} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setTarget('package')}
            size="sm"
            type="button"
            variant={target === 'package' ? 'default' : 'outline'}
          >
            {content_package_base_version()}
          </Button>
          {contentPackage.variants.map((item) => (
            <Button
              key={item.platform}
              onClick={() => setTarget(item.platform)}
              size="sm"
              type="button"
              variant={target === item.platform ? 'default' : 'outline'}
            >
              {platformLabel(item.platform)}
            </Button>
          ))}
          {contentPackage.variants.length === 0 && variantQuota ? (
            <Button
              disabled={pending || variantQuota.available < 1}
              onClick={onGenerateVariants}
              size="sm"
              type="button"
              variant="outline"
            >
              <IconSparkles />
              {content_package_generate_variants_usage({
                allowance: variantQuota.allowance,
                available: variantQuota.available,
              })}
            </Button>
          ) : null}
          {contentPackage.variants.length === 0 &&
          !variantQuota &&
          variantCatalogState === 'loading' ? (
            <Button disabled size="sm" type="button" variant="outline">
              {content_package_variants_loading()}
            </Button>
          ) : null}
          {contentPackage.variants.length === 0 &&
          !variantQuota &&
          variantCatalogState === 'unavailable' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{content_package_variants_unavailable()}</span>
              <Button
                disabled={pending}
                onClick={onRetryVariantCatalog}
                size="sm"
                type="button"
                variant="outline"
              >
                {content_package_variants_retry()}
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        {activeVideoWorkflow ? (
          <div className="xl:col-span-2">{activeVideoWorkflow}</div>
        ) : null}
        <HotTopicOpportunityCardView
          opportunity={contentPackage.marketing?.opportunity}
        />
        <form
          className="space-y-4"
          key={currentVersion.id}
          onSubmit={submitEdit}
        >
                    <section
            className="space-y-3 rounded-md border bg-surface-2 p-3"
            data-testid="content-package-detail-result-handoff"
          >
            <div>
              <h3 className="font-medium">继续调整与交付</h3>
              <p className="text-sm text-muted-foreground">
                生成结果的主动作（调整 / 采用 / 交付）已收敛到结果中心。
              </p>
            </div>
            {contentPackage.source?.workId ? (
              <a
                className="inline-flex min-h-touch-target items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                data-testid="content-package-open-result-center"
                href={`/dashboard/results/${encodeURIComponent(contentPackage.source.workId)}`}
              >
                打开结果中心
              </a>
            ) : null}
          </section>
          <div className="space-y-2">
            <Label htmlFor="content-package-title">
              {content_package_edit_title()}
            </Label>
            <Input
              defaultValue={currentVersion.title}
              id="content-package-title"
              name="title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-package-body">
              {content_package_edit_body()}
            </Label>
            <Textarea
              className="min-h-40"
              defaultValue={currentVersion.body}
              id="content-package-body"
              name="body"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="content-package-hook">
                {content_package_edit_hook()}
              </Label>
              <Input
                defaultValue={currentVersion.conversionHook ?? ''}
                id="content-package-hook"
                name="conversionHook"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content-package-topics">
                {content_package_edit_topics()}
              </Label>
              <Input
                defaultValue={currentVersion.topics.join('，')}
                id="content-package-topics"
                name="topics"
              />
            </div>
          </div>
          <VisualOrder
            contentPackage={contentPackage}
            media={media}
            version={currentVersion}
          />
          {exportUseDelivery ? (
            <ContentPackageExportCarrier delivery={exportUseDelivery} />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} type="submit">
              {content_package_save_new_version()}
            </Button>
            {variant ? (
              <div className="flex flex-col items-start gap-1">
                <Button
                  disabled={pending || exportBlocked}
                  onClick={() => onExport(variant.platform)}
                  type="button"
                  variant="outline"
                >
                  <IconDownload />
                  {content_package_export_platform({
                    platform: platformLabel(variant.platform),
                  })}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {exportComplianceSummary(contentPackage.compliance)}
                </p>
                {deliveryCapability ? (
                  <Badge
                    data-delivery-mode={deliveryCapability.mode}
                    variant={
                      deliveryCapability.mode === 'automatic_verified'
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {deliveryCapabilityLabel(deliveryCapability.mode)}
                  </Badge>
                ) : null}
                {deliveryCapability?.mode === 'assisted' ? (
                  <p className="max-w-md text-xs text-muted-foreground">
                    {content_package_delivery_assisted_hint()}
                  </p>
                ) : null}
              </div>
            ) : null}
            {canStartVideoDerivative(
              contentPackage.kind,
              variant?.platform,
              workId
            ) ? (
              <Button
                data-testid="content-package-video-derivative"
                disabled={pending}
                onClick={() => setVideoDerivativePlatform(variant?.platform)}
                type="button"
                variant="outline"
              >
                <IconVideo />
                {content_package_generate_video()}
              </Button>
            ) : null}
            {exportBlocked ? (
              <p className="basis-full text-sm text-destructive">
                {exportBlockedLabel}
              </p>
            ) : null}
            {contentPackage.status === 'needs_replacement' ? (
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={getPathWithLocale(
                  contentPackage.source.workId
                    ? `/dashboard/results/${encodeURIComponent(contentPackage.source.workId)}`
                    : '/dashboard'
                )}
              >
                {content_package_recreate_with_assets()}
              </a>
            ) : null}
            <Button
              disabled={pending || exportBlocked}
              onClick={() => onReuse()}
              type="button"
              variant="outline"
            >
              <IconRepeat />
              {dashboard_content_remix()}
            </Button>
          </div>
        </form>

        <div className="space-y-6">
          <section
            className="space-y-3"
            aria-labelledby="version-history-title"
          >
            <h3
              className="flex items-center gap-2 font-medium"
              id="version-history-title"
            >
              <IconHistory />
              {content_package_version_history()}
            </h3>
            <div className="space-y-2">
              {[...versions].reverse().map((version, reverseIndex) => {
                const sourceLabel = versionSourceLabel(version.source);
                return (
                  <div
                    className="rounded-md border border-divider p-3"
                    key={version.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        V{versions.length - reverseIndex} · {version.title}
                      </span>
                      {sourceLabel ? (
                        <Badge
                          className={
                            version.source === 'ai_generated'
                              ? 'border-transparent bg-[var(--spark-wash)] text-[var(--spark-deep)]'
                              : undefined
                          }
                          variant="outline"
                        >
                          {sourceLabel}
                        </Badge>
                      ) : null}
                      {version.editIntent ? (
                        <Badge variant="secondary">
                          {QUICK_EDIT_LABELS[version.editIntent.action]()}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {version.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                      {version.id === currentVersionId ? (
                        <Badge variant="secondary">
                          {content_package_current_version()}
                        </Badge>
                      ) : (
                        <>
                          <Button
                            disabled={pending}
                            onClick={() => onRollback(version.id)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <IconArrowBackUp />
                            {content_package_rollback_new_version()}
                          </Button>
                          <Button
                            onClick={() => setComparisonVersionId(version.id)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {content_package_compare_current()}
                          </Button>
                        </>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {version.body}
                    </p>
                    {version.editIntent ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {version.editIntent.instruction} ·{' '}
                        {content_package_quick_edit_scope()}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {comparisonVersion ? (
              <div className="grid gap-2 rounded-md bg-surface-2 p-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {content_package_history_version()}
                  </p>
                  <p className="flex items-center gap-2 font-medium">
                    {comparisonVersion.title}
                    {comparisonVersion.title !== currentVersion.title ? (
                      <Badge variant="outline">
                        {content_package_field_changed()}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {comparisonVersion.body}
                    {comparisonVersion.body !== currentVersion.body ? (
                      <Badge className="ml-2" variant="outline">
                        {content_package_field_changed()}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-2 text-sm">
                    {comparisonVersion.conversionHook ?? '—'}
                    {comparisonVersion.conversionHook !==
                    currentVersion.conversionHook ? (
                      <Badge className="ml-2" variant="outline">
                        {content_package_field_changed()}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-sm">
                    {comparisonVersion.topics.join(' · ') || '—'}
                    {comparisonVersion.topics.join('\0') !==
                    currentVersion.topics.join('\0') ? (
                      <Badge className="ml-2" variant="outline">
                        {content_package_field_changed()}
                      </Badge>
                    ) : null}
                  </p>
                  <VisualOrder
                    contentPackage={contentPackage}
                    media={media}
                    version={comparisonVersion}
                  />
                  <p className="text-sm">
                    {comparisonVersion.orderedAssetIds.join('\0') !==
                    currentVersion.orderedAssetIds.join('\0') ? (
                      <Badge className="ml-2" variant="outline">
                        {content_package_field_changed()}
                      </Badge>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {content_package_current_version()}
                  </p>
                  <p className="font-medium">{currentVersion.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {currentVersion.body}
                  </p>
                  <p className="mt-2 text-sm">
                    {currentVersion.conversionHook ?? '—'}
                  </p>
                  <p className="text-sm">
                    {currentVersion.topics.join(' · ') || '—'}
                  </p>
                  <VisualOrder
                    contentPackage={contentPackage}
                    media={media}
                    version={currentVersion}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section
            className="space-y-3"
            aria-labelledby="export-receipts-title"
          >
            <h3 className="font-medium" id="export-receipts-title">
              {content_package_delivery_history()}
            </h3>
            {variant &&
            deliveryCapability?.mode === 'automatic_verified' &&
            pendingApprovalRequest &&
            onApproveAndDeliver ? (
              <ContentPackageApprovalCard
                disabled={pending}
                onApprove={(input) =>
                  onApproveAndDeliver({
                    ...input,
                    platform: variant.platform,
                    purpose: 'publish_current_variant',
                    variantVersionId: currentVersion.id,
                  })
                }
              />
            ) : null}
            {variant &&
            deliveryCapability?.mode === 'automatic_verified' &&
            approvedDeliveryReceipt &&
            onRetryDelivery ? (
              <Button
                disabled={pending}
                onClick={() =>
                  onRetryDelivery({
                    accountId: approvedDeliveryReceipt.binding.accountId,
                    actionScheduledAt:
                      approvedDeliveryReceipt.binding.actionScheduledAt,
                    cost: approvedDeliveryReceipt.binding.cost,
                    platform: variant.platform,
                    purpose: approvedDeliveryReceipt.binding.purpose,
                    receiptId: approvedDeliveryReceipt.id,
                    variantVersionId: currentVersion.id,
                  })
                }
                type="button"
                variant="outline"
              >
                {content_package_retry_delivery()}
              </Button>
            ) : null}
            {variant &&
            deliveryCapability?.mode === 'assisted' &&
            onRecordManualResult ? (
              <ManualDeliveryResultForm
                disabled={pending}
                onRecord={(platformUrl) =>
                  onRecordManualResult({
                    platform: variant.platform,
                    ...(platformUrl ? { platformUrl } : {}),
                    status: 'published',
                    variantVersionId: currentVersion.id,
                  })
                }
              />
            ) : null}
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {content_package_export_receipts_empty()}
              </p>
            ) : (
              timeline.map((entry) =>
                entry.kind === 'export' ? (
                  <ExportTimelineEntry
                    disabled={pending || exportBlocked}
                    key={entry.id}
                    onRetry={onExport}
                    receipt={entry.receipt}
                  />
                ) : (
                  <DeliveryTimelineEntry event={entry.event} key={entry.id} />
                )
              )
            )}
          </section>

          {contentPackage.generated.childRuns.some(
            (run) => run.productUsage
          ) ? (
            <section className="space-y-3" aria-labelledby="ledger-title">
              <h3 className="font-medium" id="ledger-title">
                {content_package_ledger_title()}
              </h3>
              {contentPackage.generated.childRuns.map((run) =>
                run.productUsage ? (
                  <div
                    className="space-y-1 rounded-md border border-divider p-3 text-sm"
                    key={run.runId}
                  >
                    <p className="font-medium">
                      {contentPackageRunCapabilityLabel(run.runType)}
                    </p>
                    {run.productUsage ? (
                      <p>
                        {content_package_ledger_product_usage()} ·{' '}
                        {usageStatusLabel(run.productUsage.status)} ·{' '}
                        {run.productUsage.quantity}
                      </p>
                    ) : null}
                  </div>
                ) : null
              )}
            </section>
          ) : null}

          <MarketingEvidenceChips evidence={contentPackage.marketing} />

          {onRecordResultSignal ? (
            <ContentPackageResults
              onRecord={onRecordResultSignal}
              onReviewAction={onResultReviewAction ?? (() => undefined)}
              packageId={contentPackage.id}
              pending={pending}
              results={results}
              weeklyReview={weeklyResultReview}
            />
          ) : null}

          <section className="space-y-3" aria-labelledby="lineage-title">
            <h3
              className="flex items-center gap-2 font-medium"
              id="lineage-title"
            >
              <IconGitBranch />
              {content_package_lineage_title()}
            </h3>
            <LineageList
              emptyLabel={content_package_lineage_source_empty()}
              items={lineage?.ancestors ?? []}
              label={content_package_lineage_source()}
              onOpenPackage={onOpenPackage}
            />
            <LineageList
              emptyLabel={content_package_lineage_children_empty()}
              items={lineage?.children ?? []}
              label={content_package_lineage_children()}
              onOpenPackage={onOpenPackage}
            />
            {lineage?.truncated ? (
              <p className="text-sm text-muted-foreground">
                {content_package_lineage_truncated()}
              </p>
            ) : null}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function ManualDeliveryResultForm({
  disabled,
  onRecord,
}: {
  disabled: boolean;
  onRecord(platformUrl?: string): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(
      new FormData(event.currentTarget).get('platformUrl') ?? ''
    ).trim();
    onRecord(value || undefined);
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor="content-package-delivery-url">
          {content_package_delivery_url()}
        </Label>
        <Input
          disabled={disabled}
          id="content-package-delivery-url"
          name="platformUrl"
          type="url"
        />
      </div>
      <Button disabled={disabled} size="sm" type="submit" variant="outline">
        {content_package_delivery_record_published()}
      </Button>
    </form>
  );
}

export function ContentPackageApprovalCard({
  disabled,
  onApprove,
}: {
  disabled: boolean;
  onApprove(input: {
    accountId: string;
    actionScheduledAt: string;
    cost: { amount: number; currency: 'CNY' };
  }): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('accountId') ?? '').trim();
    const scheduled = String(form.get('actionScheduledAt') ?? '').trim();
    const amount = Number(form.get('cost') ?? 0);
    if (!accountId || !scheduled || !Number.isFinite(amount) || amount < 0) {
      return;
    }
    onApprove({
      accountId,
      actionScheduledAt: new Date(scheduled).toISOString(),
      cost: { amount, currency: 'CNY' },
    });
  }

  return (
    <form
      className="space-y-3 rounded-md border border-divider p-3"
      onSubmit={submit}
    >
      <div>
        <p className="font-medium">
          {content_package_delivery_approval_title()}
        </p>
        <p className="text-xs text-muted-foreground">
          {content_package_delivery_approval_hint()}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-account">
            {content_package_delivery_approval_account()}
          </Label>
          <Input
            disabled={disabled}
            id="content-package-delivery-account"
            name="accountId"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-schedule">
            {content_package_delivery_approval_schedule()}
          </Label>
          <Input
            disabled={disabled}
            id="content-package-delivery-schedule"
            name="actionScheduledAt"
            required
            type="datetime-local"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-cost">
            {content_package_delivery_approval_cost()}
          </Label>
          <Input
            defaultValue="0"
            disabled={disabled}
            id="content-package-delivery-cost"
            min="0"
            name="cost"
            required
            step="0.01"
            type="number"
          />
        </div>
      </div>
      <Button disabled={disabled} type="submit">
        {content_package_delivery_approval_confirm()}
      </Button>
    </form>
  );
}

function ExportTimelineEntry({
  disabled,
  onRetry,
  receipt,
}: {
  disabled: boolean;
  onRetry(platform: ContentPackagePlatform): void;
  receipt: ContentPackageProjection['exportReceipts'][number];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={receipt.status === 'succeeded' ? 'secondary' : 'outline'}>
        {receipt.status === 'succeeded'
          ? content_package_export_succeeded()
          : content_package_export_failed()}
      </Badge>
      <span>{platformLabel(receipt.platform)}</span>
      <span>{receipt.createdAt.slice(0, 16).replace('T', ' ')}</span>
      <span>{receipt.variantVersionId}</span>
      {receipt.sizeBytes !== undefined ? (
        <span>{receipt.sizeBytes} B</span>
      ) : null}
      {receipt.sha256 ? (
        <code title={receipt.sha256}>{receipt.sha256.slice(0, 12)}</code>
      ) : null}
      {receipt.appliedCompliance ? (
        <span>{exportComplianceSummary(receipt.appliedCompliance)}</span>
      ) : null}
      {receipt.appliedCompliance?.watermarkText ? (
        <span>
          {workbench_watermark()}：{receipt.appliedCompliance.watermarkText}
        </span>
      ) : null}
      {receipt.status === 'succeeded' && receipt.artifactObjectKey ? (
        <a
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={`/api/core/p1/assets?objectKey=${encodeURIComponent(receipt.artifactObjectKey)}`}
        >
          {content_package_download_export()}
        </a>
      ) : null}
      {receipt.status === 'failed' ? (
        <>
          <span>{exportFailureLabel(receipt.failureCategory)}</span>
          <Button
            disabled={disabled}
            onClick={() => onRetry(receipt.platform)}
            size="sm"
            type="button"
            variant="outline"
          >
            {content_package_retry_export()}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function DeliveryTimelineEntry({
  event,
}: {
  event: ContentPackageDeliveryEvent;
}) {
  const status =
    event.type === 'automatic_publish_result' ||
    event.type === 'manual_publish_result'
      ? event.status
      : undefined;
  const platformUrl =
    event.type === 'automatic_publish_result' ||
    event.type === 'manual_publish_result'
      ? event.platformUrl
      : undefined;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      data-delivery-event={event.type}
    >
      <Badge variant={status === 'published' ? 'secondary' : 'outline'}>
        {deliveryEventLabel(event)}
      </Badge>
      {status ? <span>{deliveryStatusLabel(status)}</span> : null}
      <span>{platformLabel(event.platform)}</span>
      <span>{event.occurredAt.slice(0, 16).replace('T', ' ')}</span>
      {event.source === 'legacy_read_only' ? (
        <Badge variant="outline">
          {content_package_delivery_event_legacy()}
        </Badge>
      ) : null}
      {platformUrl ? (
        <a
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={platformUrl}
          rel="noreferrer"
          target="_blank"
        >
          {platformUrl}
        </a>
      ) : null}
    </div>
  );
}

function VisualOrder({
  contentPackage,
  media,
  version,
}: {
  contentPackage: ContentPackageProjection;
  media: CanonicalMediaProjection[];
  version: ContentPackageVersion;
}) {
  return (
    <div className="mt-2 space-y-1">
      <p className="text-sm">
        {content_package_visual_order({
          count: version.orderedAssetIds.length,
        })}
      </p>
      <div className="flex gap-1" data-visual-order={version.id}>
        {version.orderedAssetIds.map((assetId, index) => {
          const asset = contentPackage.generated.ownedAssets?.find(
            (candidate) => candidate.id === assetId
          );
          const projectedMedia = media.find(
            (candidate) => candidate.assetId === assetId
          );
          const src = asset
            ? `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`
            : projectedMedia?.src;
          const kind = asset
            ? asset.contentType === 'video/mp4'
              ? 'video'
              : 'image'
            : projectedMedia?.kind;
          return src ? (
            kind === 'video' ? (
              // biome-ignore lint/a11y/useMediaCaption: Generated media has no caption artifact to attach.
              <video
                aria-label={content_package_visual_position({
                  position: index + 1,
                })}
                className="size-12 rounded bg-black object-cover"
                controls
                key={assetId}
                playsInline
                preload="metadata"
                src={src}
              />
            ) : (
              <img
                alt={content_package_visual_position({ position: index + 1 })}
                className="size-12 rounded object-cover"
                key={assetId}
                src={src}
              />
            )
          ) : (
            <Badge key={assetId} variant="outline">
              {content_package_visual_position({ position: index + 1 })}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function LineageList({
  emptyLabel,
  items,
  label,
  onOpenPackage,
}: {
  emptyLabel: string;
  items: ContentPackageProjection[];
  label: string;
  onOpenPackage(packageId: string): void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          {items.map((item) => (
            <Button
              key={item.id}
              onClick={() => onOpenPackage(item.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              {packageTitle(item)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
