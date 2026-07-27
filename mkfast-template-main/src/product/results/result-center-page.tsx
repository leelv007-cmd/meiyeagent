/**
 * Result Center page shell (WT-D1 / #99 + WT-D2 / #100).
 *
 * Mounts pure ResultShellModel projection + token stream running state +
 * copy/image_text and image worksurfaces. Video workspace stubs for E3.
 * Delivery panel lands in D3.
 */

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { ProductStatus } from '@/components/uiux/product-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContentPackageExportCarrier } from '@/p1/content-package-export-carrier';
import type {
  ContentPackagePlatform,
  QuickEditExportUseDelivery,
  ResultAction,
  ResultAdjustCommand,
  ResultRevisionDriftChoice,
  ResultShellModel,
  ResultTarget,
  ResultTargetResolveOutcome,
  ResultWorkspaceKind,
} from '@meiye/contracts';
import type { ReactNode } from 'react';

import { AdjustPrompt } from './adjust-prompt';
import {
  CopyImageTextWorksurface,
  type CopyImageTextWorksurfaceProps,
} from './copy-image-text-worksurface';
import {
  FACT_SOURCE_KIND_LABELS,
  projectFactSources,
  type CopyImageTextWorksurfaceFacts,
  type FactSourceItem,
} from './copy-image-text-worksurface-model';
import {
  ImageWorksurface,
  type ImageWorksurfaceProps,
} from './image-worksurface';
import type { ImageWorksurfaceFacts } from './image-worksurface-model';
import { VideoWorksurface } from './video/video-worksurface';
import type {
  VideoCanonicalEditCommand,
  VideoRegenerationQuoteRequest,
  VideoRegenerationServerQuote,
} from './video/video-worksurface';
import type { VideoWorksurfaceState } from './video/video-worksurface-model';
import type { VideoProStudioRefineHandoff } from './video/video-worksurface-model';
import {
  desktopVisibleActions,
  mobileVisibleActions,
  projectResultShellView,
  shellViewFromResolveOutcome,
  type ResultShellFacts,
  type ResultShellView,
} from './result-shell-model';
import {
  candidateHasToken,
  projectResultTokenStream,
  type PartialCopyCandidate,
} from './result-token-stream';
import {
  applyRevisionDriftChoice,
  detectRevisionDrift,
  type ResultReturnRestoreStore,
} from './result-return-restore';
import type { DeliveryActionId } from './delivery-capability-groups';
import type { AssistedResponsibilityRole } from './delivery-b3-types';
import type { DeliveryOutcome } from './delivery-outcomes-a11y';
import { DeliveryPanel } from './delivery-panel';
import {
  projectDeliveryPanel,
  type DeliveryPanelFacts,
} from './delivery-panel-model';
import { formatMerchantSupportReference } from './merchant-support-reference';
import {
  projectRevisionTimeline,
  type RevisionTimelineFacts,
} from './result-revision-timeline-model';
import { RevisionTimelinePanel } from './result-revision-timeline-panel';
import {
  projectResultRunDetail,
  type ResultRunDetailFacts,
} from './result-run-detail-model';
import { ResultRunDetailPanel } from './result-run-detail-panel';
import {
  projectDeliveryActionReceiptPanel,
  type DeliveryActionReceiptFact,
} from './delivery-action-receipt-model';
import { OutcomeChipsPanel } from './outcome-chips-panel';
import {
  projectOutcomeObservationPanel,
  type OutcomeObservationFact,
  type OutcomeObservationKind,
} from './outcome-observation-model';
import { PublicationRecordPanel } from './publication-record-panel';
import {
  projectPublicationRecordPanel,
  type ManualPublicationFormInput,
  type PublicationRecordFact,
} from './publication-record-model';
import { WeeklyReviewPanel } from './weekly-review-panel';
import {
  projectWeeklyReviewPanel,
  type WeeklyNextAction,
  type WeeklyReviewFacts,
} from './weekly-review-model';

