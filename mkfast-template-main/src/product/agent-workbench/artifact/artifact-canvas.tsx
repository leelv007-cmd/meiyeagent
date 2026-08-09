/**
 * Right-rail Artifact canvas — stable-id in-place growth (V31-15 / §5.5 / §27.5).
 * Renders one card per artifactId; never stacks duplicate objects.
 */

import { cn } from '@/lib/utils';

import type { ArtifactFullBody } from '@meiye/contracts';

import {
  resolveArtifactViewBody,
  type ArtifactProjection,
} from '../agent-event-reducer';
import { resolveControlledSurface } from '../controlled-surface-registry';
import './artifact-registry';
import { CopyArtifact } from './copy-artifact';
import { NoteArtifact } from './note-artifact';
import { PublishArtifact } from './publish-artifact';
import { VideoArtifact } from './video-artifact';

export type ArtifactCanvasProps = {
  artifacts: readonly ArtifactProjection[];
  viewport?: 'mobile' | 'desktop';
  onViewRevision?: (artifactId: string, revision: number | null) => void;
  className?: string;
};

export function ArtifactCanvas({
  artifacts,
  viewport = 'desktop',
  onViewRevision,
  className,
}: ArtifactCanvasProps) {
  const gate = resolveControlledSurface({
    surface: 'artifact_canvas',
    props: {
      artifactCount: artifacts.length,
      viewport,
    },
  });
  if (!gate.ok) return null;

  if (artifacts.length === 0) {
    return (
      <div
        className={cn(
          'text-muted border-border/40 rounded-lg border border-dashed px-3 py-6 text-center text-xs',
          className
        )}
        data-testid="agent-artifact-canvas-empty"
        data-viewport={viewport}
      >
        作品将在这里原位生长
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      data-artifact-count={artifacts.length}
      data-surface="artifact_canvas"
      data-testid="agent-artifact-canvas"
      data-viewport={viewport}
    >
      {artifacts.map((artifact) => (
        <ArtifactCard
          artifact={artifact}
          key={artifact.artifactId}
          onViewRevision={onViewRevision}
        />
      ))}
    </div>
  );
}

function ArtifactCard({
  artifact,
  onViewRevision,
}: {
  artifact: ArtifactProjection;
  onViewRevision?: (artifactId: string, revision: number | null) => void;
}) {
  const body = resolveArtifactViewBody(artifact);
  const viewingRevision = artifact.viewingRevision ?? artifact.revision;

  return (
    <article
      className="border-border/50 bg-background rounded-lg border p-3 shadow-sm"
      data-artifact-id={artifact.artifactId}
      data-artifact-type={artifact.artifactType}
      data-revision={artifact.revision}
      data-testid="agent-artifact-card"
    >
      <ArtifactBodyView
        artifact={artifact}
        body={body}
        viewingRevision={viewingRevision}
      />
      {artifact.versionHistory.length > 0 ? (
        <VersionBrowser
          artifact={artifact}
          onViewRevision={onViewRevision}
          viewingRevision={viewingRevision}
        />
      ) : null}
    </article>
  );
}

function ArtifactBodyView({
  artifact,
  body,
  viewingRevision,
}: {
  artifact: ArtifactProjection;
  body: ArtifactFullBody;
  viewingRevision: number;
}) {
  const common = {
    artifactId: artifact.artifactId,
    revision: artifact.revision,
    status: artifact.status,
    summary: artifact.summary,
    viewingRevision,
  };

  switch (artifact.artifactType) {
    case 'note':
      return (
        <NoteArtifact {...common} pages={'pages' in body ? body.pages : []} />
      );
    case 'video':
      return (
        <VideoArtifact
          {...common}
          scenes={'scenes' in body ? body.scenes : []}
          title={'title' in body ? body.title : undefined}
        />
      );
    case 'copy':
      return (
        <CopyArtifact
          {...common}
          blocks={'blocks' in body ? body.blocks : []}
        />
      );
    case 'publish':
      return (
        <PublishArtifact
          {...common}
          items={'items' in body ? body.items : []}
        />
      );
    case 'plan':
      return (
        <GenericTypedArtifact
          {...common}
          artifactType="plan"
          lines={
            'sections' in body
              ? body.sections.map(
                  (section) =>
                    section.title ?? section.body ?? section.sectionId
                )
              : []
          }
        />
      );
    case 'image':
      return (
        <GenericTypedArtifact
          {...common}
          artifactType="image"
          lines={[
            `配图：${'imageStatus' in body ? body.imageStatus : 'pending'}`,
            'caption' in body && body.caption ? body.caption : '',
          ].filter(Boolean)}
        />
      );
    default: {
      const _exhaustive: never = artifact.artifactType;
      void _exhaustive;
      return null;
    }
  }
}

function GenericTypedArtifact({
  artifactId,
  artifactType,
  revision,
  status,
  summary,
  lines,
}: {
  artifactId: string;
  artifactType: 'plan' | 'image';
  revision: number;
  status: string;
  summary?: string;
  lines: string[];
}) {
  const surface = artifactType === 'plan' ? 'artifact_plan' : 'artifact_image';
  const gate = resolveControlledSurface({
    surface,
    props: {
      artifactId,
      artifactType,
      revision,
      status,
      summary,
    },
  });
  if (!gate.ok) return null;
  return (
    <section
      data-artifact-id={artifactId}
      data-artifact-type={artifactType}
      data-surface={surface}
      data-testid={`agent-artifact-${artifactType}`}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">
          {artifactType === 'plan' ? '方案' : '图片'}
        </h3>
        <span className="text-muted text-[10px] uppercase">{status}</span>
      </header>
      {summary ? <p className="text-muted mb-2 text-xs">{summary}</p> : null}
      <ul className="text-foreground space-y-1 text-xs">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function VersionBrowser({
  artifact,
  viewingRevision,
  onViewRevision,
}: {
  artifact: ArtifactProjection;
  viewingRevision: number;
  onViewRevision?: (artifactId: string, revision: number | null) => void;
}) {
  const options = [
    ...artifact.versionHistory.map((entry) => entry.revision),
    artifact.revision,
  ];
  const unique = [...new Set(options)].sort((a, b) => a - b);

  return (
    <div
      className="border-border/40 mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2"
      data-testid="agent-artifact-version-browser"
    >
      <span className="text-muted mr-1 text-[11px]">版本</span>
      {unique.map((rev) => {
        const selected = rev === viewingRevision;
        const isLive = rev === artifact.revision;
        return (
          <button
            aria-pressed={selected}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              selected
                ? 'bg-foreground text-background'
                : 'bg-muted/50 text-muted hover:text-foreground'
            )}
            data-revision={rev}
            data-testid="agent-artifact-version-chip"
            key={rev}
            onClick={() =>
              onViewRevision?.(artifact.artifactId, isLive ? null : rev)
            }
            type="button"
          >
            r{rev}
            {isLive ? ' · 当前' : ''}
          </button>
        );
      })}
    </div>
  );
}
