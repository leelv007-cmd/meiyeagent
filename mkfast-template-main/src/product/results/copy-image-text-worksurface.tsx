/**
 * Copy / image_text worksurface UI (WT-D2 / #100).
 *
 * Edit · selection rewrite chips · fact sources · platform preview ·
 * persistent "还想怎么改？".
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { AdjustPrompt } from './adjust-prompt';
import {
  COPY_PREVIEW_CARRIER_LABELS,
  FACT_SOURCE_KIND_LABELS,
  projectCopyImageTextWorksurface,
  type CopyImageTextWorksurfaceFacts,
  type CopyPreviewCarrier,
  type SelectionRewriteAction,
} from './copy-image-text-worksurface-model';

export type CopyImageTextWorksurfaceProps = {
  facts: CopyImageTextWorksurfaceFacts;
  onFieldChange?: (
    field: 'title' | 'body' | 'conversionHook',
    value: string,
  ) => void;
  onSelectionRewrite?: (action: SelectionRewriteAction) => void;
  onCarrierChange?: (carrier: CopyPreviewCarrier) => void;
  onAdjust?: (instruction: string) => void;
  onAdopt?: () => void;
};

export function CopyImageTextWorksurface(props: CopyImageTextWorksurfaceProps) {
  const view = projectCopyImageTextWorksurface(props.facts);

  return (
    <div
      className="space-y-4"
      data-testid="copy-image-text-worksurface"
      data-lifecycle={props.facts.lifecycle}
    >
      <section className="space-y-3 rounded-lg border p-4" data-testid="copy-edit-panel">
        <h3 className="text-sm font-medium">编辑</h3>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">标题</span>
          <input
            className="w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-title"
            value={view.document.title}
            onChange={(event) =>
              props.onFieldChange?.('title', event.target.value)
            }
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">正文</span>
          <textarea
            className="min-h-28 w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-body"
            value={view.document.body}
            onChange={(event) =>
              props.onFieldChange?.('body', event.target.value)
            }
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">转化语 / CTA</span>
          <input
            className="w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-hook"
            value={view.document.conversionHook}
            onChange={(event) =>
              props.onFieldChange?.('conversionHook', event.target.value)
            }
          />
        </label>
        {view.document.topics.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="copy-topics">
            {view.document.topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      <section
        className="space-y-2 rounded-lg border p-4"
        data-testid="copy-selection-rewrite"
      >
        <h3 className="text-sm font-medium">选区改写</h3>
        <div className="flex flex-wrap gap-2">
          {view.selectionRewriteActions.map((item) => (
            <Button
              key={item.action}
              type="button"
              size="sm"
              variant="outline"
              data-testid={`copy-rewrite-${item.action}`}
              onClick={() => props.onSelectionRewrite?.(item.action)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </section>

      <section
        className="space-y-2 rounded-lg border p-4"
        data-testid="copy-fact-sources"
      >
        <h3 className="text-sm font-medium">事实来源</h3>
        {view.factSources.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无关联事实</p>
        ) : (
          <ul className="space-y-2">
            {view.factSources.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 text-sm"
                data-testid="copy-fact-item"
                data-status={item.status}
              >
                <Badge variant="outline">
                  {FACT_SOURCE_KIND_LABELS[item.kind]}
                </Badge>
                <span>{item.label}</span>
                <span className="text-muted-foreground">{item.summary}</span>
                {item.status === 'pending' ? (
                  <Badge variant="destructive">待确认</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="space-y-2 rounded-lg border p-4"
        data-testid="copy-platform-preview"
      >
        <h3 className="text-sm font-medium">平台预览</h3>
        <div className="flex flex-wrap gap-2">
          {(
            Object.keys(COPY_PREVIEW_CARRIER_LABELS) as CopyPreviewCarrier[]
          ).map((carrier) => (
            <Button
              key={carrier}
              type="button"
              size="sm"
              variant={
                (props.facts.selectedCarrier ?? 'xiaohongshu') === carrier
                  ? 'default'
                  : 'outline'
              }
              data-testid={`copy-carrier-${carrier}`}
              onClick={() => props.onCarrierChange?.(carrier)}
            >
              {COPY_PREVIEW_CARRIER_LABELS[carrier]}
            </Button>
          ))}
        </div>
        {view.platformPreview?.kind === 'ready' ? (
          <div
            className="rounded-md bg-muted p-3 text-sm"
            data-testid="copy-platform-preview-body"
            data-source={view.platformPreview.variant.source}
          >
            <p className="font-medium">{view.platformPreview.variant.title}</p>
            <p className="mt-2 whitespace-pre-wrap">
              {view.platformPreview.variant.body}
            </p>
          </div>
        ) : view.platformPreview?.kind === 'rejected' ? (
          <p
            className="text-sm text-destructive"
            data-testid="copy-platform-preview-rejected"
            data-code={view.platformPreview.code}
          >
            {view.platformPreview.message}
          </p>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="copy-platform-preview-pending"
          >
            {view.platformPreview?.kind === 'pending'
              ? view.platformPreview.message
              : '选择平台查看正式适配预览'}
          </p>
        )}
      </section>

      <AdjustPrompt onSubmit={props.onAdjust} />

      {props.facts.lifecycle === 'candidate' ? (
        <Button
          type="button"
          data-testid="copy-adopt-action"
          onClick={() => props.onAdopt?.()}
        >
          采用此版本
        </Button>
      ) : null}

      {/* Explicit: mobile never gates to desktop. */}
      <span data-testid="copy-mobile-desktop-gate" hidden>
        {view.mobileDesktopGate}
      </span>
    </div>
  );
}
