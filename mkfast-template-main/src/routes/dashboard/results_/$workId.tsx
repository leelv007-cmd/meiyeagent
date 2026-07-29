/**
 * Result Center route — `/dashboard/results/$workId` (D-089 / WT-D1 / #99).
 *
 * New path-style object route. Does NOT expand the legacy `?workId=` bridge
 * on dashboard/index (C owner). Shareable search: contentId / versionId /
 * panel / focusKey only.
 */

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { resolveVideoWorkflowBinding } from '@/lib/video-workflow-binding';
import {
  commandP1,
  operationsCommand,
  operationsQuery,
  queryP1,
} from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  creativeJobObservation,
  useCreativeJobObserver,
} from '@/product/creative-job-observer';
import {
  buildLiveVideoWorksurface,
  buildNativeVideoWorksurface,
  contentPackageRefreshToken,
  factSourcesFromGroundingSnapshot,
  imageWorksurfaceFromContentPackage,
  revisionTimelineFactsFromContentPackage,
  latestContentPackageForWork,
  platformPreviewsFromContentPackage,
  projectResultCenterLiveProjection,
  resultAdjustSourceForResult,
  resultContentPackageMutationFacts,
  resultDeliveryAttemptState,
  resultDeriveSessionId,
  resultHarnessStreamLifecycle,
  resultWorkflowIdForWork,
  runDetailFactsFromLiveSelection,
} from '@/product/results/result-live-projection';
import {
  buildResultFullPackagePlan,
  probeCanShareFiles,
  sharePayloadFilesFromPlan,
} from '@/product/results/delivery-full-package-live';
import {
  buildQuickEditIntent,
  type QuickEditRequest,
} from '@/product/results/quick-edit-model';
import type { OutcomeObservationDetail } from '@/product/results/outcome-chips-panel';
import {
  result_adjust_unavailable,
  result_lineage_based_on,
} from '@/locale/paraglide/messages';
import { calibrateTerminalRevision } from '@/product/results/result-token-stream';
import { projectResultShellPhase } from '@/product/results/result-shell-model';
import { ResultCenterPage } from '@/product/results/result-center-page';
import { ImageAdjustConfirmation } from '@/product/results/image-adjust-confirmation';
import { createCanonicalAssistedHandoff } from '@/product/results/delivery-assisted-live';
import type { AssistedReceipt } from '@/product/results/delivery-b3-types';
import { buildCaptionText } from '@/product/results/delivery-full-package';
import { shareCanonicalHandoff } from '@/product/results/delivery-handoff-live';
import { projectResultCloseLoopFacts } from '@/product/results/result-close-loop-live';
import { weeklyReviewDerivePayload } from '@/product/results/weekly-review-model';
import { workLineageSourcePackageId } from '@/product/works/works-projection';
import {
  deliveryTargetForIntent,
  useDeliveryViewport,
} from '@/product/results/delivery-viewport';
import type {
  VideoCanonicalEditCommand,
  VideoRegenerationQuoteRequest,
  VideoRegenerationServerQuote,
} from '@/product/results/video/video-worksurface';
import { executeResultContentPackageHandEdit } from '@/product/results/result-content-package-hand-edit';
import {
  validateResultCenterSearch,
  type ResultCenterSearch,
} from '@/product/results/result-center-search';
import {
  parseResultReturnState,
  resultReturnDestination,
} from '@/product/results/result-return-navigation';
import { parseResultCenterSearch } from '@/product/results/result-target-wiring';
import { useResultReturnRestoreSession } from '@/product/results/use-result-return-restore-session';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';
import type {
  ContentPackageResultSignal,
  CreativeWorkbenchProjection,
  ProductQuoteSnapshot,
  PublicContentPackage,
  ResultAction,
  ResultAdjustCommand,
  ResultAdjustSource,
  ResultTargetResolveOutcome,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';
import { resultCenterPath } from '@meiye/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/** Merchant-facing platform names for the weekly 「换平台」 prefill. */
const WEEKLY_PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  video_account: '视频号',
  xiaohongshu: '小红书',
};

type PendingImageAdjust = {
  derivedTaskId: string;
  derivedWorkId: string;
  instruction: string;
  quote: ProductQuoteSnapshot;
  scope?: ResultAdjustCommand['scope'];
  source: ResultAdjustSource;
};

export type { ResultCenterSearch } from '@/product/results/result-center-search';

export const Route = createFileRoute('/dashboard/results_/$workId')({
  validateSearch: (search: Record<string, unknown>): ResultCenterSearch =>
    validateResultCenterSearch(search),
  component: ResultCenterRoutePage,
});

