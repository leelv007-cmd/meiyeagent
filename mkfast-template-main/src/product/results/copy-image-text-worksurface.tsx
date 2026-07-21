/**
 * Copy / image_text worksurface UI (WT-D2 / #100).
 *
 * Edit · selection rewrite chips · fact sources · platform preview ·
 * persistent "还想怎么改？".
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

import { AdjustPrompt } from './adjust-prompt';
import {
  COPY_PREVIEW_CARRIER_LABELS,
  COPY_PREVIEW_EXPORT_CARRIERS,
  COPY_PREVIEW_PLATFORM_CARRIERS,
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
    value: string
  ) => void;
  onSelectionRewrite?: (action: SelectionRewriteAction) => void;
  onCarrierChange?: (carrier: CopyPreviewCarrier) => void;
  onGeneratePlatformVariants?: () => Promise<void>;
  onAdjust?: (instruction: string) => void;
  onAdopt?: () => void | Promise<void>;
  onHandEdit?: (changes: {
    body: string;
    conversionHook: string;
    title: string;
  }) => void | Promise<void>;
};

export function CopyImageTextWorksurface(props: CopyImageTextWorksurfaceProps) {
  const [selectedCarrier, setSelectedCarrier] = useState<CopyPreviewCarrier>(
    props.facts.selectedCarrier ?? 'xiaohongshu'
  );
  const view = projectCopyImageTextWorksurface({
    ...props.facts,
    selectedCarrier,
  });
  const [draft, setDraft] = useState(() => ({
    body: view.document.body,
    conversionHook: view.document.conversionHook,
    title: view.document.title,
  }));
  const [saving, setSaving] = useState(false);
  const [generatingPlatformVariants, setGeneratingPlatformVariants] =
    useState(false);
  const [platformGenerationError, setPlatformGenerationError] = useState<
    string | undefined
  >();
  useEffect(() => {
    setDraft({
      body: view.document.body,
      conversionHook: view.document.conversionHook,
      title: view.document.title,
    });
  }, [
    props.facts.baseRevisionId,
    view.document.body,
    view.document.conversionHook,
    view.document.title,
  ]);
  const dirty =
    draft.body !== view.document.body ||
    draft.conversionHook !== view.document.conversionHook ||
    draft.title !== view.document.title;
  const hasAllFormalPlatformVariants = COPY_PREVIEW_PLATFORM_CARRIERS.every(
    (carrier) =>
      props.facts.platformPreviews?.some(
        (variant) =>
          variant.carrier === carrier && variant.source === 'copy.adapt'
      )
  );

  return (
    <div
      className="space-y-4"
      data-testid="copy-image-text-worksurface"
      data-lifecycle={props.facts.lifecycle}
    >
      <section
        className="space-y-3 rounded-lg border p-4"
        data-testid="copy-edit-panel"
      >
        <h3 className="text-sm font-medium">编辑</h3>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">标题</span>
          <input
            className="w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-title"
            value={draft.title}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }));
              props.onFieldChange?.('title', event.target.value);
            }}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">正文</span>
          <textarea
            className="min-h-28 w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-body"
            value={draft.body}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                body: event.target.value,
              }));
              props.onFieldChange?.('body', event.target.value);
            }}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">转化语 / CTA</span>
          <input
            className="w-full rounded-md border bg-background px-3 py-2"
            data-testid="copy-field-hook"
            value={draft.conversionHook}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                conversionHook: event.target.value,
              }));
              props.onFieldChange?.('conversionHook', event.target.value);
            }}
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
        <Button
          type="button"
          variant="outline"
          data-testid="copy-save-hand-edit"
          disabled={!dirty || saving || !props.onHandEdit}
          onClick={async () => {
            if (!props.onHandEdit) return;
            setSaving(true);
            try {
              await props.onHandEdit(draft);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? '保存中…' : '保存修改'}
        </Button>
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
              disabled={!props.onSelectionRewrite}
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
          {COPY_PREVIEW_PLATFORM_CARRIERS.map((carrier) => (
            <Button
              key={carrier}
              type="button"
              size="sm"
              variant={selectedCarrier === carrier ? 'default' : 'outline'}
              data-testid={`copy-carrier-${carrier}`}
              data-active={selectedCarrier === carrier ? 'true' : 'false'}
              onClick={() => {
                setSelectedCarrier(carrier);
                props.onCarrierChange?.(carrier);
              }}
            >
              {COPY_PREVIEW_CARRIER_LABELS[carrier]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">导出用途</span>
          {COPY_PREVIEW_EXPORT_CARRIERS.map((carrier) => (
            <Button
              key={carrier}
              type="button"
              size="sm"
              variant={selectedCarrier === carrier ? 'default' : 'outline'}
              data-testid={`copy-carrier-${carrier}`}
              data-active={selectedCarrier === carrier ? 'true' : 'false'}
              onClick={() => {
                setSelectedCarrier(carrier);
                props.onCarrierChange?.(carrier);
              }}
            >
              {COPY_PREVIEW_CARRIER_LABELS[carrier]}
            </Button>
          ))}
        </div>
        {generatingPlatformVariants ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="copy-platform-preview-pending"
          >
            正在生成三平台正式版本…
          </p>
        ) : view.platformPreview?.kind === 'ready' ? (
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
        {props.facts.lifecycle === 'adopted' &&
        !hasAllFormalPlatformVariants &&
        props.onGeneratePlatformVariants ? (
          <div className="space-y-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="copy-generate-platform-variants"
              disabled={generatingPlatformVariants}
              onClick={async () => {
                setGeneratingPlatformVariants(true);
                setPlatformGenerationError(undefined);
                try {
                  await props.onGeneratePlatformVariants?.();
                } catch (error) {
                  setPlatformGenerationError(
                    error instanceof Error
                      ? error.message
                      : '平台版本生成失败，请重试。'
                  );
                } finally {
                  setGeneratingPlatformVariants(false);
                }
              }}
            >
              生成正式平台版本
            </Button>
            {platformGenerationError ? (
              <p className="text-sm text-destructive" role="alert">
                {platformGenerationError}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <AdjustPrompt onSubmit={props.onAdjust} />

      {props.facts.lifecycle === 'candidate' ? (
        <Button
          type="button"
          data-testid="copy-adopt-action"
          disabled={!props.onAdopt}
          onClick={() => void props.onAdopt?.()}
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
