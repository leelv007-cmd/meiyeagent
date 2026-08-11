/**
 * Note Artifact — in-place page growth: skeleton → copy → image (V31-15 / §5.5).
 */

import { cn } from '@/lib/utils';

import type { NotePageState } from '@meiye/contracts';

export type NoteArtifactProps = {
  artifactId: string;
  revision: number;
  status: string;
  pages: readonly NotePageState[];
  summary?: string;
  viewingRevision?: number;
  className?: string;
};

export function NoteArtifact({
  artifactId,
  revision,
  status,
  pages,
  summary,
  viewingRevision,
  className,
}: NoteArtifactProps) {
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="note"
      data-revision={revision}
      data-surface="artifact_note"
      data-testid="agent-artifact-note"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">图文笔记</h3>
        <StatusPill status={status} />
      </header>
      {summary ? (
        <p className="text-muted text-xs leading-relaxed">{summary}</p>
      ) : null}
      <ol
        className="flex flex-col gap-2"
        data-testid="agent-artifact-note-pages"
      >
        {pages.length === 0 ? (
          <li className="text-muted text-xs">等待页骨架…</li>
        ) : (
          pages.map((page) => (
            <li
              className="border-border/50 bg-muted/20 rounded-md border px-3 py-2"
              data-page-index={page.pageIndex}
              data-page-stage={page.stage}
              data-testid="agent-artifact-note-page"
              key={page.pageIndex}
            >
              <div className="text-muted mb-1 flex items-center justify-between text-xs">
                <span>第 {page.pageIndex + 1} 页</span>
                <span>{stageLabel(page.stage)}</span>
              </div>
              {page.stage === 'skeleton' ? (
                <div
                  aria-hidden
                  className="bg-muted/60 h-12 animate-pulse rounded"
                  data-testid="agent-artifact-page-skeleton"
                />
              ) : (
                <>
                  {page.title ? (
                    <p className="text-foreground text-sm font-medium">
                      {page.title}
                    </p>
                  ) : null}
                  {page.body ? (
                    <p className="text-foreground/90 mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                      {page.body}
                    </p>
                  ) : null}
                  {page.stage === 'image' || page.imageStatus ? (
                    <p
                      className="text-muted mt-2 text-xs"
                      data-image-status={page.imageStatus ?? 'pending'}
                      data-testid="agent-artifact-page-image-status"
                    >
                      配图：{mediaLabel(page.imageStatus)}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

function stageLabel(stage: NotePageState['stage']): string {
  if (stage === 'skeleton') return '骨架';
  if (stage === 'copy') return '文案';
  return '配图';
}

function mediaLabel(status: NotePageState['imageStatus']): string {
  if (status === 'ready') return '已就绪';
  if (status === 'generating') return '生成中';
  if (status === 'failed') return '失败';
  return '待生成';
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className="text-muted bg-muted/50 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
      data-testid="agent-artifact-status"
    >
      {status}
    </span>
  );
}
