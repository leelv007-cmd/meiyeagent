/**
 * Right-rail Artifact canvas — stable-id in-place growth (V31-15 / §5.5 / §27.5).
 * Renders one card per artifactId; never stacks duplicate objects.
 */

import { agent_artifact_canvas_empty } from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import type { ArtifactFullBody } from '@meiye/contracts';
import {
  projectMerchantMediaStatus,
  projectMerchantRevision,
} from '@/product/merchant-vocabulary';

import {
  resolveArtifactViewBody,
  type ArtifactProjection,
} from '../agent-event-reducer';
import { ArtifactStatusLabel } from './artifact-status-label';
import { artifactContentCarrierOf } from './artifact-carrier';
import { CopyArtifact } from './copy-artifact';
import { ImageArtifact } from './image-artifact';
import { NoteArtifact } from './note-artifact';
import { PublishArtifact } from './publish-artifact';
import { VideoArtifact } from './video-artifact';

export type ArtifactCanvasProps = {
  artifacts: readonly ArtifactProjection[];
  viewport?: 'mobile' | 'desktop';
  onViewRevision?: (artifactId: string, revision: number | null) => void;
  className?: string;
  /** Idle workbench has no content expected — hide the placeholder. */
  showEmpty?: boolean;
};

export function ArtifactCanvas({
  artifacts,
  viewport = 'desktop',
  onViewRevision,
  className,
  showEmpty = true,
}: ArtifactCanvasProps) {
  if (artifacts.length === 0) {
    if (!showEmpty) return null;
    return (
      <div
        className={cn(
          'text-muted border-border/40 rounded-lg border border-dashed px-3 py-6 text-center text-xs',
          className
        )}
        data-testid="agent-artifact-canvas-empty"
        data-viewport={viewport}
      >
        {agent_artifact_canvas_empty()}
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
  const carrier = artifactContentCarrierOf(artifact.artifactType);

  return (
    <article
      className="border-border/50 bg-background rounded-lg border p-3 shadow-sm"
      data-artifact-id={artifact.artifactId}
      data-artifact-type={artifact.artifactType}
      data-carrier={carrier ?? undefined}
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
        <ImageArtifact
          {...common}
          caption={'caption' in body ? body.caption : undefined}
          imageRef={'imageRef' in body ? body.imageRef : undefined}
          imageStatus={'imageStatus' in body ? body.imageStatus : 'pending'}
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
  artifactType: 'plan';
  revision: number;
  status: string;
  summary?: string;
  lines: string[];
}) {
  return (
    <section
      data-artifact-id={artifactId}
      data-artifact-type={artifactType}
      data-revision={revision}
      data-surface="artifact_plan"
      data-testid="agent-artifact-plan"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">方案</h3>
        <ArtifactStatusLabel status={status} />
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
            {projectMerchantRevision(rev)}
            {isLive ? ' · 当前' : ''}
          </button>
        );
      })}
    </div>
  );
}
