/** Video Result Center worksurface (WT-E / #104). */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';

import {
  adoptComposedFilm,
  merchantShotLabel,
  projectVideoMobileP0Actions,
  reorderShots,
  selectShotCandidate,
  togglePlay,
  type VideoWorksurfaceState,
} from './video-worksurface-model';

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
    };

export type VideoWorksurfaceProps = {
  initialState: VideoWorksurfaceState;
  viewport?: 'desktop' | 'mobile';
  onStateChange?: (state: VideoWorksurfaceState) => void;
  onAdopt?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onDeliver?: (state: VideoWorksurfaceState) => void | Promise<void>;
  onCanonicalEdit?: (command: VideoCanonicalEditCommand) => Promise<void>;
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
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
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
            // biome-ignore lint/a11y/useMediaCaption: #264 retires the product-owned subtitle track; publishing platforms own captions.
            <video
              ref={playerRef}
              className="aspect-[9/16] max-h-[32rem] w-full object-contain"
              controls
              poster={state.composedCandidate.posterUrl}
              src={state.composedCandidate.playableUrl}
            />
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
              <p className="text-sm font-medium" data-testid="video-shot-label">
                {merchantShotLabel({
                  order: shotIndex,
                  promptPreview: shot.promptPreview,
                  shotId: shot.shotId,
                })}
              </p>
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
      </section>

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
