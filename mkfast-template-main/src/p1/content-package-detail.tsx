import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  content_package_current_version,
  content_package_delivery_history,
  content_package_delivery_event_assisted,
  content_package_delivery_event_automatic,
  content_package_delivery_event_legacy,
  content_package_delivery_event_manual,
  content_package_delivery_status_failed,
  content_package_delivery_status_published,
  content_package_delivery_status_unknown,
  content_package_detail_title,
  content_package_export_failed,
  content_package_export_receipts_empty,
  content_package_export_succeeded,
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
  content_package_source_ai,
  content_package_source_merchant,
  content_package_source_rollback,
  content_package_version_history,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
} from '@/locale/paraglide/messages';
import type { CanonicalMediaProjection } from '@/product/canonical-history-model';
import { HotTopicOpportunityCardView } from '@/product/hot-topic-opportunity-card';
import { MarketingEvidenceChips } from '@/product/marketing-evidence-chips';
import { TrustedReturnAnchor } from '@/product/trusted-return';
import type {
  ContentPackageDeliveryEvent,
  ContentPackagePlatform,
  ContentPackageVersion,
} from '@meiye/contracts';
import { IconGitBranch, IconHistory } from '@tabler/icons-react';
import type { ContentPackageProjection } from './content-package-card';

export interface ContentPackageLineageProjection {
  ancestors: ContentPackageProjection[];
  children: ContentPackageProjection[];
  truncated: boolean;
}

interface ContentPackageDetailProps {
  contentPackage: ContentPackageProjection;
  deliveryTimeline?: ContentPackageDeliveryEvent[];
  lineage?: ContentPackageLineageProjection;
  media?: CanonicalMediaProjection[];
  onOpenPackage?(packageId: string): void;
  /** Allowlisted trusted return id only (never a free-form URL). */
  returnFrom?: unknown;
}

function platformLabel(platform: ContentPackagePlatform) {
  if (platform === 'xiaohongshu') return creation_entry_platform_xiaohongshu();
  if (platform === 'douyin') return creation_entry_platform_douyin();
  return content_package_platform_video_account();
}

function versionSourceLabel(source: ContentPackageVersion['source']) {
  if (source === 'ai_generated') return content_package_source_ai();
  if (source === 'merchant_edited') return content_package_source_merchant();
  if (source === 'rollback_restored') return content_package_source_rollback();
  return undefined;
}

function usageStatusLabel(status: 'committed' | 'refunded' | 'reserved') {
  if (status === 'committed') return content_package_ledger_committed();
  if (status === 'refunded') return content_package_ledger_refunded();
  return content_package_ledger_reserved();
}

function deliveryStatusLabel(status: 'failed' | 'published' | 'unknown') {
  if (status === 'published')
    return content_package_delivery_status_published();
  if (status === 'failed') return content_package_delivery_status_failed();
  return content_package_delivery_status_unknown();
}

