import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  content_package_edit_body,
  content_package_edit_hook,
  content_package_edit_title,
  content_package_edit_topics,
  content_package_export_failed,
  content_package_export_compliance_summary,
  content_package_export_failure_unknown,
  content_package_export_platform,
  content_package_export_receipts,
  content_package_export_receipts_empty,
  content_package_export_service_unavailable,
  content_package_export_succeeded,
  content_package_field_changed,
  content_package_generate_variants,
  content_package_history_version,
  content_package_ledger_committed,
  content_package_ledger_product_usage,
  content_package_ledger_refunded,
  content_package_ledger_reserved,
  content_package_ledger_title,
  content_package_lineage_children,
  content_package_lineage_children_empty,
  content_package_lineage_source,
  content_package_lineage_source_empty,
  content_package_lineage_title,
  content_package_platform_video_account,
  content_package_recreate_with_assets,
  content_package_replacement_required,
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
import { VideoWorkflowPanel } from '@/product/video-workflow-panel';
import type {
  ContentPackagePlatform,
  ContentPackageVersion,
} from '@meiye/contracts';
import {
  IconArrowBackUp,
  IconDownload,
  IconGitBranch,
  IconHistory,
  IconRepeat,
  IconSparkles,
} from '@tabler/icons-react';
import { type FormEvent, useState } from 'react';
import type { ContentPackageProjection } from './content-package-card';

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
  platform?: ContentPackagePlatform;
}

interface ContentPackageDetailProps {
  contentPackage: ContentPackageProjection;
  lineage?: ContentPackageLineageProjection;
  media?: CanonicalMediaProjection[];
  pending?: boolean;
  onEdit(input: ContentPackageEditInput): void;
  onExport(platform: ContentPackagePlatform): void;
  onGenerateVariants(): void;
  onOpenPackage(packageId: string): void;
  onRetryVariantCatalog?(): void;
  onReuse(): void;
  onRollback(versionId: string): void;
  variantQuoteLabel?: string;
  variantCatalogState?: 'loading' | 'unavailable';
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

function exportFailureLabel(category: string | undefined) {
  return category === 'export_adapter_failed' ||
    category === 'archive_unavailable'
    ? content_package_export_service_unavailable()
    : content_package_export_failure_unknown();
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
  lineage,
  media = [],
  pending = false,
  onEdit,
  onExport,
  onGenerateVariants,
  onOpenPackage,
  onRetryVariantCatalog,
  onReuse,
  onRollback,
  variantQuoteLabel,
  variantCatalogState,
}: ContentPackageDetailProps) {
  const [target, setTarget] = useState<VersionTarget>(
    contentPackage.variants[0]?.platform ?? 'package'
  );
  const [comparisonVersionId, setComparisonVersionId] = useState<string>();
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
  const comparisonVersion =
    versions.find(
      (version) =>
        version.id === comparisonVersionId && version.id !== currentVersionId
    ) ?? versions.find((version) => version.id !== currentVersionId);
  const receipts = [
    ...contentPackage.exportReceipts.filter(
      (receipt) => target === 'package' || receipt.platform === target
    ),
  ].reverse();
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
          `/dashboard?workId=${encodeURIComponent(workId)}`
        )}
        workId={workId}
        {...(workflowId ? { workflowId } : {})}
      />
    ) : null;

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentVersion) return;
    const form = new FormData(event.currentTarget);
    const conversionHook = String(form.get('conversionHook') ?? '').trim();
    onEdit({
      baseVersionId: currentVersion.id,
      changes: {
        body: String(form.get('body') ?? ''),
        ...(conversionHook ? { conversionHook } : {}),
        orderedAssetIds: [...currentVersion.orderedAssetIds],
        title: String(form.get('title') ?? ''),
        topics: String(form.get('topics') ?? '')
          .split(/[,，]/)
          .map((topic) => topic.trim())
          .filter(Boolean),
      },
      ...(variant ? { platform: variant.platform } : {}),
    });
  }

  if (!currentVersion) {
    return videoWorkflow;
  }

  return (
    <Card className="rounded-md border-primary/20 bg-surface-1 shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{content_package_detail_title()}</CardTitle>
          <Badge className="ml-auto" variant="outline">
            {contentPackage.statusLabel}
          </Badge>
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
          {contentPackage.variants.length === 0 && variantQuoteLabel ? (
            <Button
              disabled={pending}
              onClick={onGenerateVariants}
              size="sm"
              type="button"
              variant="outline"
            >
              <IconSparkles />
              {content_package_generate_variants({
                price: variantQuoteLabel,
              })}
            </Button>
          ) : null}
          {contentPackage.variants.length === 0 &&
          !variantQuoteLabel &&
          variantCatalogState === 'loading' ? (
            <Button disabled size="sm" type="button" variant="outline">
              {content_package_variants_loading()}
            </Button>
          ) : null}
          {contentPackage.variants.length === 0 &&
          !variantQuoteLabel &&
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
        {videoWorkflow ? (
          <div className="xl:col-span-2">{videoWorkflow}</div>
        ) : null}
        <form
          className="space-y-4"
          key={currentVersion.id}
          onSubmit={submitEdit}
        >
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
              </div>
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
                    ? `/dashboard?workId=${encodeURIComponent(contentPackage.source.workId)}`
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
                        <Badge variant="outline">{sourceLabel}</Badge>
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
              {content_package_export_receipts()}
            </h3>
            {receipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {content_package_export_receipts_empty()}
              </p>
            ) : (
              receipts.map((receipt) => (
                <div
                  className="flex flex-wrap items-center gap-2 text-sm"
                  key={receipt.id}
                >
                  <Badge
                    variant={
                      receipt.status === 'succeeded' ? 'secondary' : 'outline'
                    }
                  >
                    {receipt.status === 'succeeded'
                      ? content_package_export_succeeded()
                      : content_package_export_failed()}
                  </Badge>
                  <span>{platformLabel(receipt.platform)}</span>
                  <span>
                    {receipt.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                  <span>{receipt.variantVersionId}</span>
                  {receipt.sizeBytes !== undefined ? (
                    <span>{receipt.sizeBytes} B</span>
                  ) : null}
                  {receipt.sha256 ? (
                    <code title={receipt.sha256}>
                      {receipt.sha256.slice(0, 12)}
                    </code>
                  ) : null}
                  {receipt.status === 'succeeded' &&
                  receipt.artifactObjectKey ? (
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
                        disabled={pending || exportBlocked}
                        onClick={() => onExport(receipt.platform)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {content_package_retry_export()}
                      </Button>
                    </>
                  ) : null}
                </div>
              ))
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
                      {run.actualCatalogModelId ?? run.runType}
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
          </section>
        </div>
      </CardContent>
    </Card>
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
