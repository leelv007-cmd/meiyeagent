/**
 * Video Artifact — per-scene storyboard / keyframe (V31-15).
 *
 * No subtitle/cover status here: V31-37 path A (2026-08-11) — subtitles and
 * covers are not deliverables; publishing platforms own captions (#264).
 */

import { cn } from '@/lib/utils';
import type { VideoSceneState } from '@meiye/contracts';
import { projectMerchantMediaStatus } from '@/product/merchant-vocabulary';

import { ArtifactStatusLabel } from './artifact-status-label';

import { ArtifactMediaFrame } from './artifact-media';

export type VideoArtifactProps = {
  artifactId: string;
  revision: number;
  status: string;
  scenes: readonly VideoSceneState[];
  title?: string;
  summary?: string;
  viewingRevision?: number;
  className?: string;
};

export function VideoArtifact({
  artifactId,
  revision,
  status,
  scenes,
  title,
  summary,
  viewingRevision,
  className,
}: VideoArtifactProps) {
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="video"
      data-carrier="media"
      data-revision={revision}
      data-surface="artifact_video"
      data-testid="agent-artifact-video"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">
          {title?.trim() || '视频分镜'}
        </h3>
        <ArtifactStatusLabel status={status} />
      </header>
      {summary ? (
        <p className="text-muted text-xs leading-relaxed">{summary}</p>
      ) : null}
      <div data-testid="agent-artifact-video-shot-list">
        <ol
          className="flex flex-col gap-2"
          data-testid="agent-artifact-video-scenes"
        >
          {scenes.length === 0 ? (
            <li className="text-muted text-xs">等待分镜…</li>
          ) : (
            scenes.map((scene) => (
              <li
                className="border-border/50 bg-muted/20 rounded-md border px-3 py-2"
                data-keyframe-ref={scene.keyframeRef}
                data-keyframe-status={scene.keyframeStatus ?? 'pending'}
                data-scene-index={scene.sceneIndex}
                data-testid="agent-artifact-video-scene"
                key={scene.sceneIndex}
              >
                <p className="text-muted mb-1 text-xs">
                  场景 {scene.sceneIndex + 1}
                </p>
                {scene.storyboard ? (
                  <p
                    className="text-foreground text-xs leading-relaxed"
                    data-testid="agent-artifact-scene-storyboard"
                  >
                    分镜：{scene.storyboard}
                  </p>
                ) : (
                  <div
                    aria-hidden
                    className="bg-muted/60 h-8 animate-pulse rounded"
                  />
                )}
                <ul className="text-muted mt-2 space-y-0.5 text-[11px]">
                  <li data-testid="agent-artifact-scene-keyframe">
                    关键帧：{mediaLabel(scene.keyframeStatus)}
                  </li>
                </ul>
                <ArtifactMediaFrame
                  alt={`场景 ${scene.sceneIndex + 1} 关键帧`}
                  kind="keyframe"
                  mediaRef={scene.keyframeRef}
                  status={scene.keyframeStatus ?? 'pending'}
                  testId="agent-artifact-scene-keyframe-media"
                />
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}

function mediaLabel(status: VideoSceneState['keyframeStatus']): string {
  if (!status) return '待生成';
  return projectMerchantMediaStatus(status);
}