function deliveryEventLabel(event: ContentPackageDeliveryEvent) {
  let label: string;
  if (event.type === 'automatic_publish_result') {
    label = content_package_delivery_event_automatic();
  } else if (event.type === 'manual_publish_result') {
    label = content_package_delivery_event_manual();
  } else if (event.type === 'legacy_handoff_event') {
    label = content_package_delivery_event_legacy();
  } else {
    label = content_package_delivery_event_assisted();
  }
  return 'status' in event
    ? `${label} · ${deliveryStatusLabel(event.status)}`
    : label;
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

function VersionArchive({
  currentVersionId,
  label,
  versions,
}: {
  currentVersionId?: string;
  label: string;
  versions: ContentPackageVersion[];
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{label}</h4>
      {[...versions].reverse().map((version, reverseIndex) => {
        const source = versionSourceLabel(version.source);
        return (
          <article
            className="space-y-2 rounded-md border border-divider p-3"
            data-version-id={version.id}
            key={version.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                V{versions.length - reverseIndex} · {version.title}
              </span>
              {source ? <Badge variant="outline">{source}</Badge> : null}
              {version.id === currentVersionId ? (
                <Badge variant="secondary">
                  {content_package_current_version()}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {version.createdAt.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{version.body}</p>
            {version.conversionHook ? (
              <p className="text-sm text-muted-foreground">
                {version.conversionHook}
              </p>
            ) : null}
            {version.topics.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {version.topics.join(' · ')}
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function ArchiveMedia({ media }: { media: CanonicalMediaProjection[] }) {
  if (media.length === 0) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {media.map((item) =>
        item.kind === 'video' ? (
          <a
            className="rounded-md border border-divider p-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={item.href}
            key={item.assetId}
          >
            查看视频素材：{item.title}
          </a>
        ) : (
          <img
            alt={item.title}
            className="w-full rounded-md border border-divider"
            key={item.assetId}
            loading="lazy"
            src={item.src}
          />
        )
      )}
    </section>
  );
}

function LineageArchive({
  lineage,
  onOpenPackage,
}: {
  lineage?: ContentPackageLineageProjection;
  onOpenPackage?: (packageId: string) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="lineage-title">
      <h3 className="flex items-center gap-2 font-medium" id="lineage-title">
        <IconGitBranch />
        {content_package_lineage_title()}
      </h3>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {content_package_lineage_source()}
        </p>
        {lineage?.ancestors.length ? (
          lineage.ancestors.map((item) => (
            <Button
              key={item.id}
              onClick={() => onOpenPackage?.(item.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {item.versions.find(
                (version) => version.id === item.currentVersionId
              )?.title ?? item.id}
            </Button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {content_package_lineage_source_empty()}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {content_package_lineage_children()}
        </p>
        {lineage?.children.length ? (
          lineage.children.map((item) => (
            <Button
              key={item.id}
              onClick={() => onOpenPackage?.(item.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {item.versions.find(
                (version) => version.id === item.currentVersionId
              )?.title ?? item.id}
            </Button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {content_package_lineage_children_empty()}
          </p>
        )}
      </div>
      {lineage?.truncated ? (
        <p className="text-xs text-muted-foreground">
          {content_package_lineage_truncated()}
        </p>
      ) : null}
    </section>
  );
}

export function ContentPackageDetail({
  contentPackage,
  deliveryTimeline,
  lineage,
  media = [],
  onOpenPackage,
  returnFrom,
}: ContentPackageDetailProps) {
  const workId = contentPackage.source.workId;
  const timeline = [
    ...contentPackage.exportReceipts.map((receipt) => ({
      id: receipt.id,
      label: `${platformLabel(receipt.platform)} · ${
        receipt.status === 'succeeded'
          ? content_package_export_succeeded()
          : content_package_export_failed()
      }`,
      occurredAt: receipt.createdAt,
    })),
    ...(deliveryTimeline ?? contentPackage.deliveryEvents ?? []).map(
      (event) => ({
        id: event.id,
        label: `${platformLabel(event.platform)} · ${deliveryEventLabel(event)}`,
        occurredAt: event.occurredAt,
      })
    ),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  return (
    <Card
      className="rounded-md border-primary/20 bg-surface-1 shadow-none"
      data-cutover-state={workId ? 'result-center-handoff' : 'legacy-read-only'}
    >
      <CardHeader className="gap-3">
        <TrustedReturnAnchor from={returnFrom} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base leading-snug font-medium">
            {content_package_detail_title()}
          </h2>
          <Badge className="ml-auto" variant="outline">
            {contentPackage.statusLabel}
          </Badge>
        </div>
        <section
          className="space-y-3 rounded-md border bg-surface-2 p-3"
          data-testid="content-package-detail-result-handoff"
        >
          {workId ? (
            <>
              <div>
                <h3 className="font-medium">继续在结果中心处理</h3>
                <p className="text-sm text-muted-foreground">
                  调整、采用、重新生成与交付已统一收敛到结果中心。
                </p>
              </div>
              <a
                className="inline-flex min-h-touch-target items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                data-testid="content-package-open-result-center"
                href={`/dashboard/results/${encodeURIComponent(workId)}?contentId=${encodeURIComponent(contentPackage.id)}`}
              >
                打开结果中心
              </a>
            </>
          ) : (
            <div>
              <h3 className="font-medium">历史只读档案</h3>
              <p className="text-sm text-muted-foreground">
                该历史内容未记录来源
                Work，仅保留版本、来源与回执，不猜测其他结果目标。
              </p>
            </div>
          )}
        </section>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-6">
          <HotTopicOpportunityCardView
            opportunity={contentPackage.marketing?.opportunity}
          />
          <ArchiveMedia media={media} />
          <VersionArchive
            currentVersionId={contentPackage.currentVersionId}
            label={content_package_version_history()}
            versions={contentPackage.versions}
          />
          {contentPackage.variants.map((variant) => (
            <VersionArchive
              currentVersionId={variant.currentVersionId}
              key={variant.id}
              label={platformLabel(variant.platform)}
              versions={variant.versions}
            />
          ))}
          <MarketingEvidenceChips evidence={contentPackage.marketing} />
        </div>

        <div className="space-y-6">
          <section
            className="space-y-3"
            aria-labelledby="archive-history-title"
          >
            <h3
              className="flex items-center gap-2 font-medium"
              id="archive-history-title"
            >
              <IconHistory />
              {content_package_delivery_history()}
            </h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {content_package_export_receipts_empty()}
              </p>
            ) : (
              timeline.map((entry) => (
                <article
                  className="rounded-md border border-divider p-3"
                  key={entry.id}
                >
                  <p className="text-sm font-medium">{entry.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.occurredAt.slice(0, 16).replace('T', ' ')}
                  </p>
                </article>
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
                      {contentPackageRunCapabilityLabel(run.runType)}
                    </p>
                    <p>
                      {content_package_ledger_product_usage()} ·{' '}
                      {usageStatusLabel(run.productUsage.status)} ·{' '}
                      {run.productUsage.quantity}
                    </p>
                  </div>
                ) : null
              )}
            </section>
          ) : null}

          <LineageArchive lineage={lineage} onOpenPackage={onOpenPackage} />
        </div>
      </CardContent>
    </Card>
  );
}
