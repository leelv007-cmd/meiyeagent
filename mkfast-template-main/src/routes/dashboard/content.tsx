import { DashboardHeader } from '@/components/layout/dashboard-header';
import { QuotaMeter } from '@/components/product/quota-meter';
import { HandoffQr } from '@/components/product/handoff-qr';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { m } from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import {
  ContentPackageCard,
  type ContentPackageProjection,
} from '@/p1/content-package-card';
import {
  type ContentPackageActionFeedback,
  recoverContentPackageAction,
} from '@/p1/content-package-action-feedback';
import {
  ContentPackageDetail,
  type ContentPackageEditInput,
  type ContentPackageLineageProjection,
} from '@/p1/content-package-detail';
import {
  createOperationsCommandIntentRegistry,
  operationsCommand,
  operationsQuery,
  queryP1,
} from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  selectAvailableCatalogModel,
} from '@/p1/settings-view-model';
import {
  optionalSourceId,
  sourceObjectElementId,
} from '@/p1/source-object-navigation';
import { useProductState } from '@/product/client';
import { canonicalMediaForAssetIds } from '@/product/canonical-history-model';
import { creativeQuoteRevision, quoteFor } from '@/product/creative-quote';
import {
  CONTENT_PACKAGE_STATUS_GROUP_LABELS,
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
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/dashboard/content')({
  validateSearch: (search: Record<string, unknown>) => {
    const contentId = optionalSourceId(search.contentId);
    const handoffId = optionalSourceId(search.handoffId);
    const packageId = optionalSourceId(search.packageId);
    return {
      ...(contentId ? { contentId } : {}),
      ...(handoffId ? { handoffId } : {}),
      ...(packageId ? { packageId } : {}),
    };
  },
  component: ContentLibraryPage,
});

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
      return m.dashboard_content_quick_edit_conversational();
    case 'professional':
      return m.dashboard_content_quick_edit_professional();
    case 'weaker_advertising':
      return m.dashboard_content_quick_edit_weaker_advertising();
    case 'local_positioning':
      return m.dashboard_content_quick_edit_local_positioning();
  }
}

function platformLabel(platform: 'xiaohongshu' | 'douyin') {
  return platform === 'xiaohongshu'
    ? m.creation_entry_platform_xiaohongshu()
    : m.creation_entry_platform_douyin();
}