function ResultCenterRoutePage() {
  const { workId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const returnState = parseResultReturnState(search);
  const queryClient = useQueryClient();
  const intentKeys = useRef(new Map<string, string>());
  const [pendingImageAdjust, setPendingImageAdjust] =
    useState<PendingImageAdjust | null>(null);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | undefined>();
  const [shellActionBusy, setShellActionBusy] = useState(false);
  const [shellActionError, setShellActionError] = useState<
    string | undefined
  >();
  const [closeLoopPending, setCloseLoopPending] = useState(false);
  const [
    videoRegenerationPackageBaseline,
    setVideoRegenerationPackageBaseline,
  ] = useState<string | null | undefined>(undefined);
  const deliveryViewport = useDeliveryViewport();
  const target = parseResultCenterSearch(workId, search);
  const workbenchQueryKey = p1QueryKeys.request(
    'operations',
    'creative_workbench'
  );
  const contentPackagesQueryKey = p1QueryKeys.request(
    'operations',
    'content_packages'
  );
  const targetResolverQuery = useQuery({
    queryKey: p1QueryKeys.request('result-delivery', 'result_target_resolve', {
      target,
    }),
    queryFn: ({ signal }) =>
      queryP1<ResultTargetResolveOutcome>(
        'result-delivery',
        { action: 'result_target_resolve', payload: { target } },
        signal
      ),
    retry: false,
  });

  const workbenchQuery = useQuery({
    queryKey: workbenchQueryKey,
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: false,
  });

  const contentPackagesQuery = useQuery({
    queryKey: contentPackagesQueryKey,
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
    refetchInterval:
      videoRegenerationPackageBaseline === undefined ? false : 1_000,
  });
  // `content_packages` is ordered by updatedAt DESC. Its source binds Work and
  // Harness Task atomically, so canonical workId-only reopens reconnect without
  // trusting an optional URL taskId from another route or a stale browser link.
  const contentPackage = latestContentPackageForWork(
    contentPackagesQuery.data,
    workId
  );
  const resultWorkflowId = resultWorkflowIdForWork(
    contentPackagesQuery.data,
    workId
  );
  const harnessStream = useWorkflowEventStream({
    enabled: Boolean(resultWorkflowId),
    latestQueryKey: workbenchQueryKey,
    workflowId: resultWorkflowId,
    workflowQueryKey: contentPackagesQueryKey,
  });
  // W09: the three-tier ledger as core computes it. `inferred_temporal` is
  // derived per request and never stored on the package, so a page that reads
  // only `resultSignals` renders the third tier as an always-empty decoration.
  const resultsQuery = useQuery({
    enabled: Boolean(contentPackage?.id),
    queryKey: p1QueryKeys.request('operations', 'content_package_results', {
      packageId: contentPackage?.id,
    }),
    queryFn: ({ signal }) =>
      operationsQuery<{
        signals: {
          inferred: ContentPackageResultSignal[];
          merchant: ContentPackageResultSignal[];
          verified: ContentPackageResultSignal[];
        };
      }>('content_package_results', { packageId: contentPackage?.id }, signal),
    retry: false,
  });
  const assistedReceiptsQuery = useQuery({
    queryKey: p1QueryKeys.request('result-delivery', 'assisted_list'),
    queryFn: ({ signal: _signal }) =>
      queryP1<Array<{ receipt: AssistedReceipt; revision: number }>>(
        'result-delivery',
        { action: 'assisted_list', payload: {} }
      ),
    retry: false,
  });
  const live = workbenchQuery.data
    ? projectResultCenterLiveProjection(workbenchQuery.data, workId)
    : null;
  const selected = live?.selected ?? null;
  const adjustSource = resultAdjustSourceForResult({
    contentPackage,
    job: selected?.job,
    workId,
  });
  useCreativeJobObserver(creativeJobObservation(selected?.job ?? undefined));
  // Which canonical run this Work's video surface opens. The two write shapes
  // it has to reconcile — and why — live in `resolveVideoWorkflowBinding`,
  // where the three cases are covered by a test that runs.
  const selectedVideoWorkflowId =
    selected?.workspaceKind === 'video'
      ? resolveVideoWorkflowBinding(selected.job)
      : undefined;
  const workflowQuery = useQuery({
    enabled: Boolean(selectedVideoWorkflowId),
    queryKey: p1QueryKeys.request('model-supply', 'video_workflow_public', {
      workflowId: selectedVideoWorkflowId,
    }),
    queryFn: ({ signal }) =>
      queryP1<VideoWorkflowPublicProjection | null>(
        'model-supply',
        {
          action: 'video_workflow_public',
          payload: { workflowId: selectedVideoWorkflowId },
        },
        signal
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return !status ||
        status === 'draft' ||
        status === 'running' ||
        status === 'awaiting_quality_review' ||
        status === 'cancel_requested'
        ? 1_000
        : false;
    },
    retry: false,
  });
  const contentPackageToken = contentPackageRefreshToken(contentPackage);
  useEffect(() => {
    if (
      videoRegenerationPackageBaseline !== undefined &&
      contentPackageToken !== videoRegenerationPackageBaseline
    ) {
      setVideoRegenerationPackageBaseline(undefined);
    }
  }, [contentPackageToken, videoRegenerationPackageBaseline]);
  const currentPackageVersion = contentPackage?.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
  const packageMutationFacts =
    resultContentPackageMutationFacts(contentPackage);
  const outcome: ResultTargetResolveOutcome = targetResolverQuery.data ?? {
    kind: 'not_found',
    code: 'NOT_FOUND',
    message: 'Result target is still resolving.',
    requested: target,
  };
  const currentRevisionId = contentPackage
    ? (contentPackage.currentVersionId ??
      `${contentPackage.id}:r${contentPackage.revision}`)
    : selected?.job?.id;
  const returnRestore = useResultReturnRestoreSession({
    workId,
    resolveOutcome: outcome,
    currentRevisionId,
  });

  if (
    targetResolverQuery.isPending ||
    workbenchQuery.isPending ||
    contentPackagesQuery.isPending
  ) {
    return (
      <DashboardLayout
        breadcrumbs={[]}
        description="正在读取作品"
        title="结果中心"
      >
        <StatePanel
          kind="loading"
          title="正在读取结果…"
          description="正在读取当前作品、任务和资产。"
        />
      </DashboardLayout>
    );
  }

  if (
    targetResolverQuery.isError ||
    workbenchQuery.isError ||
    contentPackagesQuery.isError ||
    !live
  ) {
    return (
      <DashboardLayout
        breadcrumbs={[]}
        description="结果读取失败"
        title="结果中心"
      >
        <StatePanel
          kind="error"
          title="暂时无法读取结果"
          description="请稍后重试。"
        />
      </DashboardLayout>
    );
  }

  if (
    selected?.workspaceKind === 'video' &&
    selectedVideoWorkflowId &&
    workflowQuery.isPending
  ) {
    return (
      <DashboardLayout
        breadcrumbs={[]}
        description="正在读取视频工作流"
        title="结果中心"
      >
        <StatePanel
          kind="loading"
          title="正在读取视频结果…"
          description="正在读取分镜、成片和采用状态。"
        />
      </DashboardLayout>
    );
  }

  // Soft-degrade: keep Result Center shell usable when video_workflow_public is
  // missing or fails (fixture jobs may complete without a durable workflow id).
  // Video worksurface simply omits workflow-derived panels instead of hard-failing.

  const workspaceKind = selected?.workspaceKind ?? 'copy';
  const harnessStreamMatchesResult =
    Boolean(resultWorkflowId) &&
    harnessStream.activeWorkflowId === resultWorkflowId;
  const harnessWorkflowState = harnessStreamMatchesResult
    ? harnessStream.workflowState
    : undefined;
  const harnessProgressState = harnessStreamMatchesResult
    ? harnessStream.latestProgress?.state
    : undefined;
  const harnessStreamLifecycle = resultHarnessStreamLifecycle({
    hasCanonicalVersion: Boolean(currentPackageVersion),
    latestProgressState: harnessProgressState,
    projectedProgressState: selected?.progressState,
    workflowState: harnessWorkflowState,
  });
  const resultProgressState = harnessStreamLifecycle.progressState;
  // D-118: lightweight copy stays inside the shared Harness workflow. Its
  // workflow.token projection is the only user-visible incremental source.
  // image.generate / video never feed incremental copy slots — do not mark them
  // streamActive or e2e will wait forever for tokens that cannot arrive.
  const streamActive =
    workspaceKind === 'copy' &&
    harnessStreamLifecycle.streamActive &&
    (!selected?.job || selected.job.contract.operation === 'copy.generate');
  const partialCandidates =
    streamActive && harnessStreamMatchesResult
      ? harnessStream.copyCandidates
      : undefined;
  const streamLoading = streamActive && harnessStreamMatchesResult;
  const deliveryTarget = deliveryTargetForIntent(
    workspaceKind,
    selected?.work.intent ?? ''
  );
  const canonicalDeliveryPlatform =
    deliveryTarget === 'wechat_moments' ? null : deliveryTarget;
  const baseVideoWorksurface = selected
    ? (buildLiveVideoWorksurface(selected, workflowQuery.data) ??
      buildNativeVideoWorksurface(selected, contentPackage))
    : undefined;
  const packageComposedAsset = contentPackage?.generated.ownedAssets
    ?.filter((asset) => asset.contentType === 'video/mp4')
    .at(-1);
  const packageBackedVideoWorksurface =
    baseVideoWorksurface && packageComposedAsset
      ? {
          ...baseVideoWorksurface,
          composedCandidate: {
            assetId: packageComposedAsset.id,
            durationSeconds:
              baseVideoWorksurface.composedCandidate?.durationSeconds ?? 0,
            playableUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(packageComposedAsset.objectKey)}`,
          },
        }
      : baseVideoWorksurface;
  const videoWorksurface =
    packageBackedVideoWorksurface &&
    contentPackage?.status === 'accepted' &&
    currentPackageVersion
      ? {
          ...packageBackedVideoWorksurface,
          adoption: {
            adoptedAt: contentPackage.updatedAt,
            composedAssetId: currentPackageVersion.orderedAssetIds[0] ?? null,
            contentPackageId: contentPackage.id,
            contentRevision: contentPackage.revision,
            status: 'adopted' as const,
          },
          baseRevisionId: currentPackageVersion.id,
          contentId: contentPackage.id,
          loopPhase: 'adopted' as const,
          versionId: currentPackageVersion.id,
        }
      : packageBackedVideoWorksurface;
  // Terminal ContentPackage revision wins over intermediate stream text (P1-B2).
  const terminalCalibration =
    currentPackageVersion &&
    (workspaceKind === 'copy' || workspaceKind === 'image')
      ? calibrateTerminalRevision({
          streamed: partialCandidates?.[0],
          terminal: {
            title: currentPackageVersion.title,
            body: currentPackageVersion.body,
            conversionHook: currentPackageVersion.conversionHook ?? '',
            revisionId: currentPackageVersion.id,
          },
        })
      : null;
  const copyWorksurface =
    selected?.copyWorksurface && currentPackageVersion
      ? {
          ...selected.copyWorksurface,
          baseRevisionId: currentPackageVersion.id,
          document: {
            body: terminalCalibration?.body ?? currentPackageVersion.body,
            conversionHook:
              terminalCalibration?.conversionHook ??
              currentPackageVersion.conversionHook ??
              '',
            orderedAssetIds: [...currentPackageVersion.orderedAssetIds],
            title: terminalCalibration?.title ?? currentPackageVersion.title,
            topics: [...currentPackageVersion.topics],
          },
          lifecycle: 'adopted' as const,
          platformPreviews: platformPreviewsFromContentPackage(contentPackage),
        }
      : (selected?.copyWorksurface ??
        (currentPackageVersion && contentPackage
          ? {
              workId,
              baseRevisionId: currentPackageVersion.id,
              document: {
                body: currentPackageVersion.body,
                conversionHook: currentPackageVersion.conversionHook ?? '',
                orderedAssetIds: [...currentPackageVersion.orderedAssetIds],
                title: currentPackageVersion.title,
                topics: [...currentPackageVersion.topics],
              },
              alternativeCandidates: contentPackage.versions
                .filter((version) => version.id !== currentPackageVersion.id)
                .map((version) => ({
                  body: version.body,
                  candidateId: version.id,
                  conversionHook: version.conversionHook ?? '',
                  title: version.title,
                  topics: [...version.topics],
                })),
              lifecycle:
                contentPackage.status === 'accepted'
                  ? ('adopted' as const)
                  : ('candidate' as const),
              platformPreviews:
                platformPreviewsFromContentPackage(contentPackage),
            }
          : undefined));
  const imageWorksurface =
    selected?.imageWorksurface && currentPackageVersion
      ? {
          ...selected.imageWorksurface,
          adoptedOrderedAssetIds: [...currentPackageVersion.orderedAssetIds],
          baseRevisionId: currentPackageVersion.id,
          hasContentPackage: true,
          lifecycle: 'adopted' as const,
        }
      : (selected?.imageWorksurface ??
        (currentPackageVersion && contentPackage
          ? imageWorksurfaceFromContentPackage({
              adopted: contentPackage.status === 'accepted',
              generated: contentPackage.generated,
              version: currentPackageVersion,
              workId,
            })
          : undefined));

  const executeIntent = async <T,>(
    fingerprint: string,
    action:
      | 'result_adjust'
      | 'result_adjust_prepare'
      | 'result_adopt'
      | 'result_export',
    payload: Record<string, unknown>
  ) => {
    const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
    intentKeys.current.set(fingerprint, key);
    const result = await commandP1<T>(
      'result-delivery',
      { action, payload },
      key
    );
    intentKeys.current.delete(fingerprint);
    return result;
  };
  const refreshCanonicalResult = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'content_packages'),
      }),
      // The three-tier ledger is computed per request, so a newly recorded
      // signal only reaches the inferred tier when this is refetched too.
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'content_package_results', {
          packageId: contentPackage?.id,
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('result-delivery', 'assisted_list'),
      }),
    ]);
  };
  const refreshCanonicalVideo = async () => {
    await Promise.all([
      refreshCanonicalResult(),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('model-supply', 'video_workflow_public', {
          workflowId: selectedVideoWorkflowId,
        }),
      }),
    ]);
  };
  const adopt = async (selection: Record<string, unknown>) => {
    const expectedRevision = contentPackage?.revision ?? 0;
    const adopted = await executeIntent<PublicContentPackage>(
      `adopt:${workId}:${expectedRevision}:${JSON.stringify(selection)}`,
      'result_adopt',
      { expectedRevision, selection, workId }
    );
    await refreshCanonicalResult();
    return adopted;
  };
  const generateCopyPlatformVariants = async (
    packageToAdapt: PublicContentPackage | undefined = contentPackage
  ) => {
    if (
      !packageToAdapt ||
      !selected?.job ||
      selected.job.contract.operation !== 'copy.generate'
    ) {
      throw new Error('当前结果暂不支持生成正式平台版本。');
    }
    const submissionKey = crypto.randomUUID();
    const billingTaskId = `content-package-variants:${packageToAdapt.id}:${submissionKey}`;
    const quoteId = `content-package-variants:${packageToAdapt.id}:${packageToAdapt.revision}:${submissionKey}`;
    const quote = await commandP1<ProductQuoteSnapshot>(
      'product-billing',
      {
        action: 'quote',
        payload: {
          catalogModelId: selected.job.contract.catalogModelId,
          operation: 'copy.adapt',
          quantity: 3,
          quoteId,
        },
      },
      `content-package-variants-quote:${quoteId}`
    );
    const confirmedQuote = await commandP1<ProductQuoteSnapshot>(
      'product-billing',
      {
        action: 'confirm',
        payload: {
          quoteId: quote.quoteId,
          taskId: billingTaskId,
        },
      },
      `content-package-variants-confirm:${quote.quoteId}:${billingTaskId}`
    );
    await commandP1(
      'operations',
      {
        action: 'generate_content_package_variants',
        payload: {
          billingQuoteId: confirmedQuote.quoteId,
          billingTaskId,
          contract: {
            ...selected.job.contract,
            aigcLabelEnabled: selected.job.contract.aigcLabelEnabled,
            catalogModelId: confirmedQuote.catalogModelId,
            catalogRevision:
              confirmedQuote.catalogModelRevision ??
              selected.job.contract.catalogRevision,
            currency: confirmedQuote.formula.currency ?? 'CNY',
            estimatedAmount: confirmedQuote.confirmedAmount ?? 0,
            operation: 'copy.adapt',
            outputCount: confirmedQuote.outputCount ?? 3,
            outputLabel: confirmedQuote.outputLabel ?? '三平台版本',
            quoteAcceptedAt:
              confirmedQuote.confirmedAt ?? new Date().toISOString(),
            quoteRevision: confirmedQuote.revision,
            watermarkEnabled: selected.job.contract.watermarkEnabled,
          },
          expectedRevision: packageToAdapt.revision,
          packageId: packageToAdapt.id,
          submissionKey,
        },
      },
      `content-package-variants:${packageToAdapt.id}:${submissionKey}`
    );
    await refreshCanonicalResult();
  };
  const copyAsset = selected?.assets.find(
    (asset) =>
      asset.kind === 'text' &&
      (asset.id === selected.job?.recommendedAssetId ||
        !selected.job?.recommendedAssetId)
  );
  const downloadableAsset = selected?.assets.find((asset) => asset.objectKey);
  const downloadableObjectKey =
    downloadableAsset?.objectKey ??
    contentPackage?.generated.ownedAssets?.[0]?.objectKey;
  const singleDownloadUrl = downloadableObjectKey
    ? `/api/core/p1/assets?objectKey=${encodeURIComponent(downloadableObjectKey)}&download=1`
    : undefined;
  const startDownload = (url: string, fileName?: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName ?? '';
    anchor.click();
  };
  const downloadCopyAsset = () => {
    if (!copyAsset?.body) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          [copyAsset.title, copyAsset.body, copyAsset.conversionHook]
            .filter(Boolean)
            .join('\n\n'),
        ],
        { type: 'text/plain;charset=utf-8' }
      )
    );
    startDownload(url, `${contentPackage?.id ?? workId}-copy.txt`);
    URL.revokeObjectURL(url);
  };
  const imageAssetIds =
    selected?.assets
      .filter((asset) => asset.kind === 'image')
      .map(({ id }) => id) ?? [];
  const canExportFullPackage = Boolean(
    contentPackage &&
      canonicalDeliveryPlatform &&
      ['accepted', 'export_failed'].includes(contentPackage.status) &&
      contentPackage.variants.some(
        (variant) => variant.platform === canonicalDeliveryPlatform
      )
  );
  const deliveryVariant = canonicalDeliveryPlatform
    ? contentPackage?.variants.find(
        ({ platform }) => platform === canonicalDeliveryPlatform
      )
    : undefined;
  const activeDeliveryApproval = contentPackage?.approvalReceipts?.find(
    (approval) =>
      approval.status === 'approved' &&
      approval.binding.platform === canonicalDeliveryPlatform &&
      approval.binding.variantVersionId === deliveryVariant?.currentVersionId
  );
  const assistedStored = assistedReceiptsQuery.data?.find(
    ({ receipt }) =>
      receipt.packageId === contentPackage?.id &&
      receipt.binding?.platform === canonicalDeliveryPlatform &&
      receipt.binding.variantVersionId === deliveryVariant?.currentVersionId
  );
  const existingOneShotUrl = assistedStored?.receipt.handoffLink?.token
    ? `/dashboard/handoff/${encodeURIComponent(assistedStored.receipt.handoffLink.token)}`
    : undefined;
  // W09: the plan the delivery panel states before the download, and the file
  // list the share capability is probed against.
  const fullPackagePlan = contentPackage
    ? buildResultFullPackagePlan({
        contentPackage,
        nowIso: new Date().toISOString(),
        // The ZIP core actually emits names itself; the page has no store name
        // to offer here, so it states a neutral one rather than guessing from
        // the content title and printing a file name that is not the file name.
        storeName: '门店',
        target: deliveryTarget,
        ...(deliveryVariant?.currentVersionId
          ? { variantVersionId: deliveryVariant.currentVersionId }
          : {}),
      })
    : undefined;
  const sharePayloadFiles = sharePayloadFilesFromPlan(fullPackagePlan);
  const canShareFiles = probeCanShareFiles(sharePayloadFiles);
  const closeLoopFacts = contentPackage
    ? projectResultCloseLoopFacts({
        contentPackage,
        contentPackages: contentPackagesQuery.data ?? [],
        assistedReceipts:
          assistedReceiptsQuery.data?.map(({ receipt }) => receipt) ?? [],
        canShareFiles,
        hasDownload: Boolean(
          singleDownloadUrl ||
            canExportFullPackage ||
            (deliveryTarget === 'wechat_moments' && copyAsset)
        ),
        inferredSignals: resultsQuery.data?.signals.inferred ?? [],
        nowIso: new Date().toISOString(),
        preferredPlatform: deliveryTarget,
      })
    : undefined;
  const exactExportReceipt = contentPackage?.exportReceipts
    .filter(
      (receipt) =>
        receipt.status === 'succeeded' &&
        receipt.platform === canonicalDeliveryPlatform &&
        receipt.variantVersionId === deliveryVariant?.currentVersionId
    )
    .at(-1);
  const exactExportDownloadUrl = exactExportReceipt?.artifactObjectKey
    ? `/api/core/p1/assets?objectKey=${encodeURIComponent(exactExportReceipt.artifactObjectKey)}&download=1`
    : undefined;
  const exportCanonicalPackage = async () => {
    if (
      !contentPackage ||
      !canonicalDeliveryPlatform ||
      !canExportFullPackage
    ) {
      throw new Error('Canonical delivery package is unavailable.');
    }
    if (exactExportReceipt && exactExportDownloadUrl) {
      return {
        contentPackage,
        downloadUrl: exactExportDownloadUrl,
        receiptId: exactExportReceipt.id,
      };
    }
    return executeIntent<{
      contentPackage: PublicContentPackage;
      downloadUrl: string;
      receiptId: string;
    }>(
      `export:${contentPackage.id}:${contentPackage.revision}:${canonicalDeliveryPlatform}`,
      'result_export',
      {
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
        platform: canonicalDeliveryPlatform,
      }
    );
  };
  const ensureAssistedHandoff = async (responsibility: {
    ownerId?: string;
    responsibilityRole: 'self_publish' | 'external_owner';
  }) => {
    if (assistedStored?.receipt.handoffLink?.token) {
      if (!exactExportDownloadUrl) {
        throw new Error('Canonical assisted export is unavailable.');
      }
      return {
        downloadUrl: exactExportDownloadUrl,
        handoffToken: assistedStored.receipt.handoffLink.token,
        receipt: assistedStored.receipt,
        revision: assistedStored.revision,
      };
    }
    if (
      !contentPackage ||
      !canonicalDeliveryPlatform ||
      !activeDeliveryApproval
    ) {
      throw new Error('An active exact ApprovalReceipt is required.');
    }
    const created = await createCanonicalAssistedHandoff({
      exportPackage: exportCanonicalPackage,
      nowIso: new Date().toISOString(),
      packageId: contentPackage.id,
      platform: canonicalDeliveryPlatform,
      responsibility,
      submit: (action, payload) =>
        commandP1('result-delivery', { action, payload }),
    });
    await refreshCanonicalResult();
    return created;
  };
  /**
   * Adoption on the Harness seam: the merchant takes the candidate the package
   * already carries. Returns null when this result has no Harness selection —
   * a legacy Job-shaped run — and the visual adoption below owns it instead.
   */
  const adoptHarnessCandidate = async () => {
    const harnessCandidateId = currentPackageVersion?.harnessCandidateId;
    if (!contentPackage?.harnessSelection || !harnessCandidateId) return null;
    const adopted = await operationsCommand<PublicContentPackage>(
      'adopt_harness_candidate',
      {
        candidateId: harnessCandidateId,
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
      },
      `adopt-harness:${contentPackage.id}:${contentPackage.revision}:${harnessCandidateId}`
    );
    await refreshCanonicalResult();
    return adopted;
  };
  const adoptCopyCandidate = async () => {
    if (!copyAsset) return;
    const adopted =
      (await adoptHarnessCandidate()) ??
      (await adopt(
        imageAssetIds.length > 0
          ? {
              copyAssetId: copyAsset.id,
              kind: 'image_text',
              orderedAssetIds: imageAssetIds,
            }
          : { copyAssetId: copyAsset.id, kind: 'copy' }
      ));
    try {
      await generateCopyPlatformVariants(adopted);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '正式平台版本生成失败，请重试。';
      throw new Error(`已采用当前版本，但${message}`);
    }
  };
  const adoptCurrentCandidate = async () => {
    if (workspaceKind === 'copy') {
      await adoptCopyCandidate();
      return;
    }
    if (workspaceKind === 'image') {
      // 图文 runs come off the same Harness seam as 文案 and their pages are
      // ContentPackage owned assets, not the per-Job CreativeAssets
      // `adopt_visual_selection` validates against — sending those ids there
      // is a 409 (`INVALID_VISUAL_ASSET`) for every new-seam run, which is
      // where the 图文 mainline used to end. Take the candidate the package
      // carries, and leave visual adoption to the legacy runs that have it.
      if (await adoptHarnessCandidate()) return;
      if (imageAssetIds.length > 0) {
        await adopt({ kind: 'image', orderedAssetIds: imageAssetIds });
      }
      return;
    }
    if (workspaceKind === 'video') {
      await adoptComposedVideo();
    }
  };
  /**
   * 视频 adoption, from either control: the worksurface's 使用此成片 and the
   * shell's primary action both land here. A Harness package must record its
   * adopted candidate to become `accepted`
   * (`content-package-semantic-mutation-policy.ts`), so the visual command
   * alone is a 409 HARNESS_ADOPTION_EVIDENCE_REQUIRED for a new-seam run — the
   * same shape 图文 hit, one modality over.
   */
  const adoptComposedVideo = async () => {
    if (await adoptHarnessCandidate()) return;
    if (!videoWorksurface?.composedCandidate) return;
    await adopt({
      kind: 'video',
      videoAssetId: videoWorksurface.composedCandidate.assetId,
    });
  };
  const createFromCurrent = async () => {
    if (!selected) return;
    const derived = await commandP1<{ id: string }>(
      'operations',
      {
        action: 'derive_creative_work',
        payload: {
          // D-046: the derived Work confirms its Brief from the intent it
          // carries. `false` reads as 「先不确认」 and is in fact
          // BRIEF_CONTEXT_REQUIRED wherever the server Brief gate is on — the
          // re-creation was refused before it could record any lineage.
          autoConfirmBrief: true,
          intent: selected.work.intent,
          sessionId: resultDeriveSessionId(selected.work),
          // W08: carry the ContentPackage forward, not only the Work. Without
          // it the derived creation had no record of what it was based on and
          // 「基于 X 生成」 had nothing to read.
          sourceReferences: [
            { id: selected.work.id, kind: 'work' },
            ...(contentPackage
              ? [{ id: contentPackage.id, kind: 'content' as const }]
              : []),
          ],
          sourceWorkId: selected.work.id,
        },
      },
      crypto.randomUUID()
    );
    window.location.assign(resultCenterPath(derived.id));
  };
  const supportedActionIds: ResultAction['id'][] = [
    'adopt_candidate',
    'continue_adjust',
    'deliver',
    'leave_and_continue',
    'create_from_this',
    'retry',
    'cancel_run',
    'open_history',
    'open_run_detail',
    ...(selected?.job?.status === 'recoverable' ||
    selected?.job?.status === 'unknown'
      ? (['recover_or_verify', 'handle_current_issue'] as const)
      : []),
  ];
  const handleShellAction = async (action: ResultAction) => {
    switch (action.id) {
      case 'adopt_candidate':
        await adoptCurrentCandidate();
        return;
      case 'continue_adjust':
      case 'handle_current_issue':
        await navigate({
          search: (current) => ({ ...current, panel: 'adjust' }),
        });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLTextAreaElement>('#result-adjust-input')
            ?.focus();
        });
        return;
      case 'deliver':
        await navigate({
          search: (current) => ({ ...current, panel: 'delivery' }),
        });
        return;
      case 'open_history':
        await navigate({
          search: (current) => ({ ...current, panel: 'history' }),
        });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              '[data-testid="result-revision-timeline-panel"]'
            )
            ?.scrollIntoView({ block: 'nearest' });
        });
        return;
      case 'open_run_detail':
        await navigate({
          search: (current) => ({ ...current, panel: 'run' }),
        });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              '[data-testid="result-run-detail-panel"]'
            )
            ?.scrollIntoView({ block: 'nearest' });
        });
        return;
      case 'leave_and_continue':
        window.location.assign('/dashboard');
        return;
      case 'recover_or_verify':
        if (!selected?.job) return;
        await commandP1(
          'operations',
          {
            action: 'resume_creative_job',
            payload: { jobId: selected.job.id },
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
        return;
      case 'create_from_this': {
        await createFromCurrent();
        return;
      }
      case 'retry':
        if (!selected?.job) return;
        await commandP1(
          'operations',
          {
            action: 'retry_creative_job',
            payload: {
              jobId: selected.job.id,
              submissionKey: crypto.randomUUID(),
            },
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
        return;
      case 'cancel_run':
        if (!selected?.job) return;
        await commandP1(
          'operations',
          {
            action: 'cancel_creative_job',
            payload: { jobId: selected.job.id },
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
        return;
      case 'open_more':
        return;
      default: {
        const _exhaustive: never = action.id;
        return _exhaustive;
      }
    }
  };

  const confirmImageAdjust = async () => {
    if (!pendingImageAdjust || adjustBusy) return;
    setAdjustBusy(true);
    setAdjustError(undefined);
    try {
      const result = await executeIntent<{ work: { id: string } }>(
        `adjust-confirm:${pendingImageAdjust.derivedWorkId}:${pendingImageAdjust.quote.quoteId}`,
        'result_adjust',
        {
          billingQuoteId: pendingImageAdjust.quote.quoteId,
          derivedTaskId: pendingImageAdjust.derivedTaskId,
          derivedWorkId: pendingImageAdjust.derivedWorkId,
          instruction: pendingImageAdjust.instruction,
          ...(pendingImageAdjust.scope
            ? { scope: pendingImageAdjust.scope }
            : {}),
          source: pendingImageAdjust.source,
        }
      );
      setPendingImageAdjust(null);
      window.requestAnimationFrame(() => {
        window.location.assign(resultCenterPath(result.work.id));
      });
    } catch {
      setAdjustError(
        '调整提交暂时不可用。费用以报价确认页和账单记录为准，请稍后重试。'
      );
    } finally {
      setAdjustBusy(false);
    }
  };

  // `selected.hasUsableCandidate` counts the per-Job CreativeAssets of the
  // legacy projection. A 图文 run's pages never become those, so a delivered
  // package offered no 采用 action at all and the shell fell through to
  // 「继续调整」. A current ContentPackage version is a usable candidate by
  // definition — the branch that reads this already requires nothing adopted.
  const hasUsableCandidate =
    selected?.hasUsableCandidate || Boolean(currentPackageVersion);
  // Scoped to the platform the page is currently acting on: 「小红书已发布、抖音
  // 失败」 is one package with two answers, and the merchant is standing on one
  // of them.
  const deliveryAttempt = resultDeliveryAttemptState(contentPackage, {
    platform: canonicalDeliveryPlatform,
    ...(deliveryVariant?.currentVersionId
      ? { variantVersionId: deliveryVariant.currentVersionId }
      : {}),
  });
  const shellPhase = projectResultShellPhase({
    target,
    workspaceKind,
    progressState: resultProgressState,
    hasUsableCandidate,
    deliveryAttempt,
    ...packageMutationFacts,
  });
  /**
   * W08: 「基于 X 生成」. Read through both lineage writers — the canonical
   * `source.sourceContentPackage` only exists on the Composer path, and
   * 「基于此再创作」 parks the source package on the derived Work instead, which
   * is why the label never appeared on the one flow that creates lineage.
   * Same predicate as 作品面, so the two surfaces cannot disagree.
   */
  const lineageSourceId = workLineageSourcePackageId({
    contentPackage,
    ...(selected?.work ? { work: selected.work } : {}),
  });
  const lineagePackage = lineageSourceId
    ? contentPackagesQuery.data?.find(
        (candidate) => candidate.id === lineageSourceId
      )
    : undefined;
  const basedOnLabel = lineageSourceId
    ? result_lineage_based_on({
        title:
          lineagePackage?.versions.find(
            (version) => version.id === lineagePackage.currentVersionId
          )?.title ?? '上一条内容',
      })
    : undefined;
  const revisionTimelineFacts =
    revisionTimelineFactsFromContentPackage(contentPackage);
  const runDetailFacts = runDetailFactsFromLiveSelection({
    workId,
    phase: shellPhase,
    progressState: resultProgressState,
    job: selected?.job ?? null,
    workspaceKind,
  });
  const shellFactSources = selected
    ? factSourcesFromGroundingSnapshot(selected.work, selected.job, {
        contentPackageRights: contentPackage?.rights,
        referencedAssetIds: currentPackageVersion?.orderedAssetIds,
      })
    : contentPackage?.rights
      ? factSourcesFromGroundingSnapshot(
          {
            id: workId,
            workspaceId: contentPackage.workspaceId,
            sessionId: '',
            intent: '',
            mode: 'agent',
            sourceReferences: [],
            status: 'completed',
            createdAt: contentPackage.createdAt,
            updatedAt: contentPackage.updatedAt,
          },
          null,
          { contentPackageRights: contentPackage.rights }
        )
      : [];

  return (
    <ResultCenterPage
      workId={workId}
      resolveOutcome={outcome}
      facts={{
        target,
        workspaceKind,
        requestedPanel: search.panel,
        progressState: resultProgressState,
        hasUsableCandidate,
        deliveryAttempt,
        ...packageMutationFacts,
        taskId: resultWorkflowId || undefined,
        jobId: selected?.job?.id,
      }}
      {...(basedOnLabel ? { basedOnLabel } : {})}
      {...(currentPackageVersion?.exportUseDelivery
        ? { exportUseDelivery: currentPackageVersion.exportUseDelivery }
        : {})}
      partialCandidates={partialCandidates}
      streamLoading={streamLoading}
      copyWorksurface={copyWorksurface}
      imageWorksurface={imageWorksurface}
      videoWorksurface={videoWorksurface}
      restoreStore={returnRestore.store}
      currentRevisionId={currentRevisionId}
      revisionTimelineFacts={revisionTimelineFacts}
      runDetailFacts={runDetailFacts}
      shellFactSources={shellFactSources}
      revisionRestoreBusy={shellActionBusy}
      onRestoreRevisionVersion={async (versionId) => {
        if (!contentPackage) {
          throw new Error('当前还没有可恢复的内容版本。');
        }
        await operationsCommand(
          'rollback_content_package_version',
          {
            packageId: contentPackage.id,
            targetVersionId: versionId,
            expectedRevision: contentPackage.revision,
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
        await navigate({
          search: (current) => ({ ...current, panel: 'history' }),
        });
      }}
      actionBusy={shellActionBusy}
      actionError={shellActionError}
      supportedActionIds={supportedActionIds}
      adjustConfirmation={
        pendingImageAdjust ? (
          <ImageAdjustConfirmation
            busy={adjustBusy}
            error={adjustError}
            instruction={pendingImageAdjust.instruction}
            onCancel={() => {
              setPendingImageAdjust(null);
              setAdjustError(undefined);
            }}
            onConfirm={() => void confirmImageAdjust()}
            quote={pendingImageAdjust.quote}
            scope={pendingImageAdjust.scope}
          />
        ) : adjustError ? (
          <p className="text-sm text-destructive" role="alert">
            {adjustError}
          </p>
        ) : undefined
      }
      onAction={(action) => {
        if (shellActionBusy) return;
        setShellActionBusy(true);
        setShellActionError(undefined);
        void handleShellAction(action)
          .catch((error) => {
            setShellActionError(
              error instanceof Error ? error.message : '操作失败，请重试。'
            );
          })
          .finally(() => {
            setShellActionBusy(false);
          });
      }}
      onBack={() => {
        // 旧任务收件箱下线后，返回只有工作台一个落点（T34 / #228）。
        const destination = resultReturnDestination(
          returnState ?? { kind: 'dashboard' }
        );
        void navigate({ to: destination.to, search: destination.search });
      }}
      onDriftChoice={(choice) => returnRestore.applyDriftChoice(choice)}
      onCopyAdopt={copyAsset ? adoptCopyCandidate : undefined}
      onCopyGeneratePlatformVariants={() => generateCopyPlatformVariants()}
      onCopyHandEdit={
        contentPackage?.currentVersionId
          ? async (changes) => {
              const fingerprint = `hand-edit:${contentPackage.id}:${contentPackage.revision}:${JSON.stringify(changes)}`;
              const key =
                intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
              intentKeys.current.set(fingerprint, key);
              await executeResultContentPackageHandEdit({
                contentPackage,
                changes,
                idempotencyKey: key,
              });
              intentKeys.current.delete(fingerprint);
              await refreshCanonicalResult();
            }
          : undefined
      }
      onCopySelectionRewrite={() => {
        // The chips only capture an anchor and preview a diff; the write is
        // 就用这版 → onCopyQuickEdit. Clearing the shell error here keeps a
        // stale failure from sitting above a fresh preview.
        setShellActionError(undefined);
      }}
      onCopyQuickEdit={
        contentPackage && currentPackageVersion
          ? async (request: QuickEditRequest) => {
              const fingerprint = `quick-edit:${contentPackage.id}:${contentPackage.revision}:${request.action}:${request.instruction}`;
              const key =
                intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
              intentKeys.current.set(fingerprint, key);
              await operationsCommand<PublicContentPackage>(
                'edit_content_package_version',
                {
                  baseVersionId: currentPackageVersion.id,
                  changes: {
                    body: request.changes.body,
                    conversionHook: request.changes.conversionHook,
                    orderedAssetIds: [...currentPackageVersion.orderedAssetIds],
                    title: request.changes.title,
                    topics: [...currentPackageVersion.topics],
                  },
                  expectedRevision: contentPackage.revision,
                  intent: buildQuickEditIntent({
                    action: request.action,
                    baseVersionId: currentPackageVersion.id,
                    contentPackage,
                    instruction: request.instruction,
                  }),
                  packageId: contentPackage.id,
                },
                key
              );
              intentKeys.current.delete(fingerprint);
              await refreshCanonicalResult();
            }
          : undefined
      }
      {...(adjustSource
        ? {}
        : { adjustUnavailableReason: result_adjust_unavailable() })}
      onImageAdopt={async (_actionKind, orderedAssetIds) => {
        await adopt({ kind: 'image', orderedAssetIds });
      }}
      onImageSaveDraft={async (selection) => {
        await commandP1(
          'operations',
          {
            action: 'save_creative_work_selection_draft',
            payload: {
              workId,
              baseRevisionId: selection.baseRevisionId,
              orderedAssetIds: selection.orderedAssetIds,
              coverAssetId: selection.coverAssetId,
              surfaceVersion: selection.surfaceVersion,
            },
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
      }}
      onImageSaveLibrary={async (_kind, assetIds) => {
        await commandP1(
          'operations',
          {
            action: 'save_creative_assets_to_library',
            payload: { workId, assetIds },
          },
          crypto.randomUUID()
        );
        await refreshCanonicalResult();
      }}
      onImageCreateFromThis={createFromCurrent}
      onAdjust={async (instruction, scope) => {
        if (!selected || !adjustSource || adjustBusy || pendingImageAdjust)
          return;
        setAdjustBusy(true);
        setAdjustError(undefined);
        try {
          const prepared = await executeIntent<{
            quoteIntent: {
              aspectRatio?: '1:1' | '3:4' | '9:16';
              catalogModelId: string;
              operation: 'copy.generate' | 'image.generate';
              quantity: number;
            };
            task: { id: string };
            work: { id: string };
          }>(
            `adjust-prepare:${workId}:${JSON.stringify(adjustSource)}:${selected.work.updatedAt}:${instruction}:${JSON.stringify(scope)}`,
            'result_adjust_prepare',
            {
              expectedWorkUpdatedAt: selected.work.updatedAt,
              instruction,
              ...(scope ? { scope } : {}),
              source: adjustSource,
              workId,
            }
          );
          const quoteId = crypto.randomUUID();
          const quote = await commandP1<ProductQuoteSnapshot>(
            'product-billing',
            {
              action: 'quote',
              payload: {
                ...(prepared.quoteIntent.aspectRatio
                  ? { aspectRatio: prepared.quoteIntent.aspectRatio }
                  : {}),
                catalogModelId: prepared.quoteIntent.catalogModelId,
                operation: prepared.quoteIntent.operation,
                quantity: prepared.quoteIntent.quantity,
                quoteId,
              },
            },
            quoteId
          );
          setPendingImageAdjust({
            derivedTaskId: prepared.task.id,
            derivedWorkId: prepared.work.id,
            instruction,
            quote,
            ...(scope ? { scope } : {}),
            source: adjustSource,
          });
        } catch {
          setAdjustError(
            '暂时无法确认本次调整费用。请稍后重试，重新确认前不会创建新的调整。'
          );
        } finally {
          setAdjustBusy(false);
        }
      }}
      onVideoAdopt={
        videoWorksurface?.composedCandidate ? adoptComposedVideo : undefined
      }
      onVideoDeliver={() =>
        navigate({
          search: (current) => ({ ...current, panel: 'delivery' }),
        })
      }
      onVideoRequestRegenerationQuote={
        selectedVideoWorkflowId
          ? async (request: VideoRegenerationQuoteRequest) => {
              const fingerprint = `video-regen-quote:${request.sourceRunId}:${request.scope}:${request.shotId ?? ''}`;
              const key =
                intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
              intentKeys.current.set(fingerprint, key);
              const quoted = await commandP1<VideoRegenerationServerQuote>(
                'video-regeneration',
                { action: 'quote', payload: request },
                key
              );
              intentKeys.current.delete(fingerprint);
              return quoted;
            }
          : undefined
      }
      onVideoConfirmRegeneration={
        selectedVideoWorkflowId
          ? async ({ quoteId, taskId }) => {
              const fingerprint = `video-regen-confirm:${quoteId}:${taskId}`;
              const key =
                intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
              intentKeys.current.set(fingerprint, key);
              setVideoRegenerationPackageBaseline(contentPackageToken);
              try {
                await commandP1(
                  'video-regeneration',
                  { action: 'confirm', payload: { quoteId, taskId } },
                  key
                );
              } catch (error) {
                setVideoRegenerationPackageBaseline(undefined);
                throw error;
              }
              intentKeys.current.delete(fingerprint);
              await refreshCanonicalVideo();
            }
          : undefined
      }
      onVideoCanonicalEdit={
        selectedVideoWorkflowId
          ? async (command: VideoCanonicalEditCommand) => {
              const fingerprint = `video-canonical-edit:${JSON.stringify(command)}`;
              const key =
                intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
              intentKeys.current.set(fingerprint, key);
              const { workflowId, expectedRevision, ...edit } = command;
              await commandP1(
                'model-supply',
                {
                  action: 'video_workflow_edit',
                  payload: { edit, expectedRevision, workflowId },
                },
                key
              );
              intentKeys.current.delete(fingerprint);
              await refreshCanonicalVideo();
            }
          : undefined
      }
      onVideoProStudio={() => {
        window.location.assign('/pro-studio');
      }}
      closeLoop={closeLoopFacts}
      closeLoopPending={closeLoopPending}
      onRecordManualPublication={async (input) => {
        if (!contentPackage || !closeLoopFacts?.variantVersionId) return;
        setCloseLoopPending(true);
        setShellActionError(undefined);
        try {
          await operationsCommand(
            'record_content_package_manual_result',
            {
              accountDisplayLabel: input.accountDisplayLabel,
              expectedRevision: contentPackage.revision,
              ...(input.note ? { note: input.note } : {}),
              packageId: contentPackage.id,
              platform: input.platform,
              ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
              publishedAt: input.publishedAt,
              status: input.status,
              variantVersionId: closeLoopFacts.variantVersionId,
            },
            input.idempotencyKey
          );
          await refreshCanonicalResult();
        } catch (error) {
          setShellActionError(
            error instanceof Error ? error.message : '发布记录暂时无法保存。'
          );
        } finally {
          setCloseLoopPending(false);
        }
      }}
      onRecordOutcomeObservation={async (
        kind,
        detail?: OutcomeObservationDetail
      ) => {
        if (!contentPackage) return;
        setCloseLoopPending(true);
        setShellActionError(undefined);
        try {
          await operationsCommand(
            'record_content_package_result_signal',
            {
              expectedRevision: contentPackage.revision,
              kind,
              ...(detail?.note ? { note: detail.note } : {}),
              ...(detail?.occurredAt ? { occurredAt: detail.occurredAt } : {}),
              packageId: contentPackage.id,
              ...(detail?.quantity !== undefined
                ? { quantity: detail.quantity }
                : {}),
            },
            crypto.randomUUID()
          );
          await refreshCanonicalResult();
        } catch (error) {
          setShellActionError(
            error instanceof Error ? error.message : '结果信号暂时无法保存。'
          );
        } finally {
          setCloseLoopPending(false);
        }
      }}
      onConfirmWeeklyRecommendation={async ({ packageId, action }) => {
        const sourcePackage = contentPackagesQuery.data?.find(
          (candidate) => candidate.id === packageId
        );
        if (!sourcePackage) return;
        setCloseLoopPending(true);
        setShellActionError(undefined);
        try {
          await operationsCommand(
            'record_content_package_result_review_action',
            {
              action,
              expectedRevision: sourcePackage.revision,
              packageId: sourcePackage.id,
            },
            crypto.randomUUID()
          );
          if (action === 'stop_series') {
            await refreshCanonicalResult();
            return;
          }
          const sourceWorkId = sourcePackage.source.workId;
          if (!sourceWorkId) {
            setShellActionError(
              '已记录下一轮方向，但该历史内容没有可复用的创作来源。'
            );
            await refreshCanonicalResult();
            return;
          }
          const currentVersion = sourcePackage.versions.find(
            (version) => version.id === sourcePackage.currentVersionId
          );
          const derived = await commandP1<{ id: string }>(
            'operations',
            {
              action: 'derive_creative_work',
              payload: weeklyReviewDerivePayload({
                action,
                sourcePackageId: sourcePackage.id,
                sourceWorkId,
                ...(currentVersion?.title
                  ? { title: currentVersion.title }
                  : {}),
                ...(currentVersion?.conversionHook
                  ? { ctaLabel: currentVersion.conversionHook }
                  : {}),
                ...(sourcePackage.variants[0]?.platform
                  ? {
                      platformLabel:
                        WEEKLY_PLATFORM_LABELS[
                          sourcePackage.variants[0].platform
                        ] ?? sourcePackage.variants[0].platform,
                    }
                  : {}),
              }),
            },
            crypto.randomUUID()
          );
          window.location.assign(resultCenterPath(derived.id));
        } catch (error) {
          setShellActionError(
            error instanceof Error
              ? error.message
              : '下一轮创作草稿暂时无法创建。'
          );
        } finally {
          setCloseLoopPending(false);
        }
      }}
      deliveryPanelFacts={{
        target: deliveryTarget,
        hasCopyableText: Boolean(copyAsset),
        hasSingleDownload: Boolean(singleDownloadUrl || copyAsset?.body),
        hasFullPackage:
          deliveryTarget === 'wechat_moments'
            ? Boolean(copyAsset || singleDownloadUrl)
            : canExportFullPackage,
        hasExternalSendApproval: Boolean(
          activeDeliveryApproval || assistedStored
        ),
        shareDevice: {
          hasNavigatorShare: typeof navigator.share === 'function',
          // D-086: the capability is the probe result against the actual
          // files, not the presence of the API.
          canShareFiles,
          canShareText: typeof navigator.share === 'function',
        },
        sharePayload: {
          kind: copyAsset ? (sharePayloadFiles ? 'mixed' : 'text') : 'files',
          ...(copyAsset?.body ? { text: copyAsset.body } : {}),
          ...(sharePayloadFiles ? { files: sharePayloadFiles } : {}),
          ...(existingOneShotUrl ? { oneShotLinkUrl: existingOneShotUrl } : {}),
          ...(singleDownloadUrl ? { downloadHref: singleDownloadUrl } : {}),
        },
        ...(fullPackagePlan ? { fullPackagePlan } : {}),
        ...(assistedStored ? { assistedReceipt: assistedStored.receipt } : {}),
        nowIso: new Date().toISOString(),
        viewport: deliveryViewport,
      }}
      viewport={deliveryViewport}
      onDeliveryAction={async (actionId, responsibility) => {
        if (actionId === 'copy' && copyAsset) {
          await navigator.clipboard.writeText(
            [copyAsset.title, copyAsset.body, copyAsset.conversionHook]
              .filter(Boolean)
              .join('\n\n')
          );
          return;
        }
        if (actionId === 'single_download' && singleDownloadUrl) {
          startDownload(singleDownloadUrl);
          return 'download_done';
        }
        if (actionId === 'single_download' && copyAsset?.body) {
          downloadCopyAsset();
          return 'download_done';
        }
        if (
          actionId === 'full_package' &&
          deliveryTarget === 'wechat_moments' &&
          contentPackage &&
          currentPackageVersion
        ) {
          const captionUrl = URL.createObjectURL(
            new Blob(
              [
                buildCaptionText({
                  body: currentPackageVersion.body,
                  ...(currentPackageVersion.conversionHook
                    ? {
                        conversionHook: currentPackageVersion.conversionHook,
                      }
                    : {}),
                  title: currentPackageVersion.title,
                  topics: currentPackageVersion.topics,
                }),
              ],
              { type: 'text/plain;charset=utf-8' }
            )
          );
          startDownload(captionUrl, `${contentPackage.id}-moments-caption.txt`);
          URL.revokeObjectURL(captionUrl);
          if (singleDownloadUrl) startDownload(singleDownloadUrl);
          return 'download_done';
        }
        if (
          actionId === 'full_package' &&
          contentPackage &&
          canExportFullPackage
        ) {
          const result = await exportCanonicalPackage();
          startDownload(`${result.downloadUrl}&download=1`);
          await refreshCanonicalResult();
          return 'download_done';
        }
        if (actionId === 'assisted') {
          await ensureAssistedHandoff(
            responsibility ?? { responsibilityRole: 'self_publish' }
          );
          return 'handed_over';
        }
        if (actionId === 'system_share') {
          const handoff = await ensureAssistedHandoff(
            responsibility ?? { responsibilityRole: 'self_publish' }
          );
          const shareResult = await shareCanonicalHandoff(
            {
              fullPackageDownloadUrl: handoff.downloadUrl,
              media: [
                {
                  contentType: 'application/zip',
                  downloadUrl: handoff.downloadUrl,
                  id: contentPackage?.id ?? 'delivery',
                  kind: 'file',
                  label: '完整发布包',
                },
              ],
              sharePath: `/dashboard/handoff/${encodeURIComponent(handoff.handoffToken)}`,
              title: '完整发布包',
            },
            {
              canShare: (payload) =>
                typeof navigator.canShare === 'function' &&
                navigator.canShare(payload),
              download: startDownload,
              fetchFile: async (media) => {
                const response = await fetch(media.downloadUrl, {
                  credentials: 'same-origin',
                });
                if (!response.ok) throw new Error('Delivery download failed.');
                return new File([await response.blob()], `${media.id}.zip`, {
                  type: media.contentType,
                });
              },
              origin: window.location.origin,
              ...(typeof navigator.share === 'function'
                ? { share: (payload) => navigator.share(payload) }
                : {}),
            }
          );
          if (shareResult === 'shared') return 'share_done';
          if (shareResult === 'downloaded') return 'download_done';
        }
      }}
    />
  );
}
