/**
 * Authorized display URL from Artifact imageRef / keyframeRef.
 * Never invent a URL from a bare asset id.
 */

import { cn } from '@/lib/utils';

export function isArtifactMediaDisplayUrl(ref: string): boolean {
  return /^(https?:|data:|blob:|\/)/iu.test(ref.trim());
}

export type ArtifactMediaKind = 'image' | 'keyframe';

export type ArtifactMediaFrameProps = {
  mediaRef?: string;
  alt: string;
  status?: 'pending' | 'generating' | 'ready' | 'failed';
  testId: string;
  kind?: ArtifactMediaKind;
  className?: string;
};

export function ArtifactMediaFrame({
  mediaRef,
  alt,
  status,
  testId,
  kind = 'image',
  className,
}: ArtifactMediaFrameProps) {
  const displayUrl =
    mediaRef && isArtifactMediaDisplayUrl(mediaRef)
      ? mediaRef.trim()
      : undefined;
  const stage = status ?? 'pending';

  if (displayUrl) {
    return (
      <img
        alt={alt}
        className={cn(
          'mt-2 w-full rounded-md object-cover',
          kind === 'keyframe' ? 'aspect-[9/16]' : 'aspect-[3/4]',
          className
        )}
        data-image-ref={kind === 'image' ? mediaRef : undefined}
        data-keyframe-ref={kind === 'keyframe' ? mediaRef : undefined}
        data-testid={testId}
        src={displayUrl}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        'text-muted bg-muted/40 mt-2 flex items-center justify-center rounded-md text-[11px]',
        kind === 'keyframe' ? 'aspect-[9/16]' : 'aspect-[3/4]',
        stage === 'generating' ? 'animate-pulse' : null,
        className
      )}
      data-image-ref={kind === 'image' ? mediaRef : undefined}
      data-image-status={kind === 'image' ? stage : undefined}
      data-keyframe-ref={kind === 'keyframe' ? mediaRef : undefined}
      data-keyframe-status={kind === 'keyframe' ? stage : undefined}
      data-testid={`${testId}-placeholder`}
    >
      {stage === 'generating'
        ? '生成中'
        : stage === 'failed'
          ? '失败'
          : stage === 'ready'
            ? '已就绪'
            : '待生成'}
    </div>
  );
}
