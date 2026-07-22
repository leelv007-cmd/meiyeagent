/** Video Result Center worksurface (WT-E / #104). */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';

import {
  adoptComposedFilm,
  buildVideoProStudioRefineHandoff,
  editSubtitleText,
  merchantShotLabel,
  projectVideoMobileP0Actions,
  reorderShots,
  requestFullRecompose,
  requestShotRegen,
  selectShotCandidate,
  setCoverFromFrame,
  togglePlay,
  toggleSubtitleEnabled,
  type VideoEditFeeDecision,
  type VideoProStudioRefineHandoff,
  type VideoWorksurfaceState,
} from './video-worksurface-model';

export type VideoRegenerationQuoteRequest = {
  scope: 'shot' | 'full_compose';
  sourceRunId: string;
  shotId?: string;
};

export type VideoRegenerationServerQuote = {
  confirm: {
    actionLabel: string;
    authorizedCeiling: number;
    billingModeLabel: string;
    createsNewTaskAndIndependentQuote: true;
    createsNewTaskNotice: string;
    estimatedCredits: number;
    eta: {
      estimatedCompletionAt: string | null;
      honestyNote: string;
      status: string;
    };
    formulaExpression: string;
    quoteId: string;
    quoteRevision: string;
    scope: 'shot' | 'full_compose';
    targetSeconds: number;
  };
  quote: { formula: { currency?: string } };
  scope: 'shot' | 'full_compose';
};

export type VideoCanonicalEditCommand =
  | {
      kind: 'select_candidate';
      workflowId: string;
      expectedRevision: number;
      shotId: string;
      candidateIndex: number;
    }
  | {
      kind: 'reorder_shots';
      workflowId: string;
      expectedRevision: number;
      shotIds: string[];
    }
  | {
      kind: 'set_subtitle';
      workflowId: string;
      expectedRevision: number;
      text: string;
    };

export type VideoWorksurfaceProps = {
  initialState: VideoWorksurfaceState;
  viewport?: 'desktop' | 'mobile';
  onStateChange?: (state: VideoWorksurfaceState) => void;
  onSubtitleChange?: (text: string, fee: VideoEditFeeDecision) => void;
  onAdopt?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onDeliver?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onRequestRegenerationQuote?: (
    request: VideoRegenerationQuoteRequest
  ) => Promise<VideoRegenerationServerQuote>;
  onConfirmRegeneration?: (input: {
    quoteId: string;
    taskId: string;
  }) => Promise<void>;
  onCanonicalEdit?: (command: VideoCanonicalEditCommand) => Promise<void>;
  onOpenProStudio?: (handoff: VideoProStudioRefineHandoff) => void;
};

