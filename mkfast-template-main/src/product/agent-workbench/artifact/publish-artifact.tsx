/**
 * Publish readiness Artifact (V31-15 / §6.1 readiness strip).
 */

import { cn } from '@/lib/utils';
import type { PublishItemState } from '@meiye/contracts';

import { ArtifactStatusLabel } from './artifact-status-label';

export type PublishArtifactProps = {
  artifactId: string;
  revision: number;
  status: string;
  items: readonly PublishItemState[];
  summary?: string;
  viewingRevision?: number;
  className?: string;
};

export function PublishArtifact({
  artifactId,
  revision,
  status,
  items,
  summary,
  viewingRevision,
  className,
}: PublishArtifactProps) {
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="publish"
      data-revision={revision}
      data-surface="artifact_publish"
      data-testid="agent-artifact-publish"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">发布准备</h3>
        <ArtifactStatusLabel status={status} />
      </header>
      {summary ? (
        <p className="text-muted text-xs leading-relaxed">{summary}</p>
      ) : null}
      <ul
        className="flex flex-col gap-1.5"
        data-testid="agent-artifact-publish-items"
      >
        {items.map((item) => (
          <li
            className="text-foreground flex items-center justify-between gap-2 text-xs"
            data-item-id={item.itemId}
            data-ready={item.ready ? 'true' : 'false'}
            data-testid="agent-artifact-publish-item"
            key={item.itemId}
          >
            <span>{item.label}</span>
            <span className="text-muted">{item.ready ? '就绪' : '待完成'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