function ContentLibraryPage() {
  const search = Route.useSearch();
  const {
    contentId: requestedContentId,
    handoffId: sourceHandoffId,
    packageId: requestedPackageId,
  } = search;
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
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
  const variantCatalogQuery = useQuery<{
    deployments?: unknown[];
    models?: unknown[];
    revisionId?: string;
  }>({
    enabled: Boolean(sourcePackage && sourcePackage.variants.length === 0),
    queryFn: ({ signal }) =>
      queryP1(
        'model-supply',
        { action: 'catalog', payload: { operation: 'copy.adapt' } },
        signal
      ),
    queryKey: p1QueryKeys.request('model-supply', 'catalog', {
      operation: 'copy.adapt',
    }),
    retry: false,
  });
  const variantModel = selectAvailableCatalogModel(
    normalizeCatalog(variantCatalogQuery.data ?? {}, 'copy.adapt')
  );
  const variantQuote = quoteFor('copy.adapt', variantModel, '3:4');
  const variantQuoteLabel =
    variantQuote.estimatedAmount !== undefined && variantQuote.currency
      ? `${variantQuote.currency === 'USD' ? 'US$' : `${variantQuote.currency} `}${variantQuote.estimatedAmount.toFixed(2)}`
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
  const [copied, setCopied] = useState<string>();
  const [packageCommandIntents] = useState(() =>
    createOperationsCommandIntentRegistry()
  );
  const [packageActionError, setPackageActionError] =
    useState<ContentPackageActionFeedback>();
  const [packageActionPending, setPackageActionPending] = useState(false);
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
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(undefined), 1600);
  }

  function openPackage(packageId: string) {
    void navigate({
      search: { ...search, packageId },
    });
  }

  async function runPackageCommand<T>(
    action: string,
    payload: Record<string, unknown>,
    preserveIntentOnFailure = false
  ) {
    setPackageActionError(undefined);
    setPackageActionPending(true);
    try {
      const result = preserveIntentOnFailure
        ? await packageCommandIntents.execute<T>(action, payload)
        : await operationsCommand<T>(action, payload);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('operations'),
      });
      return result;
    } catch (error) {
      setPackageActionError(
        await recoverContentPackageAction(error, () =>
          queryClient.invalidateQueries({
            queryKey: p1QueryKeys.request('operations', 'content_packages'),
          })
        )
      );
      return undefined;
    } finally {
      setPackageActionPending(false);
    }
  }

  async function editPackage(input: ContentPackageEditInput) {
    if (!sourcePackage) return;
    await runPackageCommand(
      input.platform
        ? 'edit_content_package_variant'
        : 'edit_content_package_version',
      {
        baseVersionId: input.baseVersionId,
        changes: input.changes,
        packageId: sourcePackage.id,
        ...(input.platform ? { platform: input.platform } : {}),
      }
    );
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
          { label: m.product_navigation_content(), isCurrentPage: true },
        ]}
        actions={
          <Badge variant="outline">
            {m.dashboard_content_count({
              count: contentPackages.length,
            })}
          </Badge>
        }
      />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 bg-surface-0 p-4 lg:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {m.product_navigation_content()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {m.dashboard_content_description()}
          </p>
          <div className="mt-3">
            <QuotaMeter entitlement={state.entitlement} />
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{m.product_client_command_failed()}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              {m.content_operation_failed_description()}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                <IconRefresh />
                {m.account_usage_retry()}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {sourceContentId && !sourceContent ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {m.dashboard_content_source_content_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {m.dashboard_content_source_content_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {sourceHandoffId && !sourceHandoff ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {m.dashboard_content_source_handoff_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {m.dashboard_content_source_handoff_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {requestedPackageId && !sourcePackage ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {m.dashboard_content_source_content_missing_title()}
            </AlertTitle>
            <AlertDescription>
              {m.dashboard_content_source_content_missing_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        {contentPackagesQuery.isError ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{m.product_client_state_failed()}</AlertTitle>
            <AlertDescription>
              {contentPackagesQuery.error.message}
            </AlertDescription>
          </Alert>
        ) : null}

        {packageActionError ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>
              {packageActionError === 'version_conflict'
                ? m.content_package_version_conflict_description()
                : m.content_package_action_failed()}
            </AlertTitle>
            {packageActionError === 'generic' ? (
              <AlertDescription>
                {m.content_package_action_failed_description()}
              </AlertDescription>
            ) : null}
          </Alert>
        ) : null}

        {sourcePackage ? (
          <ContentPackageDetail
            contentPackage={sourcePackage}
            lineage={lineageQuery.data}
            media={canonicalMediaForAssetIds(
              creativeQuery.data?.assets ?? [],
              state.assets,
              sourcePackage.versions.find(
                (version) => version.id === sourcePackage.currentVersionId
              )?.orderedAssetIds ?? sourcePackage.generated.assetIds
            )}
            onEdit={(input) => void editPackage(input)}
            onExport={(platform) => {
              const variant = sourcePackage.variants.find(
                (item) => item.platform === platform
              );
              if (!variant) return;
              void runPackageCommand(
                'export_content_package',
                {
                  packageId: sourcePackage.id,
                  platform,
                },
                true
              );
            }}
            onGenerateVariants={() => {
              if (
                !variantModel?.unitPrice ||
                !variantCatalogQuery.data?.revisionId ||
                variantQuote.estimatedAmount === undefined ||
                !variantQuote.currency ||
                !variantQuote.priceRevision
              ) {
                setPackageActionError('generic');
                return;
              }
              const quoteAcceptedAt = new Date().toISOString();
              void runPackageCommand('generate_content_package_variants', {
                contract: {
                  aigcLabelEnabled: sourcePackage.compliance.aigcLabelEnabled,
                  catalogModelId: variantModel.id,
                  catalogRevision: variantCatalogQuery.data.revisionId,
                  currency: variantQuote.currency,
                  dataClass: [],
                  estimatedAmount: variantQuote.estimatedAmount,
                  operation: 'copy.adapt',
                  outputCount: 3,
                  outputLabel: m.content_package_variant_output_label(),
                  quoteAcceptedAt,
                  quoteRevision: creativeQuoteRevision({
                    aspectRatio: '3:4',
                    catalogModelId: variantModel.id,
                    catalogRevision: variantCatalogQuery.data.revisionId,
                    operation: 'copy.adapt',
                    priceRevision: variantQuote.priceRevision,
                  }),
                  watermarkEnabled: sourcePackage.compliance.watermarkEnabled,
                },
                packageId: sourcePackage.id,
                submissionKey: `content-package-variants:${sourcePackage.id}:${sourcePackage.currentVersionId}:${quoteAcceptedAt}`,
              });
            }}
            onOpenPackage={openPackage}
            onRetryVariantCatalog={() => {
              void variantCatalogQuery.refetch();
            }}
            onReuse={() => {
              void runPackageCommand<ContentPackageProjection>(
                'reuse_content_package',
                { sourcePackageId: sourcePackage.id },
                true
              ).then((reused) => {
                if (reused) openPackage(reused.id);
              });
            }}
            onRollback={(targetVersionId) =>
              void runPackageCommand('rollback_content_package_version', {
                packageId: sourcePackage.id,
                targetVersionId,
              })
            }
            pending={packageActionPending}
            variantQuoteLabel={variantQuoteLabel}
            variantCatalogState={
              variantCatalogQuery.isPending
                ? 'loading'
                : variantQuoteLabel
                  ? undefined
                  : 'unavailable'
            }
          />
        ) : null}

        {contentPackages.length === 0 ? (
          <WarmEmptyState
            action={
              <a
                className={buttonVariants()}
                href={getPathWithLocale(Routes.Dashboard)}
              >
                {m.content_library_empty_action()}
              </a>
            }
            description={m.content_library_empty_description()}
            media={<IconFileText />}
            title={m.content_library_empty_title()}
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
              {m.content_package_legacy_history({
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
                  {m.dashboard_content_handoff_title()}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {m.dashboard_content_handoff_summary({
                    platform: platformLabel(latestPackage.platform),
                    status:
                      latestPackage.status === 'ready'
                        ? m.dashboard_content_handoff_status_pending()
                        : m.dashboard_handoff_reported(),
                  })}
                </p>
              </div>
              <Badge
                variant={
                  latestPackage.status === 'published' ? 'default' : 'secondary'
                }
              >
                {latestPackage.status === 'published'
                  ? m.p1_filter_content_published()
                  : m.dashboard_content_handoff_ready()}
              </Badge>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="divide-y divide-divider">
                {[
                  [m.dashboard_handoff_field_title(), latestPackage.title],
                  [m.dashboard_handoff_field_body(), latestPackage.body],
                  [
                    m.dashboard_handoff_field_topics(),
                    latestPackage.topics.map((topic) => `#${topic}`).join(' '),
                  ],
                  [
                    m.dashboard_handoff_field_conversion(),
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
                        ? m.dashboard_content_copied()
                        : m.dashboard_handoff_copy()}
                    </Button>
                  </div>
                ))}
              </div>
              <aside className="space-y-4">
                <div className="mx-auto w-44 bg-white p-2">
                  <HandoffQr token={latestPackage.token} />
                  <p className="mt-1 text-center text-xs text-neutral-600">
                    {m.dashboard_content_scan_qr()}
                  </p>
                </div>
                <Card className="rounded-md bg-surface-1 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {m.dashboard_content_checklist_title()}
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
                  {m.dashboard_content_mobile_handoff()}
                  <IconExternalLink className="size-4" />
                </a>
                <Badge className="w-full justify-center" variant="outline">
                  {m.content_package_legacy_read_only()}
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
  pending,
  readOnly = false,
  run,
}: {
  highlightedId?: string;
  items: ContentItem[];
  migratedPackageIds?: ReadonlyMap<string, string>;
  pending: boolean;
  readOnly?: boolean;
  run: (command: ProductCommand) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md bg-surface-1 py-14 text-center">
        <IconFileText className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {m.dashboard_content_empty_title()}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.dashboard_content_empty_description()}
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
                  {m.creation_entry_platform_xiaohongshu()}
                </Badge>
                {douyin && (
                  <Badge variant="secondary">
                    <IconBrandTiktok className="size-3" />
                    {douyin.durationSeconds === undefined
                      ? m.creation_entry_platform_douyin()
                      : m.dashboard_content_platform_duration({
                          platform: m.creation_entry_platform_douyin(),
                          seconds: douyin.durationSeconds,
                        })}
                  </Badge>
                )}
                <Badge variant="outline" className="ml-auto">
                  {readOnly
                    ? m.content_package_legacy_read_only()
                    : content.status === 'published'
                      ? m.p1_filter_content_published()
                      : m.p1_filter_content_draft()}
                </Badge>
              </div>
              <CardTitle className="text-base leading-6">
                {version?.title}
              </CardTitle>
              <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                {version?.body}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {readOnly && migratedPackageId ? (
                <a
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  href={getPathWithLocale(
                    `/dashboard/content?packageId=${encodeURIComponent(migratedPackageId)}`
                  )}
                >
                  <IconExternalLink />
                  {m.content_package_legacy_view_migrated()}
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
                          {m.dashboard_content_duration_version({
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
                    {m.dashboard_content_remix()}
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
                    {m.dashboard_content_undo()}
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
                    {m.dashboard_content_revert_to_ai()}
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
                    {m.dashboard_content_create_weekly_set()}
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
            <div className="grid gap-4 lg:grid-cols-2">
              {groupedItems.map((contentPackage) => (
                <div
                  className={
                    contentPackage.id === highlightedId
                      ? 'rounded-md bg-surface-2 ring-2 ring-primary/30'
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
