/**
 * Note Artifact — in-place page growth: skeleton → copy → image (V31-15 / §5.5).
 * Cover dual preview consumes the same page imageRef (not a second ContentPackage).
 */

import { cn } from '@/lib/utils';
import { NoteWorkspacePreviews } from '@/product/object-workspace/note-workspace-previews';

import type { NotePageState } from '@meiye/contracts';
import { projectMerchantMediaStatus } from '@/product/merchant-vocabulary';

import { ArtifactStatusLabel } from './artifact-status-label';

import {
  ArtifactMediaFrame,
  isArtifactMediaDisplayUrl,
} from './artifact-media';

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
  const coverPage = noteCoverPage(pages);
  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      data-artifact-id={artifactId}
      data-artifact-status={status}
      data-artifact-type="note"
      data-carrier="note"
      data-revision={revision}
      data-surface="artifact_note"
      data-testid="agent-artifact-note"
      data-viewing-revision={viewingRevision ?? revision}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">图文笔记</h3>
        <ArtifactStatusLabel status={status} />
      </header>
      {summary ? (
        <p className="text-muted text-xs leading-relaxed">{summary}</p>
      ) : null}
      {coverPage ? (
        <div data-testid="agent-artifact-note-dual-preview">
          <NoteWorkspacePreviews
            cover={{
              assetId: null,
              previewUrl:
                coverPage.imageRef &&
                isArtifactMediaDisplayUrl(coverPage.imageRef)
                  ? coverPage.imageRef
                  : undefined,
            }}
            document={{
              body: coverPage.body ?? '',
              conversionHook: '',
              title: coverPage.title ?? '',
              topics: [],
            }}
          />
        </div>
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
              data-image-ref={page.imageRef}
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
                    <>
                      <p
                        className="text-muted mt-2 text-xs"
                        data-image-status={page.imageStatus ?? 'pending'}
                        data-testid="agent-artifact-page-image-status"
                      >
                        配图：{mediaLabel(page.imageStatus)}
                      </p>
                      <ArtifactMediaFrame
                        alt={
                          page.title?.trim() ||
                          `第 ${page.pageIndex + 1} 页配图`
                        }
                        mediaRef={page.imageRef}
                        status={page.imageStatus ?? 'pending'}
                        testId="agent-artifact-page-image"
                      />
                    </>
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

function noteCoverPage(
  pages: readonly NotePageState[]
): NotePageState | undefined {
  return (
    pages.find((page) => page.imageRef) ??
    pages.find((page) => page.stage !== 'skeleton')
  );
}

function stageLabel(stage: NotePageState['stage']): string {
  if (stage === 'skeleton') return '骨架';
  if (stage === 'copy') return '文案';
  return '配图';
}

function mediaLabel(status: NotePageState['imageStatus']): string {
  if (!status) return '待生成';
  return projectMerchantMediaStatus(status);
}