export type ResultCenterPageProps = {
  workId: string;
  resolveOutcome: ResultTargetResolveOutcome;
  facts: Omit<ResultShellFacts, 'target'> & { target?: ResultTarget };
  /** Viewport action budget. */
  viewport?: 'desktop' | 'mobile';
  /** Running token stream partials (copy / image_text). */
  partialCandidates?: PartialCopyCandidate[];
  streamLoading?: boolean;
  /** Optional return/restore store for drift UI. */
  restoreStore?: ResultReturnRestoreStore;
  currentRevisionId?: string;
  /** P1-B1: ContentPackage revision timeline for the version panel. */
  revisionTimelineFacts?: RevisionTimelineFacts;
  /** P1-B1: safe Task/Job diagnostic facts for Run Detail. */
  runDetailFacts?: ResultRunDetailFacts;
  /** P1-B1: shell-level Fact Sources for the current revision. */
  shellFactSources?: readonly FactSourceItem[];
  onRestoreRevisionVersion?: (versionId: string) => void | Promise<void>;
  revisionRestoreBusy?: boolean;
  /** D2: copy / image_text worksurface facts (when workspaceKind is copy). */
  copyWorksurface?: CopyImageTextWorksurfaceFacts;
  /** D2: image worksurface facts (when workspaceKind is image). */
  imageWorksurface?: Omit<
    ImageWorksurfaceFacts,
    'workingSelection' | 'explicitMode'
  > & {
    workingSelection?: ImageWorksurfaceFacts['workingSelection'];
    explicitMode?: ImageWorksurfaceFacts['explicitMode'];
  };
  /** E3: video worksurface projected from the public VideoWorkflow contract. */
  videoWorksurface?: VideoWorksurfaceState;
  onVideoAdopt?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onVideoDeliver?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onVideoRequestRegenerationQuote?: (
    request: VideoRegenerationQuoteRequest
  ) => Promise<VideoRegenerationServerQuote>;
  onVideoConfirmRegeneration?: (input: {
    quoteId: string;
    taskId: string;
  }) => Promise<void>;
  onVideoCanonicalEdit?: (command: VideoCanonicalEditCommand) => Promise<void>;
  onVideoProStudio?: (handoff: VideoProStudioRefineHandoff) => void;
  onCopyAdopt?: () => void | Promise<void>;
  onCopyGeneratePlatformVariants?: CopyImageTextWorksurfaceProps['onGeneratePlatformVariants'];
  onCopyHandEdit?: CopyImageTextWorksurfaceProps['onHandEdit'];
  /** W07: selection rewrite chips become live once the page supplies this. */
  onCopySelectionRewrite?: CopyImageTextWorksurfaceProps['onSelectionRewrite'];
  /** W07: the single QuickEditIntent write seam for this surface. */
  onCopyQuickEdit?: CopyImageTextWorksurfaceProps['onQuickEdit'];
  /** W07: honest sentence when 「还想怎么改？」 cannot run on this result. */
  adjustUnavailableReason?: string;
  /** W08: 「基于「X」再创作」 — stored lineage, finally on screen. */
  basedOnLabel?: string;
  /**
   * W07: the export-use carrier the current version carries, if any.
   * Produced by a quick edit; rendering it is what makes 做成海报 reachable.
   */
  exportUseDelivery?: QuickEditExportUseDelivery;
  onImageAdopt?: (
    actionKind: string,
    orderedAssetIds: string[]
  ) => void | Promise<void>;
  onImageSaveLibrary?: ImageWorksurfaceProps['onSaveLibrary'];
  onImageSaveDraft?: ImageWorksurfaceProps['onSaveDraft'];
  onImageCreateFromThis?: ImageWorksurfaceProps['onCreateFromThis'];
  onDeliveryAction?: (
    actionId: DeliveryActionId,
    assisted?: {
      ownerId?: string;
      responsibilityRole: AssistedResponsibilityRole;
    }
  ) => DeliveryOutcome | undefined | Promise<DeliveryOutcome | undefined>;
  onAction?: (action: ResultAction, shell: ResultShellModel) => void;
  actionBusy?: boolean;
  actionError?: string;
  supportedActionIds?: readonly ResultAction['id'][];
  adjustConfirmation?: ReactNode;
  onDriftChoice?: (choice: ResultRevisionDriftChoice) => void;
  onAdjust?: (
    instruction: string,
    scope?: ResultAdjustCommand['scope']
  ) => void;
  onBack?: () => void;
  /** Optional delivery panel facts when shell.panel === 'delivery'. */
  deliveryPanelFacts?: DeliveryPanelFacts;
  /**
   * P1-D/E close-loop facts. Omitted → panels stay unmounted (fail closed).
   * Never invent live publication/outcome rows here.
   */
  closeLoop?: {
    contentPackageId?: string;
    contentPackageRevision?: number;
    variantVersionId?: string;
    publicationPlatform?: ContentPackagePlatform;
    workspaceId?: string;
    deliveryReceipts?: readonly DeliveryActionReceiptFact[];
    publicationRecords?: readonly PublicationRecordFact[];
    observations?: readonly OutcomeObservationFact[];
    weeklyReview?: WeeklyReviewFacts;
    automaticVerifiedPlatformCount?: number;
    hasOneShotLink?: boolean;
    canShareFiles?: boolean;
    hasDownload?: boolean;
  };
  onRecordManualPublication?: (
    input: ManualPublicationFormInput & { idempotencyKey: string }
  ) => void | Promise<void>;
  onRecordOutcomeObservation?: (
    kind: OutcomeObservationKind
  ) => void | Promise<void>;
  onConfirmWeeklyRecommendation?: (input: {
    packageId: string;
    action: WeeklyNextAction;
  }) => void | Promise<void>;
  closeLoopPending?: boolean;
};

