import {
  CONTENT_PACKAGE_STATUS_GROUP_LABELS,
  type ContentPackageDeliveryEvent,
  type ContentItem,
  type ContentPackageStatusGroup,
  type CreativeWorkbenchProjection,
  type ProductCommand,
  type ProductState,
} from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBrandTiktok,
  IconBrandX,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconPackage,
  IconRefresh,
  IconRepeat,
  IconSparkles,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { HandoffQr } from '@/components/product/handoff-qr';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  account_usage_retry,
  account_usage_load_error,
  account_usage_loading,
  content_library_empty_action,
  content_library_empty_description,
  content_library_empty_title,
  content_operation_failed_description,
  content_package_legacy_history,
  content_package_legacy_read_only,
  content_package_legacy_view_migrated,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
  dashboard_content_checklist_title,
  dashboard_content_copied,
  dashboard_content_count,
  dashboard_content_create_weekly_set,
  dashboard_content_description,
  dashboard_content_duration_version,
  dashboard_content_empty_description,
  dashboard_content_empty_title,
  dashboard_content_handoff_ready,
  dashboard_content_handoff_status_pending,
  dashboard_content_handoff_summary,
  dashboard_content_handoff_title,
  dashboard_content_mobile_handoff,
  dashboard_content_platform_duration,
  dashboard_content_quick_edit_conversational,
  dashboard_content_quick_edit_local_positioning,
  dashboard_content_quick_edit_professional,
  dashboard_content_quick_edit_weaker_advertising,
  dashboard_content_remix,
  dashboard_content_revert_to_ai,
  dashboard_content_scan_qr,
  dashboard_content_source_content_missing_description,
  dashboard_content_source_content_missing_title,
  dashboard_content_source_handoff_missing_description,
  dashboard_content_source_handoff_missing_title,
  dashboard_content_undo,
  dashboard_handoff_copy,
  dashboard_handoff_field_body,
  dashboard_handoff_field_conversion,
  dashboard_handoff_field_title,
  dashboard_handoff_field_topics,
  dashboard_handoff_reported,
  p1_filter_content_draft,
  p1_filter_content_published,
  product_client_command_failed,
  product_client_state_failed,
  product_navigation_content,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import type { TrustedReturnId } from '@/product/trusted-return';
