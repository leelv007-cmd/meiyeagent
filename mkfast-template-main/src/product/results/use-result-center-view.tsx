/**
 * Result Center view hook for `/dashboard/results/$workId` (D-089 / WT-D1 / #99).
 *
 * New path-style object route. Does NOT expand the legacy `?workId=` bridge
 * on dashboard/index (C owner). Shareable search: contentId / versionId /
 * panel / focusKey only.
 */

import { resolveVideoWorkflowBinding } from '@/lib/video-workflow-binding';
import { operationsCommand, operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  creativeJobObservation,
  useCreativeJobObserver,
} from '@/product/creative-job-observer';
import {
  factSourcesFromGroundingSnapshot,
  revisionTimelineFactsFromContentPackage,
  latestContentPackageForWork,
  projectResultCenterLiveProjection,
  resultAdjustSourceForResult,
  resultContentPackageMutationFacts,
  resultDeliveryAttemptState,
  resultDeriveSessionId,
  resultHarnessStreamLifecycle,
  resultWorkspaceKindForContentPackage,
  resultWorkflowIdForWork,
  runDetailFactsFromLiveSelection,
} from '@/product/results/result-live-projection';
import { adoptHarnessCandidateOnLatestRevision } from '@/product/results/adopt-harness-candidate';
import {
  buildResultCopyWorksurface,
  buildResultImageWorksurface,
  buildResultVideoWorksurface,
} from '@/product/results/result-worksurface-model';
import {
  type ResultCommandTransport,
  useResultCommands,
} from '@/product/results/use-result-commands';
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
import { projectResultShellPhase } from '@/product/results/result-shell-model';
import {
  ResultCenterPage,
  type ResultCenterPageProps,
} from '@/product/results/result-center-page';
import { buildAiCoverActionSeed } from '@/product/composer/ai-cover-action';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  projectExecutionConfirmCard,
  projectExecutionCost,
  projectExecutionParams,
  createExecutionConfirmState,
  openExecutionConfirm,
} from '@/product/composer/execution-confirm-card';
import { ExecutionConfirmCard } from '@/product/composer/execution-confirm-card-panel';
import { projectExecutionCostFeedback } from '@/product/composer/execution-cost-feedback';
import { ExecutionCostFeedbackLine } from '@/product/composer/execution-cost-feedback-line';
import type { ExecutionCostFeedback } from '@/product/composer/execution-cost-feedback';
import type { ComposerQuotaResource } from '@/product/composer/quota-blocking';
import { createCanonicalAssistedHandoff } from '@/product/results/delivery-assisted-live';
import {
  contentPackageExportEligibleStatus,
  buildCaptionText,
  resultTargetResolveOutcomeSchema,
} from '@meiye/contracts';
import type { AssistedReceipt } from '@/product/results/delivery-b3-types';
import { shareCanonicalHandoff } from '@/product/results/delivery-handoff-live';
import { projectResultCloseLoopFacts } from '@/product/results/result-close-loop-live';
import { resolveResultDeliveryBinding } from '@/product/results/result-delivery-binding';
import { weeklyReviewDerivePayload } from '@/product/results/weekly-review-model';
import { workLineageSourcePackageId } from '@/product/works/works-projection';
import {
  deliveryTargetForIntent,
  useDeliveryViewport,
} from '@/product/results/delivery-viewport';
import type { VideoCanonicalEditCommand } from '@/product/results/video/video-worksurface';
import { executeResultContentPackageHandEdit } from '@/product/results/result-content-package-hand-edit';
import type { ResultCenterSearch } from '@/product/results/result-center-search';
import { resultActionForRevision } from '@/product/results/result-action';
import {
  parseResultReturnState,
  resultReturnDestination,
} from '@/product/results/result-return-navigation';
import { parseResultCenterSearch as parseResultTargetSearch } from '@/product/results/result-target-wiring';
import { useResultReturnRestoreSession } from '@/product/results/use-result-return-restore-session';
import { usePublishHandoff } from '@/product/agent-workbench/publish-handoff/use-publish-handoff';
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
import type { UseNavigateResult } from '@tanstack/react-router';
import { useState } from 'react';

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
  /** Carried so the confirm card can state the run in merchant language. */
  aspectRatio?: string;
  quantity?: number;
};

