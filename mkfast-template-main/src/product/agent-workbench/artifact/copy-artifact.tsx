/**
 * Copy Artifact — block-level in-place growth (V31-15).
 */

import { cn } from '@/lib/utils';

import type { CopyBlockState } from '@meiye/contracts';

export type CopyArtifactProps = {
  artifactId: string;
  revision: number;
  status: string;
  blocks: readonly CopyBlockState[];
  summary?: string;
  viewingRevision?: number;
  className?: string;
};

export function CopyArtifact({
  artifactId,
  revision,
  status,
  blocks,
  summary,
  viewingRevision,
  className,
}: CopyArtifactProps) {
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="copy"
      data-revision={revision}
      data-surface="artifact_copy"
      data-testid="agent-artifact-copy"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">文案</h3>
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
      <ul
        className="flex flex-col gap-2"
        data-testid="agent-artifact-copy-blocks"
      >
        {blocks.map((block) => (
          <li
            className="border-border/50 bg-muted/20 rounded-md border px-3 py-2"
            data-block-id={block.blockId}
            data-block-role={block.role}
            data-testid="agent-artifact-copy-block"
            key={block.blockId}
          >
            <p className="text-muted text-[11px]">{roleLabel(block.role)}</p>
            <p className="text-foreground mt-1 whitespace-pre-wrap text-xs leading-relaxed">
              {block.text?.trim() || '…'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function roleLabel(role: CopyBlockState['role']): string {
  if (role === 'title') return '标题';
  if (role === 'body') return '正文';
  if (role === 'topic') return '话题';
  if (role === 'cta') return '行动号召';
  return '段落';
}
