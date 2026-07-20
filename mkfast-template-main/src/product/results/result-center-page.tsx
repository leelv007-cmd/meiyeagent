/**
 * Result Center page shell (WT-D1 / #99 + WT-D2 / #100).
 *
 * Mounts pure ResultShellModel projection + token stream running state +
 * copy/image_text and image worksurfaces. Video workspace stubs for E3.
 * Delivery panel lands in D3.
 */

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  ResultAction,
  ResultShellModel,
  ResultTarget,
  ResultTargetResolveOutcome,
  ResultWorkspaceKind,
} from '@meiye/contracts';

import { AdjustPrompt } from './adjust-prompt';
import { CopyImageTextWorksurface } from './copy-image-text-worksurface';
import type { CopyImageTextWorksurfaceFacts } from './copy-image-text-worksurface-model';
import { ImageWorksurface } from './image-worksurface';
import type { ImageWorksurfaceFacts } from './image-worksurface-model';
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
import type { ResultRevisionDriftChoice } from '@meiye/contracts';
import { DeliveryPanel } from './delivery-panel';
import {
  projectDeliveryPanel,
  type DeliveryPanelFacts,
} from './delivery-panel-model';

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
  onAction?: (action: ResultAction, shell: ResultShellModel) => void;
  onDriftChoice?: (choice: ResultRevisionDriftChoice) => void;
  onAdjust?: (instruction: string) => void;
  onBack?: () => void;
  /** Optional delivery panel facts when shell.panel === 'delivery'. */
  deliveryPanelFacts?: DeliveryPanelFacts;
};

function errorPanelKind(
  code: Extract<ResultShellView, { kind: 'error' }>['code'],
): 'error' | 'permission-denied' | 'empty' {
  if (code === 'FORBIDDEN') return 'permission-denied';
  if (code === 'NOT_FOUND') return 'empty';
  return 'error';
}

