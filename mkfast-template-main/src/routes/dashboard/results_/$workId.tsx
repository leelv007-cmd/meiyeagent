/**
 * Result Center route — `/dashboard/results/$workId` (D-089 / WT-D1 / #99).
 *
 * New path-style object route. Does NOT expand the legacy `?workId=` bridge
 * on dashboard/index (C owner). Shareable search: contentId / versionId /
 * panel / focusKey only.
 */

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import {
  commandP1,
  operationsCommand,
  operationsQuery,
  queryP1,
} from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  buildCopyStreamRequestFromJob,
  submitCopyCandidateStream,
  useCopyCandidateStream,
} from '@/product/copy-stream';
import {
  creativeJobObservation,
  useCreativeJobObserver,
} from '@/product/creative-job-observer';
import {
  buildLiveVideoWorksurface,
  contentPackageRefreshToken,
  factSourcesFromGroundingSnapshot,
  revisionTimelineFactsFromContentPackage,
  latestContentPackageForWork,
  platformPreviewsFromContentPackage,
  projectResultCenterLiveProjection,
  runDetailFactsFromLiveSelection,
} from '@/product/results/result-live-projection';
import {
  calibrateTerminalRevision,
  pickExclusiveTokenCandidates,
} from '@/product/results/result-token-stream';
import { projectResultShellPhase } from '@/product/results/result-shell-model';
import { ResultCenterPage } from '@/product/results/result-center-page';
import { ImageAdjustConfirmation } from '@/product/results/image-adjust-confirmation';
import { createCanonicalAssistedHandoff } from '@/product/results/delivery-assisted-live';
import type { AssistedReceipt } from '@/product/results/delivery-b3-types';
import { buildCaptionText } from '@/product/results/delivery-full-package';
import { shareCanonicalHandoff } from '@/product/results/delivery-handoff-live';
import { projectResultCloseLoopFacts } from '@/product/results/result-close-loop-live';
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
import type {
  CreativeWorkbenchProjection,
  ProductQuoteSnapshot,
  PublicContentPackage,
  ResultAction,
  ResultAdjustCommand,
  ResultTargetResolveOutcome,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';
import { resultCenterPath } from '@meiye/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

type PendingImageAdjust = {
  baseJobId: string;
  derivedWorkId: string;
  instruction: string;
  quote: ProductQuoteSnapshot;
  scope?: ResultAdjustCommand['scope'];
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
  // ADR-0007 token stream — live partials for copy / image_text running phase.
  const copyCandidateStream = useCopyCandidateStream({ id: workId });
  /** One submit per job+submissionKey; avoids replaying stream on re-render. */
  const streamSubmitKeyRef = useRef<string | null>(null);

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
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: false,
  });

  // ADR-0007: actually start the copy token stream while Job is running/waiting.
  // Hook wiring alone is not enough — useObject only streams after submit().
  useEffect(() => {
    if (!workbenchQuery.data) return;
    const live = projectResultCenterLiveProjection(workbenchQuery.data, workId);
    const selected = live.selected;
    if (!selected?.job) return;
    const streamActive =
      (selected.workspaceKind === 'copy' ||
        selected.workspaceKind === 'image') &&
      (selected.progressState === 'running' ||
        selected.progressState === 'waiting');
    if (!streamActive) return;
    const request = buildCopyStreamRequestFromJob(selected.job);
    if (!request) return;
    const submitKey = `${selected.job.id}:${selected.job.submissionKey}`;
    if (streamSubmitKeyRef.current === submitKey) return;
    if (copyCandidateStream.isLoading) return;
    if (
      copyCandidateStream.object?.candidates &&
      copyCandidateStream.object.candidates.length > 0
    ) {
      streamSubmitKeyRef.current = submitKey;
      return;
    }
    streamSubmitKeyRef.current = submitKey;
    submitCopyCandidateStream(copyCandidateStream.submit, request);
  }, [
    workbenchQuery.data,
    workId,
    copyCandidateStream.isLoading,
    copyCandidateStream.object,
    copyCandidateStream.submit,
  ]);

  const contentPackagesQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'content_packages'),
    queryFn: ({ signal }) =>
      operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
    retry: false,
    refetchInterval:
      videoRegenerationPackageBaseline === undefined ? false : 1_000,
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
  useCreativeJobObserver(creativeJobObservation(selected?.job ?? undefined));
  const selectedVideoWorkflowId =
    selected?.workspaceKind === 'video' &&
    selected.job?.providerJobId?.startsWith('video-workflow-')
      ? selected.job.providerJobId
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
  // `content_packages` is ordered by updatedAt DESC. A full-compose rerun
  // creates a derived workflow/package while the selected CreativeJob still
  // points at the original provider workflow, so the newest Work package is
  // the canonical result surface.
  const contentPackage = latestContentPackageForWork(
    contentPackagesQuery.data,
    workId
  );
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

  if (selected?.workspaceKind === 'video' && workflowQuery.isPending) {
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
  // ADR-0007 / P1-B2: user-visible copy increments are exclusive.
  // Prefer structured stream partials as the sole source while running;
  // never merge poll/workbench candidate snapshots into the stream face.
  // image.generate / video never feed copy-stream slots — do not mark them
  // streamActive or e2e will wait forever for tokens that cannot arrive.
  const streamActive =
    workspaceKind === 'copy' &&
    (selected?.progressState === 'running' ||
      selected?.progressState === 'waiting') &&
    selected?.job?.contract.operation === 'copy.generate';
  const structuredStreamCandidates = streamActive
    ? copyCandidateStream.object?.candidates?.filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== undefined
      )
    : undefined;
  // Poll/workbench harness candidates are intentionally not passed as a
  // second source — pickExclusiveTokenCandidates discards poll when empty.
  const exclusiveTokens = pickExclusiveTokenCandidates({
    workflowTokenCandidates: null,
    structuredStreamCandidates: structuredStreamCandidates ?? null,
    pollCandidates: null,
  });
  const partialCandidates = streamActive
    ? exclusiveTokens.candidates
    : undefined;
  const streamLoading = streamActive
    ? Boolean(copyCandidateStream.isLoading) ||
      selected?.progressState === 'running' ||
      selected?.progressState === 'waiting'
    : false;
  const deliveryTarget = deliveryTargetForIntent(
    workspaceKind,
    selected?.work.intent ?? ''
  );
  const canonicalDeliveryPlatform =
    deliveryTarget === 'wechat_moments' ? null : deliveryTarget;
  const baseVideoWorksurface = selected
    ? buildLiveVideoWorksurface(selected, workflowQuery.data)
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
          streamed: exclusiveTokens.candidates[0],
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
      : selected?.copyWorksurface;
  const imageWorksurface =
    selected?.imageWorksurface && currentPackageVersion
      ? {
          ...selected.imageWorksurface,
          adoptedOrderedAssetIds: [...currentPackageVersion.orderedAssetIds],
          baseRevisionId: currentPackageVersion.id,
          hasContentPackage: true,
          lifecycle: 'adopted' as const,
        }
      : selected?.imageWorksurface;

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
  const copyAsset = selected?.assets.find(
    (asset) =>
      asset.kind === 'text' &&
      (asset.id === selected.job?.recommendedAssetId ||
        !selected.job?.recommendedAssetId)
  );
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
  const closeLoopFacts = contentPackage
    ? projectResultCloseLoopFacts({
        contentPackage,
        contentPackages: contentPackagesQuery.data ?? [],
        assistedReceipts:
          assistedReceiptsQuery.data?.map(({ receipt }) => receipt) ?? [],
        canShareFiles: typeof navigator.canShare === 'function',
        hasDownload: Boolean(
          singleDownloadUrl ||
            canExportFullPackage ||
            (deliveryTarget === 'wechat_moments' && copyAsset)
        ),
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
  const adoptCopyCandidate = async () => {
    if (!copyAsset) return;
    const adopted = await adopt(
      imageAssetIds.length > 0
        ? {
            copyAssetId: copyAsset.id,
            kind: 'image_text',
            orderedAssetIds: imageAssetIds,
          }
        : { copyAssetId: copyAsset.id, kind: 'copy' }
    );
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
    if (workspaceKind === 'image' && imageAssetIds.length > 0) {
      await adopt({ kind: 'image', orderedAssetIds: imageAssetIds });
      return;
    }
    if (workspaceKind === 'video' && videoWorksurface?.composedCandidate) {
      await adopt({
        kind: 'video',
        videoAssetId: videoWorksurface.composedCandidate.assetId,
      });
    }
  };
  const createFromCurrent = async () => {
    if (!selected) return;
    const derived = await commandP1<{ id: string }>(
      'operations',
      {
        action: 'derive_creative_work',
        payload: {
          autoConfirmBrief: false,
          intent: selected.work.intent,
          sessionId: selected.work.sessionId,
          sourceReferences: [{ id: selected.work.id, kind: 'work' }],
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
          baseJobId: pendingImageAdjust.baseJobId,
          billingQuoteId: pendingImageAdjust.quote.quoteId,
          derivedWorkId: pendingImageAdjust.derivedWorkId,
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

  const shellPhase = projectResultShellPhase({
    target,
    workspaceKind,
    progressState: selected?.progressState,
    hasUsableCandidate: selected?.hasUsableCandidate,
    hasAdoptedCandidate: Boolean(currentPackageVersion),
  });
  const revisionTimelineFacts =
    revisionTimelineFactsFromContentPackage(contentPackage);
  const runDetailFacts = runDetailFactsFromLiveSelection({
    workId,
    phase: shellPhase,
    progressState: selected?.progressState,
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
        progressState: selected?.progressState,
        hasUsableCandidate: selected?.hasUsableCandidate,
        hasAdoptedCandidate: Boolean(currentPackageVersion),
        jobId: selected?.job?.id,
      }}
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
        if (returnState?.kind === 'task-inbox') {
          const destination = resultReturnDestination(returnState);
          void navigate({
            to: '/dashboard/tasks',
            search: destination.search,
          });
          return;
        }
        void navigate({ to: '/dashboard', search: {} });
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
        if (!selected?.job || adjustBusy || pendingImageAdjust) return;
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
            work: { id: string };
          }>(
            `adjust-prepare:${workId}:${selected.job.id}:${selected.work.updatedAt}:${instruction}:${JSON.stringify(scope)}`,
            'result_adjust_prepare',
            {
              baseJobId: selected.job.id,
              expectedWorkUpdatedAt: selected.work.updatedAt,
              instruction,
              ...(scope ? { scope } : {}),
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
            baseJobId: selected.job.id,
            derivedWorkId: prepared.work.id,
            instruction,
            quote,
            ...(scope ? { scope } : {}),
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
        videoWorksurface?.composedCandidate
          ? async () => {
              await adopt({
                kind: 'video',
                videoAssetId: videoWorksurface.composedCandidate!.assetId,
              });
            }
          : undefined
      }
      onVideoDeliver={() =>
        navigate({
          search: (current) => ({ ...current, panel: 'delivery' }),
        })
      }
      onVideoRequestRegenerationQuote={async (
        request: VideoRegenerationQuoteRequest
      ) => {
        const fingerprint = `video-regen-quote:${request.sourceRunId}:${request.scope}:${request.shotId ?? ''}`;
        const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
        intentKeys.current.set(fingerprint, key);
        const quoted = await commandP1<VideoRegenerationServerQuote>(
          'video-regeneration',
          { action: 'quote', payload: request },
          key
        );
        intentKeys.current.delete(fingerprint);
        return quoted;
      }}
      onVideoConfirmRegeneration={async ({ quoteId, taskId }) => {
        const fingerprint = `video-regen-confirm:${quoteId}:${taskId}`;
        const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
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
      }}
      onVideoCanonicalEdit={async (command: VideoCanonicalEditCommand) => {
        const fingerprint = `video-canonical-edit:${JSON.stringify(command)}`;
        const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
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
      }}
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
      onRecordOutcomeObservation={async (kind) => {
        if (!contentPackage) return;
        setCloseLoopPending(true);
        setShellActionError(undefined);
        try {
          await operationsCommand(
            'record_content_package_result_signal',
            {
              expectedRevision: contentPackage.revision,
              kind,
              packageId: contentPackage.id,
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
              payload: {
                autoConfirmBrief: false,
                intent: currentVersion?.title ?? '基于已有成品继续创作',
                sessionId: `weekly:${sourceWorkId}`,
                sourceReferences: [{ id: sourceWorkId, kind: 'work' }],
                sourceWorkId,
              },
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
        hasSingleDownload: Boolean(singleDownloadUrl),
        hasFullPackage:
          deliveryTarget === 'wechat_moments'
            ? Boolean(copyAsset || singleDownloadUrl)
            : canExportFullPackage,
        hasExternalSendApproval: Boolean(
          activeDeliveryApproval || assistedStored
        ),
        shareDevice: {
          hasNavigatorShare: typeof navigator.share === 'function',
          canShareFiles: typeof navigator.canShare === 'function',
          canShareText: typeof navigator.share === 'function',
        },
        sharePayload: {
          kind: copyAsset ? 'text' : 'files',
          ...(copyAsset?.body ? { text: copyAsset.body } : {}),
          ...(existingOneShotUrl ? { oneShotLinkUrl: existingOneShotUrl } : {}),
          ...(singleDownloadUrl ? { downloadHref: singleDownloadUrl } : {}),
        },
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
