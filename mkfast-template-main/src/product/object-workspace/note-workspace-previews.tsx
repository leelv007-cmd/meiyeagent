export type NoteWorkspacePreviewDocument = {
  title: string;
  body: string;
  conversionHook: string;
  topics: readonly string[];
};

export type NoteWorkspacePreviewCover = {
  assetId: string | null;
  /** Already-authorized canonical display URL. Never derive one from assetId. */
  previewUrl?: string;
};

export type NoteWorkspacePreviewsProps = {
  document: NoteWorkspacePreviewDocument;
  cover: NoteWorkspacePreviewCover;
};

function CoverPreview(props: {
  alt: string;
  cover: NoteWorkspacePreviewCover;
  testId: string;
}) {
  if (!props.cover.previewUrl) {
    return (
      <output
        className="flex aspect-[3/4] items-center justify-center bg-muted px-3 text-center text-xs text-muted-foreground"
        data-testid={`${props.testId}-empty`}
        data-cover-asset-id={props.cover.assetId ?? undefined}
      >
        暂无可预览封面
      </output>
    );
  }

  return (
    <img
      src={props.cover.previewUrl}
      alt={props.alt}
      className="aspect-[3/4] w-full object-cover"
      data-testid={props.testId}
      data-cover-asset-id={props.cover.assetId ?? undefined}
      data-preview-source="authorized-preview-url"
    />
  );
}

/** Live projections of the same controlled note draft shown by the editor. */
export function NoteWorkspacePreviews(props: NoteWorkspacePreviewsProps) {
  const title = props.document.title.trim() || '未命名笔记';

  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(16rem,0.72fr)_minmax(20rem,1.28fr)]"
      data-testid="note-workspace-previews"
    >
      <section
        aria-label="小红书手机笔记预览"
        className="mx-auto w-full max-w-[22rem] rounded-[2rem] border-8 border-foreground/90 bg-background p-2 shadow-sm"
        data-phone-shell="true"
        data-testid="note-phone-preview"
      >
        <div className="overflow-hidden rounded-[1.35rem] border bg-background">
          <CoverPreview
            alt={`${title}封面预览`}
            cover={props.cover}
            testId="note-phone-preview-cover"
          />
          <article className="space-y-2 p-4">
            <h3 className="font-medium" data-testid="note-phone-title">
              {title}
            </h3>
            <p
              className="whitespace-pre-wrap text-sm text-muted-foreground"
              data-testid="note-phone-body"
            >
              {props.document.body || '正文将在这里显示'}
            </p>
            {props.document.conversionHook ? (
              <p className="text-sm font-medium" data-testid="note-phone-hook">
                {props.document.conversionHook}
              </p>
            ) : null}
            {props.document.topics.length > 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="note-phone-topics"
              >
                {props.document.topics.map((topic) => `#${topic}`).join(' ')}
              </p>
            ) : null}
          </article>
        </div>
      </section>

      <section
        aria-label="小红书发现页双列封面预览"
        className="space-y-3 rounded-xl border bg-muted/30 p-4"
        data-testid="note-discovery-preview"
      >
        <div>
          <h3 className="text-sm font-medium">发现页封面预览</h3>
          <p className="text-xs text-muted-foreground">
            双列仅用于版式参照，不展示虚构账号或互动数据。
          </p>
        </div>
        <div
          className="columns-2 gap-3"
          data-column-count="2"
          data-testid="note-discovery-columns"
        >
          <div
            aria-hidden="true"
            className="mb-3 aspect-[4/5] break-inside-avoid rounded-lg bg-muted"
            data-preview-context="neutral"
          />
          <article
            className="mb-3 break-inside-avoid overflow-hidden rounded-lg border bg-background"
            data-own-note-card="true"
            data-testid="note-discovery-own-card"
          >
            <CoverPreview
              alt={`${title}发现页封面预览`}
              cover={props.cover}
              testId="note-discovery-preview-cover"
            />
            <h4 className="p-3 text-sm font-medium">{title}</h4>
          </article>
          <div
            aria-hidden="true"
            className="mb-3 aspect-[3/4] break-inside-avoid rounded-lg bg-muted"
            data-preview-context="neutral"
          />
        </div>
      </section>
    </div>
  );
}