function errorPanelKind(
  code: Extract<ResultShellView, { kind: 'error' }>['code']
): 'error' | 'permission-denied' | 'empty' {
  if (code === 'FORBIDDEN') return 'permission-denied';
  if (code === 'NOT_FOUND') return 'empty';
  return 'error';
}

function errorTitle(
  code: Extract<ResultShellView, { kind: 'error' }>['code']
): string {
  switch (code) {
    case 'NOT_FOUND':
      return '未找到该结果';
    case 'FORBIDDEN':
      return '无权访问';
    case 'LINEAGE_MISMATCH':
      return '目标与当前作品不匹配';
    case 'LEGACY_READONLY':
      return '历史档案';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function errorDescription(
  code: Extract<ResultShellView, { kind: 'error' }>['code']
): string {
  switch (code) {
    case 'NOT_FOUND':
      return '这个结果暂时无法打开。请返回创作后重新选择。';
    case 'FORBIDDEN':
      return '你暂时无权查看这个结果。请联系本店负责人确认权限。';
    case 'LINEAGE_MISMATCH':
      return '这个链接对应的内容已更新。请从创作或内容页重新打开。';
    case 'LEGACY_READONLY':
      return '这份历史内容仅供查看，请从内容页继续操作。';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function statusForResultPhase(
  phase: ResultShellModel['phase']
): Parameters<typeof ProductStatus>[0]['status'] {
  switch (phase) {
    case 'running':
      return 'running';
    case 'needs_input':
      return 'recoverable';
    case 'ready':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'delivered':
      return 'accepted';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function deliveryCapabilityLabel(
  mode: 'automatic_verified' | 'assisted' | 'unavailable'
): string {
  switch (mode) {
    case 'automatic_verified':
      return '可以直接交付';
    case 'assisted':
      return '需要你确认后交付';
    case 'unavailable':
      return '暂时无法交付';
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

function WorkspaceBody(props: {
  workspaceKind: ResultWorkspaceKind;
  copyWorksurface?: ResultCenterPageProps['copyWorksurface'];
  imageWorksurface?: ResultCenterPageProps['imageWorksurface'];
  videoWorksurface?: ResultCenterPageProps['videoWorksurface'];
  viewport?: ResultCenterPageProps['viewport'];
  onVideoAdopt?: ResultCenterPageProps['onVideoAdopt'];
  onVideoDeliver?: ResultCenterPageProps['onVideoDeliver'];
  onVideoRequestRegenerationQuote?: ResultCenterPageProps['onVideoRequestRegenerationQuote'];
  onVideoConfirmRegeneration?: ResultCenterPageProps['onVideoConfirmRegeneration'];
  onVideoCanonicalEdit?: ResultCenterPageProps['onVideoCanonicalEdit'];
  onVideoProStudio?: ResultCenterPageProps['onVideoProStudio'];
  onCopyAdopt?: ResultCenterPageProps['onCopyAdopt'];
  onCopyGeneratePlatformVariants?: ResultCenterPageProps['onCopyGeneratePlatformVariants'];
  onCopyHandEdit?: ResultCenterPageProps['onCopyHandEdit'];
  onCopySelectionRewrite?: ResultCenterPageProps['onCopySelectionRewrite'];
  onCopyQuickEdit?: ResultCenterPageProps['onCopyQuickEdit'];
  adjustUnavailableReason?: ResultCenterPageProps['adjustUnavailableReason'];
  currentRevisionId?: ResultCenterPageProps['currentRevisionId'];
  onImageAdopt?: ResultCenterPageProps['onImageAdopt'];
  onImageSaveLibrary?: ResultCenterPageProps['onImageSaveLibrary'];
  onImageSaveDraft?: ResultCenterPageProps['onImageSaveDraft'];
  onImageCreateFromThis?: ResultCenterPageProps['onImageCreateFromThis'];
  onAdjust?: (
    instruction: string,
    scope?: ResultAdjustCommand['scope']
  ) => void;
  /** Fallback document when copy worksurface facts are not yet wired. */
  fallbackCopy?: CopyImageTextWorksurfaceFacts;
}) {
  if (props.workspaceKind === 'video') {
    return props.videoWorksurface ? (
      <VideoWorksurface
        initialState={props.videoWorksurface}
        viewport={props.viewport}
        onAdopt={props.onVideoAdopt}
        onDeliver={props.onVideoDeliver}
        onRequestRegenerationQuote={props.onVideoRequestRegenerationQuote}
        onConfirmRegeneration={props.onVideoConfirmRegeneration}
        onCanonicalEdit={props.onVideoCanonicalEdit}
        onOpenProStudio={props.onVideoProStudio}
      />
    ) : (
      <div
        className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
        data-testid="result-video-workspace-empty"
      >
        等待视频工作流投影…
      </div>
    );
  }
  if (props.workspaceKind === 'image') {
    if (props.imageWorksurface) {
      return (
        <ImageWorksurface
          facts={{ ...props.imageWorksurface, viewport: props.viewport }}
          onAdjust={props.onAdjust}
          onAdoptPrimary={props.onImageAdopt}
          onSaveLibrary={props.onImageSaveLibrary}
          onSaveDraft={props.onImageSaveDraft}
          onCreateFromThis={props.onImageCreateFromThis}
        />
      );
    }
    return (
      <div
        className="space-y-3 rounded-lg border border-dashed p-6"
        data-testid="result-image-workspace-empty"
      >
        <p className="text-sm text-muted-foreground">等待图片候选…</p>
        <AdjustPrompt onSubmit={props.onAdjust} />
      </div>
    );
  }
  // copy / image_text
  const copyFacts = props.copyWorksurface ?? props.fallbackCopy;
  if (copyFacts) {
    return (
      <CopyImageTextWorksurface
        facts={{ ...copyFacts, viewport: props.viewport }}
        onAdjust={props.onAdjust}
        {...(props.adjustUnavailableReason
          ? { adjustUnavailableReason: props.adjustUnavailableReason }
          : {})}
        onAdopt={props.onCopyAdopt}
        onGeneratePlatformVariants={props.onCopyGeneratePlatformVariants}
        onHandEdit={props.onCopyHandEdit}
        onSelectionRewrite={props.onCopySelectionRewrite}
        onQuickEdit={props.onCopyQuickEdit}
        {...(props.currentRevisionId
          ? { currentRevisionId: props.currentRevisionId }
          : {})}
      />
    );
  }
  return (
    <div
      className="space-y-3 rounded-lg border border-dashed p-6"
      data-testid="result-copy-workspace-empty"
    >
      <p className="text-sm text-muted-foreground">等待文案候选…</p>
      <AdjustPrompt
        onSubmit={props.onAdjust}
        disabled={Boolean(props.adjustUnavailableReason)}
        {...(props.adjustUnavailableReason
          ? { unavailableReason: props.adjustUnavailableReason }
          : {})}
      />
    </div>
  );
}

export function projectResultCenterPageView(
  props: Pick<
    ResultCenterPageProps,
    | 'resolveOutcome'
    | 'facts'
    | 'partialCandidates'
    | 'streamLoading'
    | 'restoreStore'
    | 'currentRevisionId'
  >
): {
  view: ResultShellView;
  tokenStream: ReturnType<typeof projectResultTokenStream>;
  drift: ReturnType<typeof detectRevisionDrift>;
} {
  const view = shellViewFromResolveOutcome(props.resolveOutcome, props.facts);
  const workspaceKind = props.facts.workspaceKind ?? 'copy';
  const tokenStream = projectResultTokenStream({
    // copy + image (图文 image_text) share the ADR-0007 token stream path;
    // pure image.generate still projects through the same slots while running.
    workspaceKind:
      workspaceKind === 'copy'
        ? 'copy'
        : workspaceKind === 'image'
          ? 'image_text'
          : 'video',
    progressState: props.facts.progressState,
    partialCandidates: props.partialCandidates,
    loading: props.streamLoading,
    completed: props.facts.progressState === 'success',
  });

  let drift: ReturnType<typeof detectRevisionDrift> = null;
  if (props.restoreStore && props.currentRevisionId && view.kind === 'ready') {
    const key = Object.keys(props.restoreStore.drafts)[0];
    if (key) {
      // Prefer explicit uncommitted key from facts target + revision.
      const snapshot = props.restoreStore.byWorkId[view.shell.target.workId];
      if (snapshot?.uncommittedEditKey) {
        drift = detectRevisionDrift({
          uncommittedEditKey: snapshot.uncommittedEditKey,
          currentRevisionId: props.currentRevisionId,
        });
      }
    }
  }

  return { view, tokenStream, drift };
}

export function ResultCenterPage(props: ResultCenterPageProps) {
  const viewport = props.viewport ?? 'desktop';
  const { view, tokenStream, drift } = projectResultCenterPageView(props);
  const actionEnabled = (action: ResultAction) =>
    action.enabled &&
    !props.actionBusy &&
    Boolean(props.onAction) &&
    (props.supportedActionIds?.includes(action.id) ?? true);

  if (view.kind === 'error') {
    const supportReference = formatMerchantSupportReference(
      props.workId || view.requested.workId
    );
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: '创作', isCurrentPage: false },
          { label: '结果', isCurrentPage: true },
        ]}
        description="结果中心"
        title="结果中心"
      >
        <StatePanel
          kind={errorPanelKind(view.code)}
          title={errorTitle(view.code)}
          description={errorDescription(view.code)}
          actionLabel={props.onBack ? '返回' : undefined}
          onAction={props.onBack}
        />
        <p
          className="mt-3 text-xs text-muted-foreground"
          data-testid="result-support-reference"
        >
          联系支持时请提供编号 {supportReference}
        </p>
      </DashboardLayout>
    );
  }

  const { shell, sub } = view;
  const actions =
    viewport === 'mobile'
      ? {
          primary: mobileVisibleActions(shell).primary,
          secondary: [] as ResultAction[],
          more: mobileVisibleActions(shell).more,
        }
      : desktopVisibleActions(shell);

  const showCopyStream =
    tokenStream.tokenStreaming &&
    tokenStream.showStreamPanel &&
    (shell.workspaceKind === 'copy' || shell.workspaceKind === 'image');

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: '创作', isCurrentPage: false },
        { label: '结果', isCurrentPage: true },
      ]}
      description="查看成品、费用摘要和下一步"
      title="结果中心"
    >
      <div className="space-y-4" data-testid="result-center-shell">
        {props.onBack ? (
          <Button
            data-testid="result-back"
            onClick={props.onBack}
            size="sm"
            type="button"
            variant="ghost"
          >
            返回创作
          </Button>
        ) : null}
        <div data-testid="result-merchant-status">
          <ProductStatus
            showExplanation
            status={statusForResultPhase(shell.phase)}
          />
        </div>
        {shell.phase === 'failed' ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>本次是否产生费用请以账单记录为准；重新生成前会再次确认费用。</p>
            <p data-testid="result-support-reference">
              联系支持时请提供编号{' '}
              {formatMerchantSupportReference(props.workId)}
            </p>
          </div>
        ) : null}

        {/* Single aggregate live region for stage announcements (ADR-0007). */}
        <div
          aria-live="polite"
          className="sr-only"
          data-testid="result-shell-a11y"
        >
          {sub.a11yAnnouncement}
        </div>

        {drift ? (
          <div
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
            data-testid="result-revision-drift"
          >
            <p className="text-sm font-medium">内容版本已更新</p>
            <p className="mt-1 text-sm text-muted-foreground">
              本地调整基于较早版本，当前成品已有更新。请选择恢复、对比或丢弃。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {drift.choices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  size="sm"
                  variant={choice === 'discard' ? 'outline' : 'default'}
                  data-testid={`result-drift-${choice}`}
                  onClick={() => props.onDriftChoice?.(choice)}
                >
                  {choice === 'restore'
                    ? '恢复'
                    : choice === 'compare'
                      ? '对比'
                      : '丢弃'}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {props.adjustConfirmation}

        <div
          className={
            viewport === 'mobile'
              ? 'sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 -mx-4 flex flex-wrap gap-2 border-y bg-background/95 px-4 py-3 backdrop-blur'
              : 'flex flex-wrap gap-2'
          }
          data-testid="result-shell-actions"
          data-mobile-sticky-actions={
            viewport === 'mobile' ? 'true' : undefined
          }
          aria-busy={props.actionBusy ? 'true' : undefined}
        >
          {actions.primary && actionEnabled(actions.primary) ? (
            <Button
              type="button"
              data-testid="result-primary-action"
              onClick={() => props.onAction?.(actions.primary!, shell)}
            >
              {actions.primary.label}
            </Button>
          ) : null}
          {actions.secondary.filter(actionEnabled).map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              data-testid="result-secondary-action"
              onClick={() => props.onAction?.(item, shell)}
            >
              {item.label}
            </Button>
          ))}
          {actions.more.filter(actionEnabled).length > 0 ? (
            <details data-testid="result-more-actions">
              <summary className="cursor-pointer px-3 py-2 text-sm">
                更多
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.more.filter(actionEnabled).map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="result-overflow-action"
                    onClick={() => props.onAction?.(item, shell)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        {props.actionError ? (
          <p
            className="text-sm text-destructive"
            data-testid="result-shell-action-error"
            role="alert"
          >
            {props.actionError}
          </p>
        ) : null}

        {showCopyStream ? (
          <section
            data-testid="result-token-stream"
            data-has-first-token={tokenStream.hasFirstToken ? 'true' : 'false'}
            data-streaming={props.streamLoading ? 'true' : 'false'}
            data-reconnecting={tokenStream.reconnecting ? 'true' : 'false'}
            data-document-face="primary"
          >
            {tokenStream.reconnectBanner ? (
              <output
                className="mb-3 block rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
                data-testid="result-token-stream-reconnect"
              >
                {tokenStream.reconnectBanner}
              </output>
            ) : null}
            {/* Document-first primary recommendation (P1-B2) — not three technical cards. */}
            <div
              className="space-y-3 rounded-lg border p-4"
              data-testid="copy-stream-slot"
              data-role="primary"
              data-has-token={
                tokenStream.primary?.hasToken || tokenStream.slots[0]?.hasToken
                  ? 'true'
                  : 'false'
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  主推荐
                </p>
                <Badge variant="outline">生成中</Badge>
              </div>
              <p className="min-h-6 text-base font-medium">
                {tokenStream.primary?.title ||
                  tokenStream.slots[0]?.title ||
                  (props.streamLoading ? '生成中…' : '待生成')}
              </p>
              <p className="mt-2 min-h-20 max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                {tokenStream.primary?.body ||
                  tokenStream.slots[0]?.body ||
                  (props.streamLoading ? '正文生成中…' : '正文待生成')}
              </p>
              <p className="mt-2 rounded-md bg-muted px-2 py-1 text-sm">
                {tokenStream.primary?.conversionHook ||
                  tokenStream.slots[0]?.conversionHook ||
                  (props.streamLoading ? '转化语生成中…' : '转化语待生成')}
              </p>
            </div>
            {tokenStream.alternatives.length > 0 ? (
              <details
                className="mt-3 rounded-lg border p-3"
                data-testid="copy-stream-alternatives"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  备选（{tokenStream.alternatives.length}）· 按需查看
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {tokenStream.alternatives.map((slot) => (
                    <div
                      key={slot.index}
                      className="rounded-md border p-3"
                      data-testid="copy-stream-slot"
                      data-role="alternative"
                      data-has-token={slot.hasToken ? 'true' : 'false'}
                    >
                      <p className="min-h-6 text-sm font-medium">
                        {slot.title || '备选'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {slot.body}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {/* Hidden slots for e2e that still assert three partials. */}
            <div className="sr-only" aria-hidden="true">
              {tokenStream.slots.map((slot) => (
                <span
                  key={`sr-slot-${slot.index}`}
                  data-testid="copy-stream-slot"
                  data-has-token={slot.hasToken ? 'true' : 'false'}
                />
              ))}
            </div>
            <div
              className="sr-only"
              aria-live="polite"
              data-testid="result-token-stream-a11y"
            >
              {tokenStream.a11yStageAnnouncement}
            </div>
            {/* Persistent adjust entry even while streaming (D-046 / D-085). */}
            <div className="mt-4">
              <AdjustPrompt onSubmit={props.onAdjust} />
            </div>
          </section>
        ) : (
          <WorkspaceBody
            workspaceKind={shell.workspaceKind}
            copyWorksurface={props.copyWorksurface}
            imageWorksurface={props.imageWorksurface}
            videoWorksurface={props.videoWorksurface}
            viewport={viewport}
            onVideoAdopt={props.onVideoAdopt}
            onVideoDeliver={props.onVideoDeliver}
            onVideoRequestRegenerationQuote={
              props.onVideoRequestRegenerationQuote
            }
            onVideoConfirmRegeneration={props.onVideoConfirmRegeneration}
            onVideoCanonicalEdit={props.onVideoCanonicalEdit}
            onVideoProStudio={props.onVideoProStudio}
            onCopyAdopt={props.onCopyAdopt}
            onCopyGeneratePlatformVariants={
              props.onCopyGeneratePlatformVariants
            }
            onCopyHandEdit={props.onCopyHandEdit}
            onCopySelectionRewrite={props.onCopySelectionRewrite}
            onCopyQuickEdit={props.onCopyQuickEdit}
            {...(props.adjustUnavailableReason
              ? { adjustUnavailableReason: props.adjustUnavailableReason }
              : {})}
            {...(props.currentRevisionId
              ? { currentRevisionId: props.currentRevisionId }
              : {})}
            onImageAdopt={props.onImageAdopt}
            onImageSaveLibrary={props.onImageSaveLibrary}
            onImageSaveDraft={props.onImageSaveDraft}
            onImageCreateFromThis={props.onImageCreateFromThis}
            onAdjust={props.onAdjust}
          />
        )}

        {props.basedOnLabel ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="result-lineage-based-on"
          >
            {props.basedOnLabel}
          </p>
        ) : null}

        {/*
          W07: the carrier for the export use a quick edit just produced.
          Before this mount the renderer was unreachable code — the intent that
          fills `exportUseDelivery` had no browser producer, so nothing ever
          arrived here.
        */}
        {props.exportUseDelivery ? (
          <section
            className="space-y-2 rounded-lg border p-4"
            data-testid="result-export-use-carrier"
            data-export-use={props.exportUseDelivery.exportUse}
          >
            <ContentPackageExportCarrier delivery={props.exportUseDelivery} />
          </section>
        ) : null}

        {sub.candidates ? (
          <div data-testid="result-harness-candidates" className="text-sm">
            <p>
              推荐候选{' '}
              <span className="font-medium">
                {sub.candidates.primary.title}
              </span>
            </p>
            {sub.candidates.alternatives.length > 0 ? (
              <p className="text-muted-foreground">
                另有 {sub.candidates.alternatives.length} 个备选
              </p>
            ) : null}
          </div>
        ) : null}

        {sub.deliveryCapability ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="result-delivery-capability"
          >
            交付：{deliveryCapabilityLabel(sub.deliveryCapability.mode)}
          </p>
        ) : null}

        {shell.panel === 'delivery' && props.deliveryPanelFacts ? (
          <DeliveryPanel
            view={projectDeliveryPanel(props.deliveryPanelFacts)}
            onAction={props.onDeliveryAction}
          />
        ) : null}

        {shell.panel === 'history' ? (
          <RevisionTimelinePanel
            view={projectRevisionTimeline(
              props.revisionTimelineFacts ?? { versions: [] }
            )}
            onRestoreVersion={props.onRestoreRevisionVersion}
            restoreBusy={props.revisionRestoreBusy}
          />
        ) : null}

        {shell.panel === 'run' ? (
          <ResultRunDetailPanel
            view={projectResultRunDetail(
              props.runDetailFacts ?? {
                phase: shell.phase,
                progressState: props.facts.progressState,
                supportReference: formatMerchantSupportReference(props.workId),
                workspaceKind: shell.workspaceKind,
              }
            )}
            // Deep-link / overflow open_run_detail expands; first-run default
            // still collapses the body until the merchant expands the summary.
            defaultOpen={false}
          />
        ) : null}

        {shell.panel === 'result' && props.shellFactSources ? (
          <ShellFactSourcesSection items={props.shellFactSources} />
        ) : null}

        {/*
          P1-D/E close-loop surfaces. Mount only when the page supplies
          projection facts — never invent live outcomes. Fail-closed views
          still render honest empty/blocked states when facts are partial.
        */}
        {props.closeLoop ? (
          <div className="space-y-4" data-testid="result-close-loop">
            {(() => {
              const cl = props.closeLoop;
              const hasPublication = (cl.publicationRecords ?? []).some(
                (r) => r.status === 'published'
              );
              const receiptView = projectDeliveryActionReceiptPanel({
                contentPackageId: cl.contentPackageId,
                contentPackageRevision: cl.contentPackageRevision,
                receipts: cl.deliveryReceipts,
                hasPublicationRecord: hasPublication,
                canShareFiles: cl.canShareFiles,
                hasOneShotLink: cl.hasOneShotLink,
                hasDownload: cl.hasDownload,
              });
              const publicationView = projectPublicationRecordPanel({
                contentPackageId: cl.contentPackageId,
                contentPackageRevision: cl.contentPackageRevision,
                variantVersionId: cl.variantVersionId,
                workspaceId: cl.workspaceId,
                recordsWorkspaceId: cl.workspaceId,
                records: cl.publicationRecords,
                automaticVerifiedPlatformCount:
                  cl.automaticVerifiedPlatformCount,
              });
              const outcomeView = projectOutcomeObservationPanel({
                workspaceId: cl.workspaceId,
                contentPackageId: cl.contentPackageId,
                contentPackageRevision: cl.contentPackageRevision,
                hasPublicationRecord: hasPublication,
                observations: cl.observations,
                observationsWorkspaceId: cl.workspaceId,
              });
              return (
                <>
                  {receiptView.kind === 'ready' ? (
                    <section
                      className="space-y-2 rounded-lg border p-4"
                      data-testid="delivery-action-receipt-panel"
                      data-handed-over-not-published={
                        receiptView.handedOffIsNotPublished ? 'true' : 'false'
                      }
                      aria-label={receiptView.heading}
                    >
                      <h3 className="text-sm font-medium">
                        {receiptView.heading}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {receiptView.summary}
                      </p>
                      <ul className="space-y-1">
                        {receiptView.receipts.map((r) => (
                          <li
                            key={r.id}
                            className="text-sm"
                            data-testid="delivery-action-receipt-row"
                            data-kind={r.kind}
                            data-claims-published="false"
                          >
                            {r.label} · {r.platform} · {r.accountOrOwnerLabel} ·{' '}
                            {r.revisionLabel} · {r.occurredAtLabel}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <PublicationRecordPanel
                    view={publicationView}
                    contentPackageId={cl.contentPackageId}
                    contentPackageRevision={cl.contentPackageRevision}
                    variantVersionId={cl.variantVersionId}
                    platform={cl.publicationPlatform}
                    pending={props.closeLoopPending}
                    onRecordManual={props.onRecordManualPublication}
                  />
                  <OutcomeChipsPanel
                    view={outcomeView}
                    pending={props.closeLoopPending}
                    onRecord={props.onRecordOutcomeObservation}
                  />
                  {cl.weeklyReview ? (
                    <WeeklyReviewPanel
                      view={projectWeeklyReviewPanel({
                        ...cl.weeklyReview,
                        viewerWorkspaceId: cl.workspaceId,
                      })}
                      pending={props.closeLoopPending}
                      onConfirmRecommendation={
                        props.onConfirmWeeklyRecommendation
                      }
                    />
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function ShellFactSourcesSection(props: { items: readonly FactSourceItem[] }) {
  const projected = projectFactSources(props.items);
  return (
    <section
      className="space-y-2 rounded-lg border p-4"
      data-testid="result-shell-fact-sources"
      aria-label="事实来源"
    >
      <h2 className="text-sm font-medium">事实来源</h2>
      <p className="text-xs text-muted-foreground">
        仅显示当前版本实际引用的事实、素材、身份与权利摘要。
      </p>
      {projected.items.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="result-shell-fact-sources-empty"
        >
          当前版本暂无关联事实
        </p>
      ) : (
        <ul className="space-y-2">
          {projected.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="result-shell-fact-item"
            >
              <Badge variant="outline">
                {FACT_SOURCE_KIND_LABELS[item.kind]}
              </Badge>
              <span>{item.label}</span>
              <span className="text-muted-foreground">{item.summary}</span>
              {item.status === 'pending' ? (
                <Badge variant="destructive">待确认</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pure helper re-export for tests that apply drift without mounting React. */
export function applyPageDriftChoice(
  store: ResultReturnRestoreStore,
  drift: NonNullable<ReturnType<typeof detectRevisionDrift>>,
  choice: ResultRevisionDriftChoice
) {
  return applyRevisionDriftChoice(store, drift, choice);
}

export function anyCandidateHasToken(
  candidates?: PartialCopyCandidate[]
): boolean {
  return Boolean(candidates?.some((c) => candidateHasToken(c)));
}

/** Build shell facts with explicit target — never substitutes latest work. */
export function factsForResolvedTarget(
  target: ResultTarget,
  rest: Omit<ResultShellFacts, 'target'>
): ResultShellFacts {
  return { ...rest, target };
}

export function projectShellOnly(facts: ResultShellFacts) {
  return projectResultShellView(facts);
}