function videoMerchantStatusLabel(
  phase: VideoWorksurfaceState['loopPhase']
): string {
  switch (phase) {
    case 'running':
      return '成片生成中';
    case 'candidate_ready':
      return '成片待确认';
    case 'adopted':
      return '已采用，待交付';
    case 'delivered':
      return '已交付';
    case 'failed':
      return '生成失败';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function VideoWorksurface(props: VideoWorksurfaceProps) {
  const [state, setState] = useState(props.initialState);
  const [serverQuote, setServerQuote] =
    useState<VideoRegenerationServerQuote | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const regenerationTaskIds = useRef(new Map<string, string>());
  const canonicalEditsLocked =
    state.workflowStatus === 'completed' ||
    state.workflowStatus === 'cancelled' ||
    state.workflowStatus === 'failed';

  useEffect(() => setState(props.initialState), [props.initialState]);

  const update = (next: VideoWorksurfaceState) => {
    setState(next);
    props.onStateChange?.(next);
  };
  const mobile = projectVideoMobileP0Actions(state);
  const requestServerQuote = async (request: VideoRegenerationQuoteRequest) => {
    setServerQuote(null);
    setCommandError(null);
    if (!props.onRequestRegenerationQuote) return;
    setQuotePending(true);
    try {
      setServerQuote(await props.onRequestRegenerationQuote(request));
    } catch {
      setCommandError('暂时无法获取报价，请稍后重试。');
    } finally {
      setQuotePending(false);
    }
  };
  const persistCanonicalEdit = async (
    command: VideoCanonicalEditCommand,
    next: VideoWorksurfaceState
  ) => {
    setCommandError(null);
    if (!props.onCanonicalEdit) {
      update(next);
      return;
    }
    const previous = state;
    update(next);
    setCommandPending(true);
    try {
      await props.onCanonicalEdit(command);
    } catch {
      update(previous);
      setCommandError('视频修改暂未保存，请稍后重试。');
    } finally {
      setCommandPending(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="video-worksurface">
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="video-result-status">
          {videoMerchantStatusLabel(state.loopPhase)}
        </Badge>
        <Badge variant="outline">第 {state.storyboardVersion} 版分镜</Badge>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">成片预览</h3>
        <div
          className="overflow-hidden rounded-lg bg-black"
          data-testid="video-player"
        >
          {state.composedCandidate ? (
            <video
              ref={playerRef}
              className="aspect-[9/16] max-h-[32rem] w-full object-contain"
              controls
              poster={state.cover.posterUrl ?? undefined}
              src={state.composedCandidate.playableUrl}
            >
              <track
                default={state.subtitle.enabled}
                kind="captions"
                src={
                  state.player.subtitleTrackUrl ??
                  'data:text/vtt;charset=utf-8,WEBVTT'
                }
                srcLang="zh"
                label="中文字幕"
              />
            </video>
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-white/70">
              成片生成中…
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!state.composedCandidate}
          data-testid="video-toggle-play"
          onClick={async () => {
            const media = playerRef.current;
            if (state.player.playing) {
              media?.pause();
              update(togglePlay(state));
              return;
            }
            if (media) await media.play();
            update(togglePlay(state));
          }}
        >
          {state.player.playing ? '暂停' : '播放'}
        </Button>
      </section>

      <section
        className="space-y-3 rounded-lg border p-4"
        data-testid="video-cover-panel"
      >
        <h3 className="text-sm font-medium">封面</h3>
        {state.cover.posterUrl ? (
          <img
            className="aspect-video w-full max-w-sm rounded-md object-cover"
            src={state.cover.posterUrl}
            alt="当前视频封面"
          />
        ) : (
          <p className="text-sm text-muted-foreground">尚未选择封面</p>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!state.composedCandidate}
          data-testid="video-cover-current-frame"
          onClick={() =>
            update(
              setCoverFromFrame(
                state,
                playerRef.current?.currentTime ??
                  state.player.currentTimeSeconds
              ).state
            )
          }
        >
          使用当前帧
        </Button>
      </section>

      <section
        className="space-y-3 rounded-lg border p-4"
        data-testid="video-subtitle-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">字幕校对</h3>
          <Badge variant="outline">
            {state.subtitle.mode === 'independent_asset'
              ? '独立字幕资产 · 免费修改'
              : '烧录字幕 · 需重新合成'}
          </Badge>
        </div>
        <textarea
          className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
          disabled={
            canonicalEditsLocked && state.subtitle.mode === 'independent_asset'
          }
          value={state.subtitle.text}
          data-testid="video-subtitle-input"
          onChange={(event) => {
            const result = editSubtitleText(state, event.target.value);
            update(result.state);
            props.onSubtitleChange?.(event.target.value, result.fee);
            if (
              result.fee.fee === 'billable' &&
              !quotePending &&
              !serverQuote
            ) {
              void requestServerQuote({
                scope: 'full_compose',
                sourceRunId: state.workflowId,
              });
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={
            commandPending ||
            canonicalEditsLocked ||
            state.subtitle.mode !== 'independent_asset' ||
            state.subtitle.draftText === null ||
            !props.onCanonicalEdit
          }
          data-testid="video-subtitle-save"
          onClick={() =>
            void persistCanonicalEdit(
              {
                kind: 'set_subtitle',
                workflowId: state.workflowId,
                expectedRevision: state.workflowRevision,
                text: state.subtitle.text,
              },
              state
            )
          }
        >
          保存字幕
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="video-subtitle-toggle"
          disabled={commandPending}
          onClick={() => {
            const result = toggleSubtitleEnabled(state);
            if (result.fee.fee === 'billable') {
              update(result.state);
              void requestServerQuote({
                scope: 'full_compose',
                sourceRunId: state.workflowId,
              });
              return;
            }
            update(result.state);
          }}
        >
          {state.subtitle.enabled ? '隐藏字幕' : '显示字幕'}
        </Button>
      </section>

      <section
        className="space-y-3 rounded-lg border p-4"
        data-testid="video-storyboard"
      >
        <h3 className="text-sm font-medium">分镜候选</h3>
        <ol className="space-y-3">
          {state.storyboard.map((shot, shotIndex) => (
            <li
              key={shot.shotId}
              className="space-y-2 rounded-md border p-3"
              data-testid="video-shot"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p
                    className="text-sm font-medium"
                    data-testid="video-shot-label"
                  >
                    {merchantShotLabel({
                      order: shotIndex,
                      promptPreview: shot.promptPreview,
                      shotId: shot.shotId,
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="video-shot-regenerate"
                  disabled={quotePending || commandPending}
                  onClick={() => {
                    const result = requestShotRegen(state, shot.shotId);
                    update(result.state);
                    void requestServerQuote({
                      scope: 'shot',
                      shotId: shot.shotId,
                      sourceRunId: state.workflowId,
                    });
                  }}
                >
                  重新生成此镜头
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {shot.candidates.map((candidate) => (
                  <Button
                    key={candidate.index}
                    type="button"
                    size="sm"
                    variant={candidate.selected ? 'default' : 'outline'}
                    aria-pressed={candidate.selected}
                    data-testid="video-shot-candidate"
                    disabled={commandPending || canonicalEditsLocked}
                    onClick={() => {
                      const result = selectShotCandidate(
                        state,
                        shot.shotId,
                        candidate.index
                      );
                      void persistCanonicalEdit(
                        {
                          candidateIndex: candidate.index,
                          expectedRevision: state.workflowRevision,
                          kind: 'select_candidate',
                          shotId: shot.shotId,
                          workflowId: state.workflowId,
                        },
                        result.state
                      );
                    }}
                  >
                    候选 {candidate.index + 1}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={canonicalEditsLocked || shotIndex === 0}
                  aria-label={`前移镜头 ${shotIndex + 1}`}
                  onClick={() => {
                    const ids = state.storyboard.map((item) => item.shotId);
                    [ids[shotIndex - 1], ids[shotIndex]] = [
                      ids[shotIndex]!,
                      ids[shotIndex - 1]!,
                    ];
                    const result = reorderShots(state, ids);
                    void persistCanonicalEdit(
                      {
                        expectedRevision: state.workflowRevision,
                        kind: 'reorder_shots',
                        shotIds: ids,
                        workflowId: state.workflowId,
                      },
                      result.state
                    );
                  }}
                >
                  前移
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={
                    canonicalEditsLocked ||
                    shotIndex === state.storyboard.length - 1
                  }
                  aria-label={`后移镜头 ${shotIndex + 1}`}
                  onClick={() => {
                    const ids = state.storyboard.map((item) => item.shotId);
                    [ids[shotIndex], ids[shotIndex + 1]] = [
                      ids[shotIndex + 1]!,
                      ids[shotIndex]!,
                    ];
                    const result = reorderShots(state, ids);
                    void persistCanonicalEdit(
                      {
                        expectedRevision: state.workflowRevision,
                        kind: 'reorder_shots',
                        shotIds: ids,
                        workflowId: state.workflowId,
                      },
                      result.state
                    );
                  }}
                >
                  后移
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          disabled={quotePending || commandPending}
          data-testid="video-full-recompose"
          onClick={() => {
            const result = requestFullRecompose(state);
            update(result.state);
            void requestServerQuote({
              scope: 'full_compose',
              sourceRunId: state.workflowId,
            });
          }}
        >
          重新合成整段
        </Button>
      </section>

      {state.pendingQuote ? (
        <section
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
          data-testid="video-regen-confirm"
        >
          <p className="text-sm font-medium">
            {state.pendingQuote.actionLabel}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotePending
              ? '正在获取服务端报价…'
              : serverQuote
                ? serverQuote.confirm.createsNewTaskNotice
                : '等待服务端报价，不会先行执行。'}
          </p>
          {serverQuote ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                预估
                {serverQuote.quote.formula.currency === 'CNY' ? '¥' : ''}
                {serverQuote.confirm.estimatedCredits.toFixed(2)}
                {' · '}
                最高授权
                {serverQuote.quote.formula.currency === 'CNY' ? '¥' : ''}
                {serverQuote.confirm.authorizedCeiling.toFixed(2)}
              </p>
              <p className="text-muted-foreground">
                {serverQuote.confirm.billingModeLabel}
              </p>
              <p className="text-muted-foreground">
                {serverQuote.confirm.eta.honestyNote}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={commandPending || !props.onConfirmRegeneration}
                  data-testid="video-regen-confirm-action"
                  onClick={async () => {
                    if (!props.onConfirmRegeneration) return;
                    const quoteId = serverQuote.confirm.quoteId;
                    const taskId =
                      regenerationTaskIds.current.get(quoteId) ??
                      `video-regen-${crypto.randomUUID()}`;
                    regenerationTaskIds.current.set(quoteId, taskId);
                    setCommandPending(true);
                    setCommandError(null);
                    update({ ...state, pendingQuote: null });
                    try {
                      await props.onConfirmRegeneration({
                        quoteId,
                        taskId,
                      });
                      regenerationTaskIds.current.delete(quoteId);
                      setServerQuote(null);
                    } catch {
                      update(state);
                      setCommandError(
                        '视频重生成暂时不可用。费用以报价确认页和账单记录为准，请稍后重试。'
                      );
                    } finally {
                      setCommandPending(false);
                    }
                  }}
                >
                  确认并创建新任务
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={commandPending}
                  data-testid="video-regen-cancel-action"
                  onClick={() => {
                    regenerationTaskIds.current.delete(
                      serverQuote.confirm.quoteId
                    );
                    setServerQuote(null);
                    update({ ...state, pendingQuote: null });
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {commandError ? (
        <p className="text-sm text-destructive" role="alert">
          {commandError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="video-result-actions">
        {state.loopPhase === 'candidate_ready' ? (
          <Button
            type="button"
            disabled={!state.composedCandidate || !props.onAdopt}
            data-testid="video-adopt-action"
            onClick={async () => {
              const result = adoptComposedFilm(state, {
                contentPackageId: state.contentId ?? `content-${state.workId}`,
              });
              if (!props.onAdopt) return;
              await props.onAdopt(result.state);
              update(result.state);
            }}
          >
            使用此成片
          </Button>
        ) : null}
        {state.loopPhase === 'adopted' ? (
          <Button
            type="button"
            disabled={!props.onDeliver}
            data-testid="video-deliver-action"
            onClick={() => props.onDeliver?.(state)}
          >
            交付
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={!props.onOpenProStudio}
          data-testid="video-pro-studio-refine"
          onClick={() =>
            props.onOpenProStudio?.(buildVideoProStudioRefineHandoff(state))
          }
        >
          到 Pro Studio 精修
        </Button>
      </div>

      {props.viewport === 'mobile' ? (
        <div
          className="sr-only"
          data-testid="video-mobile-p0"
          data-requires-desktop={String(mobile.requiresDesktopContinue)}
        >
          {mobile.mediaActions.map((action) => action.label).join('、')}
        </div>
      ) : null}
    </div>
  );
}