export type ResultCenterViewState =
  | {
      status: 'loading';
      description: string;
      detail: string;
      title: string;
    }
  | { status: 'error' }
  | { status: 'ready'; view: ResultCenterPageProps };

export function useResultCenterView(
  workId: string,
  search: ResultCenterSearch,
  navigate: UseNavigateResult<'/dashboard/results/$workId'>,
  options: { commandTransport?: ResultCommandTransport } = {}
): ResultCenterViewState {
  const returnState = parseResultReturnState(search);
  const queryClient = useQueryClient();
  const commands = useResultCommands(options.commandTransport);
  const [pendingImageAdjust, setPendingImageAdjust] =
    useState<PendingImageAdjust | null>(null);
  // D-164⑥ 决定 B: backing out of a regeneration is an outcome too, and the
  // merchant is owed a straight answer about what it cost.
  const [adjustFeedback, setAdjustFeedback] =
    useState<ExecutionCostFeedback | null>(null);
  const [adjustError, setAdjustError] = useState<string | undefined>();
  const [shellActionError, setShellActionError] = useState<
    string | undefined
  >();
  const deliveryViewport = useDeliveryViewport();
  const target = parseResultTargetSearch(workId, search);
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
      queryP1(
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
      queryP1('result-delivery', { action: 'assisted_list', payload: {} }),
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
  const currentPackageVersion = contentPackage?.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
  const workspaceKind = resultWorkspaceKindForContentPackage({
    contentPackage,
    projectedWorkspaceKind: selected?.workspaceKind ?? 'copy',
  });
  const inferredDeliveryTarget = deliveryTargetForIntent(
    workspaceKind,
    selected?.work.intent ?? ''
  );
  const deliveryBinding = resolveResultDeliveryBinding(
    contentPackage,
    inferredDeliveryTarget
  );
  const canonicalDeliveryPlatform = deliveryBinding.canonicalPlatform;
  const deliveryPanelTarget = deliveryBinding.panelTarget;
  const deliveryVariant = deliveryBinding.variant;
  const resultEditPlatform = deliveryBinding.scopePlatform;
  const currentResultEditVersion = deliveryBinding.currentVersion;
  const resultEditVersions = resultEditPlatform
    ? (deliveryVariant?.versions ?? [])
    : (contentPackage?.versions ?? []);
  const packageMutationFacts =
    resultContentPackageMutationFacts(contentPackage);
  const parsedOutcome = resultTargetResolveOutcomeSchema.safeParse(
    targetResolverQuery.data
  );
  const outcome: ResultTargetResolveOutcome = parsedOutcome.success
    ? parsedOutcome.data
    : {
        kind: 'not_found',
        code: 'NOT_FOUND',
        message: 'Result target is still resolving.',
        requested: target,
      };
  const currentRevisionId = contentPackage
    ? (currentResultEditVersion?.id ??
      `${contentPackage.id}:r${contentPackage.revision}`)
    : selected?.job?.id;
  const returnRestore = useResultReturnRestoreSession({
    workId,
    resolveOutcome: outcome,
    currentRevisionId,
  });
  const selfReportHandoff = usePublishHandoff({
    phase: contentPackage ? 'delivered' : null,
    packageId: contentPackage?.id ?? null,
    workId,
    workspaceId: contentPackage?.workspaceId ?? null,
  });

  if (
    targetResolverQuery.isPending ||
    workbenchQuery.isPending ||
    contentPackagesQuery.isPending
  ) {
    return {
      status: 'loading',
      description: '正在读取作品',
      detail: '正在读取当前作品、任务和资产。',
      title: '正在读取结果…',
    };
  }

  if (
    targetResolverQuery.isError ||
    workbenchQuery.isError ||
    contentPackagesQuery.isError ||
    !live
  ) {
    return { status: 'error' };
  }

  if (
    selected?.workspaceKind === 'video' &&
    selectedVideoWorkflowId &&
    workflowQuery.isPending
  ) {
    return {
      status: 'loading',
      description: '正在读取视频工作流',
      detail: '正在读取分镜、成片和采用状态。',
      title: '正在读取视频结果…',
    };
  }

  // Soft-degrade: keep Result Center shell usable when video_workflow_public is
  // missing or fails (fixture jobs may complete without a durable workflow id).
  // Video worksurface simply omits workflow-derived panels instead of hard-failing.

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
  const videoWorksurface = buildResultVideoWorksurface({
    contentPackage,
    currentPackageVersion,
    selected,
    workflow: workflowQuery.data,
  });
  const copyWorksurface = buildResultCopyWorksurface({
    contentPackage,
    currentVersion: currentResultEditVersion,
    editVersions: resultEditVersions,
    partialCandidates,
    resultEditPlatform,
    selected,
    workId,
    workspaceKind,
  });
  const imageWorksurface = buildResultImageWorksurface({
    contentPackage,
    currentPackageVersion,
    selected,
    workId,
  });

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
    const adopted = await commands.adopt<PublicContentPackage>(
      `adopt:${workId}:${expectedRevision}:${JSON.stringify(selection)}`,
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
    const quote = await commands.execute<ProductQuoteSnapshot>(
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
    const confirmedQuote = await commands.execute<ProductQuoteSnapshot>(
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
    await commands.execute(
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
  const deliveryCopy = contentPackage ? currentResultEditVersion : copyAsset;
  const downloadableAsset = contentPackage
    ? deliveryBinding.orderedOwnedAssets[0]
    : selected?.assets.find((asset) => asset.objectKey);
  const downloadableObjectKey = downloadableAsset?.objectKey;
  const singleDownloadUrl = downloadableObjectKey
    ? `/api/core/p1/assets?objectKey=${encodeURIComponent(downloadableObjectKey)}&download=1`
    : undefined;
  const startDownload = (url: string, fileName?: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName ?? '';
    anchor.click();
  };
  const downloadDeliveryCopy = () => {
    if (!deliveryCopy?.body) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          [deliveryCopy.title, deliveryCopy.body, deliveryCopy.conversionHook]
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
      currentResultEditVersion &&
      contentPackageExportEligibleStatus(contentPackage.status) &&
      contentPackage.variants.some(
        (variant) => variant.platform === canonicalDeliveryPlatform
      )
  );
  const activeDeliveryApproval = contentPackage?.approvalReceipts?.find(
    (approval) =>
      approval.status === 'approved' &&
      approval.binding.platform === canonicalDeliveryPlatform &&
      approval.binding.variantVersionId === currentResultEditVersion?.id
  );
  const assistedReceipts = (assistedReceiptsQuery.data ?? []) as Array<{
    receipt: AssistedReceipt;
    revision: number;
  }>;
  const assistedStored = assistedReceipts.find(
    ({ receipt }) =>
      receipt.packageId === contentPackage?.id &&
      receipt.binding?.platform === canonicalDeliveryPlatform &&
      receipt.binding.variantVersionId === currentResultEditVersion?.id
  );
  const existingOneShotUrl = assistedStored?.receipt.handoffLink?.token
    ? `/dashboard/handoff/${encodeURIComponent(assistedStored.receipt.handoffLink.token)}`
    : undefined;
  // W09: the plan the delivery panel states before the download, and the file
  // list the share capability is probed against.
  const fullPackagePlan =
    contentPackage && deliveryPanelTarget && currentResultEditVersion
      ? buildResultFullPackagePlan({
          contentPackage,
          nowIso: new Date().toISOString(),
          // The ZIP core actually emits names itself; the page has no store name
          // to offer here, so it states a neutral one rather than guessing from
          // the content title and printing a file name that is not the file name.
          storeName: '门店',
          target: deliveryPanelTarget,
          variantVersionId: currentResultEditVersion.id,
        })
      : undefined;
  const sharePayloadFiles = sharePayloadFilesFromPlan(fullPackagePlan);
  const canShareFiles = probeCanShareFiles(sharePayloadFiles);
  const deliveryPanelFacts = deliveryPanelTarget
    ? {
        target: deliveryPanelTarget,
        hasCopyableText: Boolean(deliveryCopy),
        hasSingleDownload: Boolean(singleDownloadUrl || deliveryCopy?.body),
        hasFullPackage:
          deliveryPanelTarget === 'wechat_moments'
            ? Boolean(deliveryCopy || singleDownloadUrl)
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
          ...(sharePayloadFiles ? { files: sharePayloadFiles } : {}),
          ...(existingOneShotUrl ? { oneShotLinkUrl: existingOneShotUrl } : {}),
          ...(singleDownloadUrl ? { downloadHref: singleDownloadUrl } : {}),
        },
        ...(fullPackagePlan ? { fullPackagePlan } : {}),
        ...(assistedStored ? { assistedReceipt: assistedStored.receipt } : {}),
        nowIso: new Date().toISOString(),
        viewport: deliveryViewport,
      }
    : undefined;
  const closeLoopFacts = contentPackage
    ? projectResultCloseLoopFacts({
        contentPackage,
        contentPackages: contentPackagesQuery.data ?? [],
        assistedReceipts: assistedReceipts.map(({ receipt }) => receipt),
        canShareFiles,
        hasDownload: Boolean(
          singleDownloadUrl ||
            canExportFullPackage ||
            (deliveryPanelTarget === 'wechat_moments' && deliveryCopy)
        ),
        inferredSignals: resultsQuery.data?.signals.inferred ?? [],
        nowIso: new Date().toISOString(),
        preferredPlatform: deliveryPanelTarget
          ? canonicalDeliveryPlatform
          : null,
        allowExplicitVariantSelection:
          deliveryBinding.allowExplicitPublicationVariantSelection,
      })
    : undefined;
  const exactExportReceipt = contentPackage?.exportReceipts
    .filter(
      (receipt) =>
        receipt.status === 'succeeded' &&
        receipt.platform === canonicalDeliveryPlatform &&
        receipt.variantVersionId === currentResultEditVersion?.id
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
    if (!contentPackage.currentVersionId) {
      throw new Error('Canonical delivery package is unavailable.');
    }
    const plan = resultActionForRevision(
      {
        contentId: contentPackage.id,
        platform: canonicalDeliveryPlatform,
        revision: contentPackage.revision,
        versionId: contentPackage.currentVersionId,
        workId,
      },
      'export'
    );
    if (plan.write?.kind !== 'result_export') {
      throw new Error('Canonical delivery package is unavailable.');
    }
    return commands.exportResult<{
      contentPackage: PublicContentPackage;
      downloadUrl: string;
      receiptId: string;
    }>(plan.write.idempotencyKey, plan.write.payload);
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
        commands.execute('result-delivery', { action, payload }),
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
    const adopted = await adoptHarnessCandidateOnLatestRevision(
      { candidateId: harnessCandidateId, packageId: contentPackage.id },
      {
        command: (action, payload, idempotencyKey) =>
          operationsCommand<PublicContentPackage>(
            action,
            payload,
            idempotencyKey
          ),
        readPackage: (packageId) =>
          operationsQuery<PublicContentPackage>('content_package', {
            packageId,
          }),
        refresh: refreshCanonicalResult,
      }
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
    const derived = await commands.execute<{ id: string }>(
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
  const acceptanceUnknown =
    selected?.job?.status === 'recoverable' ||
    selected?.job?.status === 'unknown';
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
    ...(acceptanceUnknown
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
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'adjust',
          }),
        });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLTextAreaElement>('#result-adjust-input')
            ?.focus();
        });
        return;
      case 'deliver':
        await navigate({
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'delivery',
          }),
        });
        return;
      case 'open_history':
        await navigate({
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'history',
          }),
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
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'run',
          }),
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
        await commands.execute(
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
        await commands.execute(
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
        await commands.execute(
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
    if (!pendingImageAdjust || commands.adjustBusy) return;
    setAdjustError(undefined);
    try {
      await commands.runAdjust(async () => {
        const command =
          pendingImageAdjust.source.kind === 'legacy_job'
            ? {
                billingQuoteId: pendingImageAdjust.quote.quoteId,
                derivedWorkId: pendingImageAdjust.derivedWorkId,
                source: pendingImageAdjust.source,
              }
            : {
                billingQuoteId: pendingImageAdjust.quote.quoteId,
                derivedTaskId: pendingImageAdjust.derivedTaskId,
                derivedWorkId: pendingImageAdjust.derivedWorkId,
                instruction: pendingImageAdjust.instruction,
                ...(pendingImageAdjust.scope
                  ? { scope: pendingImageAdjust.scope }
                  : {}),
                source: pendingImageAdjust.source,
              };
        const result = await commands.confirmAdjust<{ work: { id: string } }>(
          `adjust-confirm:${pendingImageAdjust.derivedWorkId}:${pendingImageAdjust.quote.quoteId}`,
          command
        );
        setPendingImageAdjust(null);
        window.requestAnimationFrame(() => {
          window.location.assign(resultCenterPath(result.work.id));
        });
      });
    } catch {
      setAdjustError(
        '调整提交暂时不可用。费用以报价确认页和账单记录为准，请稍后重试。'
      );
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
  const deliveryAttempt =
    deliveryPanelTarget && canonicalDeliveryPlatform && currentResultEditVersion
      ? resultDeliveryAttemptState(contentPackage, {
          platform: canonicalDeliveryPlatform,
          variantVersionId: currentResultEditVersion.id,
        })
      : 'none';
  const shellPhase = projectResultShellPhase({
    target,
    workspaceKind,
    progressState: resultProgressState,
    acceptanceUnknown,
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
  const revisionTimelineTarget = resultEditPlatform
    ? deliveryVariant
    : contentPackage;
  const revisionTimelineFacts = revisionTimelineFactsFromContentPackage(
    revisionTimelineTarget
  );
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
        referencedAssetIds: currentResultEditVersion?.orderedAssetIds,
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

  const page = (
    <ResultCenterPage
      workId={workId}
      resolveOutcome={outcome}
      facts={{
        target,
        workspaceKind,
        requestedPanel: search.panel,
        progressState: resultProgressState,
        acceptanceUnknown,
        hasUsableCandidate,
        deliveryAttempt,
        ...packageMutationFacts,
        taskId: resultWorkflowId || undefined,
        jobId: selected?.job?.id,
        failureCode: selected?.job?.failureCode,
      }}
      {...(basedOnLabel ? { basedOnLabel } : {})}
      {...(currentResultEditVersion?.exportUseDelivery
        ? { exportUseDelivery: currentResultEditVersion.exportUseDelivery }
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
      revisionRestoreBusy={commands.shellActionBusy}
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
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'history',
          }),
        });
      }}
      actionBusy={commands.shellActionBusy}
      actionError={shellActionError}
      supportedActionIds={supportedActionIds}
      adjustConfirmation={
        pendingImageAdjust ? (
          /*
           * D-164⑥ 决定 A: a regeneration calls a model again, so it goes
           * through the same card first-time generation goes through. Keeping
           * a second confirmation component here would have meant two shapes
           * for one decision — and the one it replaces put「4 CNY」in front of
           * a shop owner, which D-109 puts out of merchant sight entirely.
           */
          <Dialog
            onOpenChange={(nextOpen) => {
              if (nextOpen) return;
              setPendingImageAdjust(null);
              setAdjustError(undefined);
              setAdjustFeedback(
                projectExecutionCostFeedback({ outcome: 'rejected' })
              );
            }}
            open
          >
            {/*
             * The dialog shell stays: this decision is modal today, and the
             * merchant gets Escape and her focus back on the adjustment input
             * afterwards. Only the body changed — one card shape for one
             * decision (D-164⑥ 决定 A), not one shape per entry point.
             */}
            <DialogContent
              aria-modal="true"
              className="meiye-product-shell max-w-3xl"
              data-product-modal="image-adjust-confirmation"
              data-testid="image-adjust-confirmation"
              finalFocus={() =>
                document.getElementById('result-adjust-input') ?? false
              }
              showCloseButton={false}
            >
              <ExecutionConfirmCard
                {...projectExecutionConfirmCard(
                  openExecutionConfirm(createExecutionConfirmState(), {
                    composerSnapshot: {
                      draftRevisionId: pendingImageAdjust.derivedWorkId,
                      lensId: 'image_text',
                      sources: [],
                      userText: pendingImageAdjust.instruction,
                    },
                    cost: projectExecutionCost({
                      // The Result Center does not carry the credit balance, so
                      // the card quotes what this run costs and stays silent
                      // about what is left.
                      creditCost: pendingImageAdjust.quote.creditCost ?? null,
                      requirements: (
                        pendingImageAdjust.quote.debitUnits ?? []
                      ).map((unit) => ({
                        cost: unit.quantity,
                        resource: unit.resource as ComposerQuotaResource,
                      })),
                    }),
                    params: projectExecutionParams({
                      aspectRatio: pendingImageAdjust.aspectRatio ?? null,
                      lensId: 'image_text',
                      outputLabel: pendingImageAdjust.quote.outputLabel ?? null,
                      quantity: pendingImageAdjust.quantity ?? null,
                    }),
                  }),
                  {
                    busy: commands.adjustBusy,
                    onConfirm: () => void confirmImageAdjust(),
                    onReject: () => {
                      setPendingImageAdjust(null);
                      setAdjustError(undefined);
                      setAdjustFeedback(
                        projectExecutionCostFeedback({ outcome: 'rejected' })
                      );
                    },
                    staleNotice: adjustError ?? null,
                  }
                )}
              />
            </DialogContent>
          </Dialog>
        ) : adjustError ? (
          <p className="text-sm text-destructive" role="alert">
            {adjustError}
          </p>
        ) : adjustFeedback ? (
          <ExecutionCostFeedbackLine feedback={adjustFeedback} />
        ) : undefined
      }
      onAction={(action) => {
        if (commands.shellActionBusy) return;
        setShellActionError(undefined);
        void commands
          .runShellAction(() => handleShellAction(action))
          .catch((error) => {
            setShellActionError(
              error instanceof Error ? error.message : '操作失败，请重试。'
            );
          });
      }}
      onBack={() => {
        const destination = resultReturnDestination(
          returnState ?? { kind: 'dashboard' }
        );
        if (destination.to === '/dashboard/works/$workId') {
          void navigate({
            params: destination.params,
            search: destination.search,
            to: destination.to,
          });
          return;
        }
        void navigate({ search: destination.search, to: destination.to });
      }}
      onDriftChoice={(choice) => returnRestore.applyDriftChoice(choice)}
      onCopyAdopt={copyAsset ? adoptCopyCandidate : undefined}
      onCopyGeneratePlatformVariants={() => generateCopyPlatformVariants()}
      onCopyHandEdit={
        contentPackage && currentResultEditVersion
          ? async (changes) => {
              const fingerprint = `hand-edit:${contentPackage.id}:${contentPackage.revision}:${resultEditPlatform ?? 'canonical'}:${JSON.stringify(changes)}`;
              const key = commands.keyFor(fingerprint);
              await executeResultContentPackageHandEdit({
                contentPackage,
                changes,
                idempotencyKey: key,
                ...(resultEditPlatform ? { platform: resultEditPlatform } : {}),
              });
              commands.releaseKey(fingerprint);
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
        contentPackage && currentResultEditVersion
          ? async (request: QuickEditRequest) => {
              const fingerprint = `quick-edit:${contentPackage.id}:${contentPackage.revision}:${resultEditPlatform ?? 'canonical'}:${request.action}:${request.instruction}`;
              const key = commands.keyFor(fingerprint);
              await operationsCommand<PublicContentPackage>(
                'edit_content_package_version',
                {
                  baseVersionId: currentResultEditVersion.id,
                  changes: {
                    body: request.changes.body,
                    conversionHook: request.changes.conversionHook,
                    orderedAssetIds: [
                      ...currentResultEditVersion.orderedAssetIds,
                    ],
                    title: request.changes.title,
                    topics: [...currentResultEditVersion.topics],
                  },
                  expectedRevision: contentPackage.revision,
                  intent: buildQuickEditIntent({
                    action: request.action,
                    baseVersionId: currentResultEditVersion.id,
                    contentPackage,
                    instruction: request.instruction,
                  }),
                  packageId: contentPackage.id,
                  ...(resultEditPlatform
                    ? { platform: resultEditPlatform }
                    : {}),
                },
                key
              );
              commands.releaseKey(fingerprint);
              await refreshCanonicalResult();
            }
          : undefined
      }
      {...(adjustSource
        ? {}
        : { adjustUnavailableReason: result_adjust_unavailable() })}
      onImageAdopt={async (_actionKind, orderedAssetIds) => {
        if (await adoptHarnessCandidate()) return;
        await adopt({ kind: 'image', orderedAssetIds });
      }}
      onImageSaveDraft={async (selection) => {
        await commands.execute(
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
        await commands.execute(
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
      onImageAiCover={() => {
        const seed = buildAiCoverActionSeed({
          topicHint: currentPackageVersion?.title,
        });
        void navigate({
          to: '/dashboard',
          search: {
            aiCoverAspectRatio: seed.aspectRatio,
            aiCoverStyle: seed.style,
            aiCoverTopic: currentPackageVersion?.title,
          },
        });
      }}
      onAdjust={async (instruction, scope) => {
        if (
          !selected ||
          !adjustSource ||
          commands.adjustBusy ||
          pendingImageAdjust
        )
          return;
        setAdjustError(undefined);
        try {
          await commands.runAdjust(async () => {
            const prepared = await commands.prepareAdjust<{
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
              {
                expectedWorkUpdatedAt: selected.work.updatedAt,
                instruction,
                ...(scope ? { scope } : {}),
                source: adjustSource,
                workId,
              }
            );
            const quoteId = crypto.randomUUID();
            const quote = await commands.execute<ProductQuoteSnapshot>(
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
            setAdjustFeedback(null);
            setPendingImageAdjust({
              ...(prepared.quoteIntent.aspectRatio
                ? { aspectRatio: prepared.quoteIntent.aspectRatio }
                : {}),
              derivedTaskId: prepared.task.id,
              derivedWorkId: prepared.work.id,
              instruction,
              quantity: prepared.quoteIntent.quantity,
              quote,
              ...(scope ? { scope } : {}),
              source: adjustSource,
            });
          });
        } catch {
          setAdjustError(
            '暂时无法确认本次调整费用。请稍后重试，重新确认前不会创建新的调整。'
          );
        }
      }}
      onVideoAdopt={
        videoWorksurface?.composedCandidate ? adoptComposedVideo : undefined
      }
      onVideoDeliver={() =>
        navigate({
          search: (current: ResultCenterSearch) => ({
            ...current,
            panel: 'delivery',
          }),
        })
      }
      onVideoCanonicalEdit={
        selectedVideoWorkflowId
          ? async (command: VideoCanonicalEditCommand) => {
              const fingerprint = `video-canonical-edit:${JSON.stringify(command)}`;
              const key = commands.keyFor(fingerprint);
              const { workflowId, expectedRevision, ...edit } = command;
              await commands.execute(
                'model-supply',
                {
                  action: 'video_workflow_edit',
                  payload: { edit, expectedRevision, workflowId },
                },
                key
              );
              commands.releaseKey(fingerprint);
              await refreshCanonicalVideo();
            }
          : undefined
      }
      closeLoop={closeLoopFacts}
      closeLoopPending={commands.closeLoopPending}
      selfReportPrompt={selfReportHandoff.selfReportPrompt}
      selfReportChips={selfReportHandoff.selfReportChips}
      onSelfReportChip={selfReportHandoff.onSelfReportChip}
      onSelfReportIgnore={selfReportHandoff.onSelfReportIgnore}
      onRecordManualPublication={async (input) => {
        const publicationBinding = closeLoopFacts?.publicationBindings.find(
          (binding) =>
            binding.platform === input.platform &&
            binding.variantVersionId === input.variantVersionId
        );
        if (!contentPackage || !publicationBinding) return;
        setShellActionError(undefined);
        try {
          await commands.runCloseLoop(async () => {
            await operationsCommand(
              'record_content_package_manual_result',
              {
                accountDisplayLabel: input.accountDisplayLabel,
                expectedRevision: contentPackage.revision,
                ...(input.note ? { note: input.note } : {}),
                packageId: contentPackage.id,
                platform: input.platform,
                ...(input.platformUrl
                  ? { platformUrl: input.platformUrl }
                  : {}),
                publishedAt: input.publishedAt,
                status: input.status,
                variantVersionId: publicationBinding.variantVersionId,
              },
              input.idempotencyKey
            );
            await refreshCanonicalResult();
          });
        } catch (error) {
          setShellActionError(
            error instanceof Error ? error.message : '发布记录暂时无法保存。'
          );
        }
      }}
      onRecordOutcomeObservation={async (
        kind,
        detail?: OutcomeObservationDetail
      ) => {
        if (!contentPackage) return;
        setShellActionError(undefined);
        try {
          await commands.runCloseLoop(async () => {
            await operationsCommand(
              'record_content_package_result_signal',
              {
                expectedRevision: contentPackage.revision,
                kind,
                ...(detail?.note ? { note: detail.note } : {}),
                ...(detail?.occurredAt
                  ? { occurredAt: detail.occurredAt }
                  : {}),
                packageId: contentPackage.id,
                ...(detail?.quantity !== undefined
                  ? { quantity: detail.quantity }
                  : {}),
              },
              crypto.randomUUID()
            );
            await refreshCanonicalResult();
          });
        } catch (error) {
          setShellActionError(
            error instanceof Error ? error.message : '结果信号暂时无法保存。'
          );
        }
      }}
      onConfirmWeeklyRecommendation={async ({ packageId, action }) => {
        const sourcePackage = contentPackagesQuery.data?.find(
          (candidate) => candidate.id === packageId
        );
        if (!sourcePackage) return;
        setShellActionError(undefined);
        try {
          await commands.runCloseLoop(async () => {
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
            const derived = await commands.execute<{ id: string }>(
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
          });
        } catch (error) {
          setShellActionError(
            error instanceof Error
              ? error.message
              : '下一轮创作草稿暂时无法创建。'
          );
        }
      }}
      deliveryPanelFacts={deliveryPanelFacts}
      viewport={deliveryViewport}
      onDeliveryAction={async (actionId, responsibility) => {
        if (actionId === 'copy' && deliveryCopy) {
          await navigator.clipboard.writeText(
            [deliveryCopy.title, deliveryCopy.body, deliveryCopy.conversionHook]
              .filter(Boolean)
              .join('\n\n')
          );
          return;
        }
        if (actionId === 'single_download' && singleDownloadUrl) {
          startDownload(singleDownloadUrl);
          return 'download_done';
        }
        if (actionId === 'single_download' && deliveryCopy?.body) {
          downloadDeliveryCopy();
          return 'download_done';
        }
        if (
          actionId === 'full_package' &&
          deliveryPanelTarget === 'wechat_moments' &&
          contentPackage &&
          currentResultEditVersion
        ) {
          const captionUrl = URL.createObjectURL(
            new Blob(
              [
                buildCaptionText({
                  body: currentResultEditVersion.body,
                  ...(currentResultEditVersion.conversionHook
                    ? {
                        conversionHook: currentResultEditVersion.conversionHook,
                      }
                    : {}),
                  title: currentResultEditVersion.title,
                  topics: currentResultEditVersion.topics,
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
  return { status: 'ready', view: page.props as ResultCenterPageProps };
}