function errorTitle(
  code: Extract<ResultShellView, { kind: 'error' }>['code'],
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

function WorkspaceBody(props: {
  workspaceKind: ResultWorkspaceKind;
  copyWorksurface?: ResultCenterPageProps['copyWorksurface'];
  imageWorksurface?: ResultCenterPageProps['imageWorksurface'];
  onAdjust?: (instruction: string) => void;
  /** Fallback document when copy worksurface facts are not yet wired. */
  fallbackCopy?: CopyImageTextWorksurfaceFacts;
}) {
  if (props.workspaceKind === 'video') {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
        data-testid="result-video-workspace-stub"
      >
        视频工作面将由 E3 接入 Result Center。
      </div>
    );
  }
  if (props.workspaceKind === 'image') {
    if (props.imageWorksurface) {
      return (
        <ImageWorksurface
          facts={props.imageWorksurface}
          onAdjust={props.onAdjust}
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
      <CopyImageTextWorksurface facts={copyFacts} onAdjust={props.onAdjust} />
    );
  }
  return (
    <div
      className="space-y-3 rounded-lg border border-dashed p-6"
      data-testid="result-copy-workspace-empty"
    >
      <p className="text-sm text-muted-foreground">等待文案候选…</p>
      <AdjustPrompt onSubmit={props.onAdjust} />
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
  >,
): {
  view: ResultShellView;
  tokenStream: ReturnType<typeof projectResultTokenStream>;
  drift: ReturnType<typeof detectRevisionDrift>;
} {
  const view = shellViewFromResolveOutcome(props.resolveOutcome, props.facts);
  const workspaceKind = props.facts.workspaceKind ?? 'copy';
  const tokenStream = projectResultTokenStream({
    workspaceKind:
      workspaceKind === 'copy'
        ? 'copy'
        : workspaceKind === 'image'
          ? 'image'
          : 'video',
    progressState: props.facts.progressState,
    partialCandidates: props.partialCandidates,
    loading: props.streamLoading,
    completed: props.facts.progressState === 'success',
  });

  let drift: ReturnType<typeof detectRevisionDrift> = null;
  if (
    props.restoreStore &&
    props.currentRevisionId &&
    view.kind === 'ready'
  ) {
    const key = Object.keys(props.restoreStore.drafts)[0];
    if (key) {
      // Prefer explicit uncommitted key from facts target + revision.
      const snapshot =
        props.restoreStore.byWorkId[
          view.shell.target.workId
        ];
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

  if (view.kind === 'error') {
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
          description={view.message}
          actionLabel={props.onBack ? '返回' : undefined}
          onAction={props.onBack}
        >
          <p
            className="text-xs text-muted-foreground"
            data-testid="result-center-error-code"
            data-error-code={view.code}
          >
            {view.code}
            {view.requested.workId
              ? ` · workId=${view.requested.workId}`
              : ''}
          </p>
        </StatePanel>
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
      description={`Work ${shell.target.workId}`}
      title="结果中心"
    >
      <div
        className="space-y-4"
        data-testid="result-center-shell"
        data-work-id={props.workId}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-testid="result-shell-phase" data-phase={shell.phase}>
            {shell.phase}
          </Badge>
          <Badge variant="outline" data-testid="result-shell-panel">
            {shell.panel}
          </Badge>
          <Badge variant="outline" data-testid="result-shell-workspace">
            {shell.workspaceKind}
          </Badge>
        </div>

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
              本地草稿基于 {drift.baseRevisionId}，当前为{' '}
              {drift.currentRevisionId}。请选择恢复、对比或丢弃。
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

        <div className="flex flex-wrap gap-2" data-testid="result-shell-actions">
          {actions.primary ? (
            <Button
              type="button"
              data-testid="result-primary-action"
              data-action-id={actions.primary.id}
              disabled={!actions.primary.enabled}
              onClick={() => props.onAction?.(actions.primary!, shell)}
            >
              {actions.primary.label}
            </Button>
          ) : null}
          {actions.secondary.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              data-testid="result-secondary-action"
              data-action-id={item.id}
              disabled={!item.enabled}
              onClick={() => props.onAction?.(item, shell)}
            >
              {item.label}
            </Button>
          ))}
          {actions.more.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="result-more-actions"
            >
              更多
            </Button>
          ) : null}
        </div>

        {showCopyStream ? (
          <section
            data-testid="result-token-stream"
            data-has-first-token={tokenStream.hasFirstToken ? 'true' : 'false'}
            data-streaming={props.streamLoading ? 'true' : 'false'}
          >
            <div className="grid gap-3 lg:grid-cols-3">
              {tokenStream.slots.map((slot) => (
                <div
                  key={slot.index}
                  className="rounded-lg border p-3"
                  data-testid="copy-stream-slot"
                  data-has-token={slot.hasToken ? 'true' : 'false'}
                >
                  <p className="text-xs text-muted-foreground">
                    候选 {slot.index + 1}
                  </p>
                  <p className="min-h-6 font-medium">
                    {slot.title || (props.streamLoading ? '生成中…' : '待生成')}
                  </p>
                  <p className="mt-2 min-h-16 text-sm text-muted-foreground">
                    {slot.body ||
                      (props.streamLoading ? '正文生成中…' : '正文待生成')}
                  </p>
                  <p className="mt-2 rounded-md bg-muted px-2 py-1 text-sm">
                    {slot.conversionHook ||
                      (props.streamLoading ? '转化语生成中…' : '转化语待生成')}
                  </p>
                </div>
              ))}
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
            onAdjust={props.onAdjust}
          />
        )}

        {sub.candidates ? (
          <div data-testid="result-harness-candidates" className="text-sm">
            <p>
              推荐候选{' '}
              <span className="font-medium">{sub.candidates.primary.title}</span>
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
            data-mode={sub.deliveryCapability.mode}
          >
            交付能力：{sub.deliveryCapability.mode}
          </p>
        ) : null}

        {shell.panel === 'delivery' && props.deliveryPanelFacts ? (
          <DeliveryPanel
            view={projectDeliveryPanel(props.deliveryPanelFacts)}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}

/** Pure helper re-export for tests that apply drift without mounting React. */
export function applyPageDriftChoice(
  store: ResultReturnRestoreStore,
  drift: NonNullable<ReturnType<typeof detectRevisionDrift>>,
  choice: ResultRevisionDriftChoice,
) {
  return applyRevisionDriftChoice(store, drift, choice);
}

export function anyCandidateHasToken(
  candidates?: PartialCopyCandidate[],
): boolean {
  return Boolean(candidates?.some((c) => candidateHasToken(c)));
}

/** Build shell facts with explicit target — never substitutes latest work. */
export function factsForResolvedTarget(
  target: ResultTarget,
  rest: Omit<ResultShellFacts, 'target'>,
): ResultShellFacts {
  return { ...rest, target };
}

export function projectShellOnly(facts: ResultShellFacts) {
  return projectResultShellView(facts);
}
