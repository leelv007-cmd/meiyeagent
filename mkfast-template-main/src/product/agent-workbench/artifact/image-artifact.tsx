/**
 * Image Artifact — in-place media growth from imageRef (ART-01 / V31-15).
 */

import { cn } from '@/lib/utils';

import { ArtifactMediaFrame } from './artifact-media';

export type ImageArtifactProps = {
  artifactId: string;
  revision: number;
  status: string;
  imageStatus: 'pending' | 'generating' | 'ready' | 'failed';
  imageRef?: string;
  caption?: string;
  summary?: string;
  viewingRevision?: number;
  className?: string;
};

export function ImageArtifact({
  artifactId,
  revision,
  status,
  imageStatus,
  imageRef,
  caption,
  summary,
  viewingRevision,
  className,
}: ImageArtifactProps) {
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="image"
      data-carrier="media"
      data-revision={revision}
      data-surface="artifact_image"
      data-testid="agent-artifact-image"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">图片</h3>
        <span
          className="text-muted bg-muted/50 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
          data-testid="agent-artifact-status"
        >
          {status}
        </span>
      </header>
      {summary ? (
        <p className="text-muted text-xs leading-relaxed">{summary}</p>
      ) : null}
      {caption ? (
        <p className="text-foreground text-xs leading-relaxed">{caption}</p>
      ) : null}
      <ArtifactMediaFrame
        alt={caption?.trim() || '配图'}
        mediaRef={imageRef}
        status={imageStatus}
        testId="agent-artifact-image-media"
      />
    </section>
  );
}