import {
  ContentPackageCard,
  type ContentPackageProjection,
} from '@/p1/content-package-card';
import {
  ContentPackageDetail,
  type ContentPackageLineageProjection,
} from '@/p1/content-package-detail';
import { operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { sourceObjectElementId } from '@/p1/source-object-navigation';
import { useProductState } from '@/product/client';
import type { AccountUsageProjection } from '@/product/account-usage';
import { canonicalMediaForAssetIds } from '@/product/canonical-history-model';
import { OutputQuotaMeter } from '@/product/output-quota-meter';
import { LegacyContentBody, writeTextToClipboard } from './-content-helpers';

const douyinDurations = [15, 30, 60] as const;
const quickEdits = [
  'conversational',
  'professional',
  'weaker_advertising',
  'local_positioning',
] as const;

function quickEditLabel(instruction: (typeof quickEdits)[number]) {
  switch (instruction) {
    case 'conversational':
      return dashboard_content_quick_edit_conversational();
    case 'professional':
      return dashboard_content_quick_edit_professional();
    case 'weaker_advertising':
      return dashboard_content_quick_edit_weaker_advertising();
    case 'local_positioning':
      return dashboard_content_quick_edit_local_positioning();
  }
}

function platformLabel(platform: 'xiaohongshu' | 'douyin') {
  return platform === 'xiaohongshu'
    ? creation_entry_platform_xiaohongshu()
    : creation_entry_platform_douyin();
}

interface ContentLibrarySelection {
  contentId?: string;
  handoffId?: string;
  packageId?: string;
  from?: TrustedReturnId;
}

export function ContentLibrarySurface({
  onOpenPackage,
  selection,
}: {
  onOpenPackage(packageId: string): void;
  selection: ContentLibrarySelection;
}) {
  const {
    contentId: requestedContentId,
    handoffId: sourceHandoffId,
    packageId: requestedPackageId,
    from: trustedReturnFrom,
  } = selection;
  const { state, error, loading, pending, execute, refresh } =
    useProductState();
  const contentPackagesQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackageProjection[]>(
        'content_packages',
        {},
        signal
      ),
    retry: false,
  });
  const contentPackages = contentPackagesQuery.data ?? [];
  const accountUsageQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
    retry: false,
  });
  const creativeQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: false,
  });
  const sourcePackage = requestedPackageId
    ? contentPackages.find((item) => item.id === requestedPackageId)
    : undefined;
  const lineageQuery = useQuery({
    enabled: Boolean(sourcePackage),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackageLineageProjection>(
        'content_package_lineage',
        { packageId: requestedPackageId! },
        signal
      ),
    queryKey: p1QueryKeys.request('operations', 'content_package_lineage', {
      packageId: requestedPackageId ?? '',
    }),
    retry: false,
  });
  const deliveryTimelineQuery = useQuery({
    enabled: Boolean(sourcePackage),
    queryFn: ({ signal }) =>
      operationsQuery<ContentPackageDeliveryEvent[]>(
        'content_package_delivery_timeline',
        { packageId: requestedPackageId! },
        signal
      ),
    queryKey: p1QueryKeys.request(
      'operations',
      'content_package_delivery_timeline',
      { packageId: requestedPackageId ?? '' }
    ),
    retry: false,
  });
  const [copied, setCopied] = useState<string>();
  const sourceHandoff = sourceHandoffId
    ? state?.handoffPackages.find(
        (item) => item.id === sourceHandoffId || item.token === sourceHandoffId
      )
    : undefined;
  const sourceContentId = requestedContentId ?? sourceHandoff?.contentId;
  const sourceContent = sourceContentId
    ? state?.contents.find((item) => item.id === sourceContentId)
    : undefined;

  useEffect(() => {
    if (!sourceContentId || !state) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(sourceObjectElementId('content', sourceContentId))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sourceContentId, state]);

  useEffect(() => {
    if (!requestedPackageId || !sourcePackage) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`content-package-${requestedPackageId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedPackageId, sourcePackage]);

  async function run(command: ProductCommand) {
    try {
      await execute(command);
    } catch {
      // The shared error surface renders the actionable server message.
    }
  }

  async function copyText(label: string, text: string) {
    await writeTextToClipboard(text);
    setCopied(label);
    toast.success(dashboard_content_copied());
    window.setTimeout(() => setCopied(undefined), 1600);
  }

  function openPackage(packageId: string) {
    onOpenPackage(packageId);
  }

  if (
    loading ||
    !state ||
    contentPackagesQuery.isPending ||
    creativeQuery.isPending
  ) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const latestPackage = sourceHandoff ?? state.handoffPackages.at(-1);

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_content(), isCurrentPage: true },
        ]}
        actions={
          <Badge variant="outline">
            {dashboard_content_count({
              count: contentPackages.length,
            })}
          </Badge>
        }
      />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 bg-surface-0 p-4 lg:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {product_navigation_content()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard_content_description()}
          </p>
          <div className="mt-3">
            {accountUsageQuery.data ? (
              <OutputQuotaMeter projection={accountUsageQuery.data} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {accountUsageQuery.isPending
                  ? account_usage_loading()
                  : account_usage_load_error()}
              </p>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{product_client_command_failed()}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              {content_operation_failed_description()}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                <IconRefresh />
                {account_usage_retry()}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {sourceContentId && !sourceContent ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {dashboard_content_source_content_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {dashboard_content_source_content_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {sourceHandoffId && !sourceHandoff ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {dashboard_content_source_handoff_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {dashboard_content_source_handoff_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {requestedPackageId && !sourcePackage ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {dashboard_content_source_content_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {dashboard_content_source_content_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {contentPackagesQuery.isError ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{product_client_state_failed()}</AlertTitle>
            <AlertDescription>
              {contentPackagesQuery.error.message}
            </AlertDescription>
          </Alert>
        ) : null}

        {sourcePackage ? (
          <ContentPackageDetail
            contentPackage={sourcePackage}
            deliveryTimeline={deliveryTimelineQuery.data}
            lineage={lineageQuery.data}
            media={canonicalMediaForAssetIds(
              creativeQuery.data?.assets ?? [],
              state.assets,
              sourcePackage.versions.find(
                (version) => version.id === sourcePackage.currentVersionId
              )?.orderedAssetIds ?? sourcePackage.generated.assetIds
            )}
            onOpenPackage={openPackage}
            returnFrom={trustedReturnFrom}
          />
        ) : null}

        {contentPackages.length === 0 ? (
          <WarmEmptyState
            action={
              <a
                className={buttonVariants()}
                href={getPathWithLocale(Routes.Dashboard)}
              >
                {content_library_empty_action()}
              </a>
            }
            description={content_library_empty_description()}
            media={<IconFileText />}
            title={content_library_empty_title()}
          />
        ) : (
          <ContentPackageLibrary
            creativeAssets={creativeQuery.data?.assets ?? []}
            highlightedId={requestedPackageId}
            items={contentPackages}
            onOpenPackage={openPackage}
            productAssets={state.assets}
          />
        )}

        {state.contents.length > 0 ? (
          <details className="border-t border-divider pt-5">
            <summary className="cursor-pointer text-sm font-medium">
              {content_package_legacy_history({
                count: state.contents.length,
              })}
            </summary>
            <div className="mt-4">
              <ContentGrid
                highlightedId={sourceContentId}
                items={state.contents}
                migratedPackageIds={
                  new Map(
                    contentPackages.flatMap((contentPackage) =>
                      contentPackage.legacySource?.sourceType ===
                      'product_content_item'
                        ? [
                            [
                              contentPackage.legacySource.sourceId,
                              contentPackage.id,
                            ] as const,
                          ]
                        : []
                    )
                  )
                }
                pending={pending}
                readOnly
                run={run}
                onCopy={copyText}
              />
            </div>
          </details>
        ) : null}

        {latestPackage && (
          <section
            aria-labelledby="handoff-heading"
            className={
              sourceHandoff?.id === latestPackage.id
                ? 'bg-surface-1 p-4'
                : 'border-t border-divider pt-5'
            }
            data-source-highlight={
              sourceHandoff?.id === latestPackage.id ? 'true' : undefined
            }
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="handoff-heading" className="text-lg font-semibold">
                  {dashboard_content_handoff_title()}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dashboard_content_handoff_summary({
                    platform: platformLabel(latestPackage.platform),
                    status:
                      latestPackage.status === 'ready'
                        ? dashboard_content_handoff_status_pending()
                        : dashboard_handoff_reported(),
                  })}
                </p>
              </div>
              <Badge
                variant={
                  latestPackage.status === 'published' ? 'default' : 'secondary'
                }
              >
                {latestPackage.status === 'published'
                  ? p1_filter_content_published()
                  : dashboard_content_handoff_ready()}
              </Badge>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="divide-y divide-divider">
                {[
                  [dashboard_handoff_field_title(), latestPackage.title],
                  [dashboard_handoff_field_body(), latestPackage.body],
                  [
                    dashboard_handoff_field_topics(),
                    latestPackage.topics.map((topic) => `#${topic}`).join(' '),
                  ],
                  [
                    dashboard_handoff_field_conversion(),
                    latestPackage.conversionText,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid gap-2 py-3 sm:grid-cols-[72px_1fr_auto] sm:items-start"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {value}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyText(label, value)}
                    >
                      {copied === label ? <IconCheck /> : <IconCopy />}
                      {copied === label
                        ? dashboard_content_copied()
                        : dashboard_handoff_copy()}
                    </Button>
                  </div>
                ))}
              </div>
              <aside className="space-y-4">
                <div className="mx-auto w-44 bg-white p-2">
                  <HandoffQr token={latestPackage.token} />
                  <p className="mt-1 text-center text-xs text-neutral-600">
                    {dashboard_content_scan_qr()}
                  </p>
                </div>
                <Card className="rounded-md bg-surface-1 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {dashboard_content_checklist_title()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {latestPackage.checklist.map((item) => (
                      <p key={item} className="flex gap-2 text-sm">
                        <IconCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                        {item}
                      </p>
                    ))}
                  </CardContent>
                </Card>
                <a
                  href={getPathWithLocale(
                    `/dashboard/handoff/${encodeURIComponent(latestPackage.token)}`
                  )}
                  className="flex h-9 items-center justify-center gap-2 rounded-md bg-surface-2 text-sm font-medium hover:bg-surface-1"
                >
                  {dashboard_content_mobile_handoff()}
                  <IconExternalLink className="size-4" />
                </a>
                <Badge className="w-full justify-center" variant="outline">
                  {content_package_legacy_read_only()}
                </Badge>
              </aside>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function ContentGrid({
  highlightedId,
  items,
  migratedPackageIds,
  onCopy,
  pending,
  readOnly = false,
  run,
}: {
  highlightedId?: string;
  items: ContentItem[];
  migratedPackageIds?: ReadonlyMap<string, string>;
  onCopy?: (label: string, text: string) => Promise<void>;
  pending: boolean;
  readOnly?: boolean;
  run: (command: ProductCommand) => Promise<void>;
}) {
  const [expandedContentIds, setExpandedContentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  if (items.length === 0) {
    return (
      <div className="rounded-md bg-surface-1 py-14 text-center">
        <IconFileText className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {dashboard_content_empty_title()}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {dashboard_content_empty_description()}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {items.map((content) => {
        const migratedPackageId = migratedPackageIds?.get(content.id);
        const xhs = content.variants.find(
          (variant) => variant.platform === 'xiaohongshu'
        );
        const douyin = content.variants.find(
          (variant) => variant.platform === 'douyin'
        );
        const version = xhs?.versions.find(
          (item) => item.id === xhs.currentVersionId
        );
        const body = version?.body ?? '';
        const expanded = expandedContentIds.has(content.id);
        return (
          <Card
            className={
              content.id === highlightedId
                ? 'rounded-md bg-surface-2 shadow-none'
                : 'rounded-md bg-surface-1 shadow-none'
            }
            data-source-highlight={
              content.id === highlightedId ? 'true' : undefined
            }
            id={sourceObjectElementId('content', content.id)}
            key={content.id}
          >
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <IconBrandX className="size-3" />
                  {creation_entry_platform_xiaohongshu()}
                </Badge>
                {douyin && (
                  <Badge variant="secondary">
                    <IconBrandTiktok className="size-3" />
                    {douyin.durationSeconds === undefined
                      ? creation_entry_platform_douyin()
                      : dashboard_content_platform_duration({
                          platform: creation_entry_platform_douyin(),
                          seconds: douyin.durationSeconds,
                        })}
                  </Badge>
                )}
                <Badge variant="outline" className="ml-auto">
                  {readOnly
                    ? content_package_legacy_read_only()
                    : content.status === 'published'
                      ? p1_filter_content_published()
                      : p1_filter_content_draft()}
                </Badge>
              </div>
              <CardTitle className="text-base leading-6">
                {version?.title}
              </CardTitle>
              {readOnly ? (
                <LegacyContentBody
                  body={body}
                  expanded={expanded}
                  onCopy={(text) =>
                    onCopy?.(`legacy-content:${content.id}`, text)
                  }
                  onToggle={() => {
                    setExpandedContentIds((current) => {
                      const next = new Set(current);
                      if (next.has(content.id)) {
                        next.delete(content.id);
                      } else {
                        next.add(content.id);
                      }
                      return next;
                    });
                  }}
                />
              ) : (
                <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {readOnly && migratedPackageId ? (
                <a
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  href={getPathWithLocale(
                    `/dashboard/content/${encodeURIComponent(migratedPackageId)}`
                  )}
                >
                  <IconExternalLink />
                  {content_package_legacy_view_migrated()}
                </a>
              ) : null}
              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  {!douyin && (
                    <div className="flex flex-wrap gap-2">
                      {douyinDurations.map((durationSeconds) => (
                        <Button
                          key={durationSeconds}
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            void run({
                              type: 'create_douyin_variant',
                              contentId: content.id,
                              durationSeconds,
                            })
                          }
                        >
                          <IconBrandTiktok />
                          {dashboard_content_duration_version({
                            seconds: durationSeconds,
                          })}
                        </Button>
                      ))}
                    </div>
                  )}
                  {quickEdits.map((instruction) => (
                    <Button
                      key={instruction}
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void run({
                          type: 'quick_edit',
                          contentId: content.id,
                          instruction,
                        })
                      }
                    >
                      <IconSparkles />
                      {quickEditLabel(instruction)}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void run({ type: 'remix_content', contentId: content.id })
                    }
                  >
                    <IconRepeat />
                    {dashboard_content_remix()}
                  </Button>
                </div>
              ) : null}
              {!readOnly ? (
                <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run({
                        type: 'undo_edit',
                        contentId: content.id,
                        platform: 'xiaohongshu',
                      })
                    }
                  >
                    <IconArrowBackUp />
                    {dashboard_content_undo()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run({
                        type: 'revert_to_ai',
                        contentId: content.id,
                        platform: 'xiaohongshu',
                      })
                    }
                  >
                    <IconRefresh />
                    {dashboard_content_revert_to_ai()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run({
                        type: 'create_weekly_set',
                        contentId: content.id,
                      })
                    }
                  >
                    <IconPackage />
                    {dashboard_content_create_weekly_set()}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

const contentPackageGroups: ContentPackageStatusGroup[] = [
  'creating',
  'usable',
  'needs_attention',
];

function ContentPackageLibrary({
  creativeAssets,
  highlightedId,
  items,
  onOpenPackage,
  productAssets,
}: {
  creativeAssets: CreativeWorkbenchProjection['assets'];
  highlightedId?: string;
  items: ContentPackageProjection[];
  onOpenPackage(packageId: string): void;
  productAssets: ProductState['assets'];
}) {
  const highlighted = items.find((item) => item.id === highlightedId);
  const defaultGroup =
    highlighted?.statusGroup ??
    contentPackageGroups.find((group) =>
      items.some((item) => item.statusGroup === group)
    ) ??
    'creating';

  return (
    <Tabs className="min-w-0" defaultValue={defaultGroup}>
      <TabsList variant="line">
        {contentPackageGroups.map((group) => (
          <TabsTrigger key={group} value={group}>
            {CONTENT_PACKAGE_STATUS_GROUP_LABELS[group]} (
            {items.filter((item) => item.statusGroup === group).length})
          </TabsTrigger>
        ))}
      </TabsList>
      {contentPackageGroups.map((group) => {
        const groupedItems = items.filter((item) => item.statusGroup === group);
        return (
          <TabsContent className="mt-4" key={group} value={group}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {groupedItems.map((contentPackage) => (
                <div
                  className={
                    contentPackage.id === highlightedId
                      ? 'rounded-2xl ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
                      : undefined
                  }
                  key={contentPackage.id}
                >
                  <ContentPackageCard
                    contentPackage={contentPackage}
                    media={canonicalMediaForAssetIds(
                      creativeAssets,
                      productAssets,
                      contentPackage.versions.find(
                        (version) =>
                          version.id === contentPackage.currentVersionId
                      )?.orderedAssetIds ?? contentPackage.generated.assetIds
                    )}
                    onOpen={() => onOpenPackage(contentPackage.id)}
                  />
                </div>
              ))}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
