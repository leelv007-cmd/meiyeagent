/**
 * Copy / image_text document worksurface UI (WT-D2 / #100 / P1-B2 / #151).
 *
 * Primary document face · on-demand alternatives · selection rewrite with
 * stable anchors · fact sources · platform preview · persistent "还想怎么改？".
 *
 * P2-10 / #322: body field is Tiptap inside the object-workspace shell;
 * selection AI six actions share this surface for copy / note / image_text.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ObjectWorkspaceEditor,
  ObjectWorkspaceShell,
  objectWorkspaceCarrierFromFacts,
} from '@/product/object-workspace';
import { useEffect, useState } from 'react';

import { AdjustPrompt } from './adjust-prompt';
import {
  QUICK_EDIT_EXPORT_USE_ACTIONS,
  quickEditActionForSelectionRewrite,
  quickEditExportUseLabel,
  quickEditText,
  type QuickEditRequest,
} from './quick-edit-model';
import {
  COPY_PREVIEW_CARRIER_LABELS,
  COPY_PREVIEW_EXPORT_CARRIERS,
  COPY_PREVIEW_PLATFORM_CARRIERS,
  FACT_SOURCE_KIND_LABELS,
  captureStableSelectionAnchor,
  projectCopyImageTextWorksurface,
  resolveSelectionRewrite,
  type CopyImageTextWorksurfaceFacts,
  type CopyPreviewCarrier,
  type SelectionRewriteAction,
  type SelectionRewriteResolveResult,
  type StableSelectionAnchor,
} from './copy-image-text-worksurface-model';

export type CopyImageTextWorksurfaceProps = {
  facts: CopyImageTextWorksurfaceFacts;
  onFieldChange?: (
    field: 'title' | 'body' | 'conversionHook',
    value: string
  ) => void;
  onSelectionRewrite?: (
    action: SelectionRewriteAction,
    anchor?: StableSelectionAnchor
  ) => void;
  /** Optional live revision for base-drift conflict detection. */
  currentRevisionId?: string;
  onSelectionRewriteResolved?: (result: SelectionRewriteResolveResult) => void;
  onCarrierChange?: (carrier: CopyPreviewCarrier) => void;
  onGeneratePlatformVariants?: () => Promise<void>;
  onAdjust?: (instruction: string) => void;
  /**
   * Why 「还想怎么改？」 is unavailable on this result, in merchant words.
   * Present means the box is disabled with the sentence shown — the old
   * behaviour was an enabled box whose submit returned silently.
   */
  adjustUnavailableReason?: string;
  onAdopt?: () => void | Promise<void>;
  onHandEdit?: (changes: {
    body: string;
    conversionHook: string;
    title: string;
  }) => void | Promise<void>;
  /**
   * Send one QuickEditIntent (W07). Present only when the page has a live
   * ContentPackage version to bind the intent to.
   */
  onQuickEdit?: (request: QuickEditRequest) => void | Promise<void>;
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
  const [adopting, setAdopting] = useState(false);
  const [adoptionError, setAdoptionError] = useState<string | undefined>();
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [selectionConflict, setSelectionConflict] = useState<Extract<
    SelectionRewriteResolveResult,
    { kind: 'conflict' }
  > | null>(null);
  const [bodySelection, setBodySelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [rewritePreview, setRewritePreview] = useState<{
    action: SelectionRewriteAction;
    before: string;
    after: string;
    fieldAfter: string;
    instruction: string;
    scope: 'selection' | 'whole_document';
  } | null>(null);
  const [pendingInstructionAction, setPendingInstructionAction] =
    useState<SelectionRewriteAction | null>(null);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [quickEditBusy, setQuickEditBusy] = useState<string | null>(null);
  const [quickEditError, setQuickEditError] = useState<string | undefined>();
  const quickEditCopy = quickEditText();
  const shellCarrier = objectWorkspaceCarrierFromFacts({
    orderedAssetCount: props.facts.document.orderedAssetIds.length,
    workspaceKind:
      props.facts.document.orderedAssetIds.length > 0 ? 'image' : 'copy',
  });
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
  const alternatives = view.documentFace?.alternatives ?? [];

  /**
   * What the next rewrite will actually touch. A stale selection (the body was
   * replaced under it) is no selection: the rewrite would run over the whole
   * 正文, and the panel must say the same thing the code does.
   */
  const selectedLength =
    bodySelection &&
    bodySelection.end > bodySelection.start &&
    bodySelection.end <= draft.body.length
      ? bodySelection.end - bodySelection.start
      : 0;
  const rewriteScope =
    selectedLength > 0
      ? {
          kind: 'selection' as const,
          hint: `已选中 ${selectedLength} 个字，只改写选中部分。改写绑定当前版本与稳定锚点。`,
        }
      : {
          kind: 'whole_document' as const,
          hint: '还没选中文字，将改写整篇文案；只想改一句的话，先在正文里选中它。',
        };

  const runSelectionRewrite = (
    action: SelectionRewriteAction,
    instruction?: string
  ) => {
    // tone / custom need a free-text instruction before preview (selection AI).
    const needsInstruction =
      action === 'tone' || action === 'tone_shift' || action === 'custom';
    if (needsInstruction && instruction === undefined) {
      setPendingInstructionAction(action);
      setInstructionDraft('');
      return;
    }
    const start = bodySelection?.start ?? 0;
    const end = bodySelection?.end ?? draft.body.length;
    const anchor = captureStableSelectionAnchor(draft.body, 'body', start, end);
    if ('kind' in anchor) {
      setSelectionConflict(null);
      setRewritePreview(null);
      props.onSelectionRewrite?.(action);
      return;
    }
    const currentRevisionId =
      props.currentRevisionId ?? props.facts.baseRevisionId;
    const resolved = resolveSelectionRewrite({
      workId: props.facts.workId,
      baseRevisionId: props.facts.baseRevisionId,
      currentRevisionId,
      currentFieldText: draft.body,
      action,
      anchor,
      ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
    });
    props.onSelectionRewriteResolved?.(resolved);
    if (resolved.kind === 'conflict') {
      setSelectionConflict(resolved);
      setRewritePreview(null);
      return;
    }
    setSelectionConflict(null);
    setPendingInstructionAction(null);
    setInstructionDraft('');
    if (resolved.kind === 'ok') {
      // The diff the merchant decides on. Nothing is written until 就用这版 —
      // that button is what turns this into a QuickEditIntent.
      setQuickEditError(undefined);
      setRewritePreview({
        action,
        before: resolved.preview.before,
        after: resolved.preview.after,
        fieldAfter: resolved.preview.fieldAfter,
        instruction: resolved.command.instruction,
        scope: rewriteScope.kind,
      });
    }
    props.onSelectionRewrite?.(action, anchor);
  };

  const sendQuickEdit = async (
    busyKey: string,
    request: QuickEditRequest,
    onDone?: () => void
  ) => {
    if (!props.onQuickEdit || quickEditBusy) return;
    setQuickEditBusy(busyKey);
    setQuickEditError(undefined);
    try {
      await props.onQuickEdit(request);
      onDone?.();
    } catch (error) {
      setQuickEditError(
        error instanceof Error ? error.message : quickEditCopy.failed
      );
    } finally {
      setQuickEditBusy(null);
    }
  };

  return (
    <ObjectWorkspaceShell
      carrier={shellCarrier}
      title={draft.title || '成品精修'}
      workId={props.facts.workId}
    >
    <div className="space-y-4" data-testid="copy-image-text-worksurface">
      <section
        className="space-y-3 rounded-lg border p-4"
        data-testid="copy-edit-panel"
        data-document-face="primary"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">主推荐</h3>
          <Badge variant="outline" data-testid="copy-primary-badge">
            默认展开
          </Badge>
        </div>
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
        <div className="block space-y-1 text-sm">
          <span className="text-muted-foreground">正文</span>
          <ObjectWorkspaceEditor
            data-testid="copy-field-body"
            value={draft.body}
            onChange={(value) => {
              setDraft((current) => ({
                ...current,
                body: value,
              }));
              props.onFieldChange?.('body', value);
            }}
            onSelectionChange={(selection) => {
              if (!selection || selection.end <= selection.start) {
                setBodySelection(null);
                return;
              }
              setBodySelection({
                start: selection.start,
                end: Math.min(selection.end, draft.body.length || selection.end),
              });
            }}
          />
        </div>
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

      {alternatives.length > 0 ? (
        <section
          className="space-y-2 rounded-lg border p-4"
          data-testid="copy-alternatives-panel"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium"
            data-testid="copy-alternatives-toggle"
            aria-expanded={alternativesOpen}
            onClick={() => setAlternativesOpen((open) => !open)}
          >
            <span>备选（{alternatives.length}）</span>
            <span className="text-muted-foreground">
              {alternativesOpen ? '收起' : '按需查看'}
            </span>
          </button>
          {alternativesOpen ? (
            <ul className="space-y-3" data-testid="copy-alternatives-list">
              {alternatives.map((item) => (
                <li
                  key={item.candidateId}
                  className="rounded-md border p-3 text-sm"
                  data-testid="copy-alternative-item"
                >
                  <p className="font-medium">{item.title || '备选文案'}</p>
                  <p className="mt-1 text-muted-foreground whitespace-pre-wrap">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {props.onSelectionRewrite ? (
        <section
          className="space-y-2 rounded-lg border p-4"
          data-testid="copy-selection-rewrite"
          data-object-workspace-selection-ai="true"
          data-rewrite-scope={rewriteScope.kind}
        >
          <h3 className="text-sm font-medium">选区 AI</h3>
          {/*
            Without a selection the rewrite still runs — over the whole 正文.
            That is the useful default (「整篇再顺一遍」), and it is also the one
            the merchant can be surprised by, so the panel says which one it is
            before the click rather than after it (D-116).
          */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="copy-selection-rewrite-scope"
          >
            {rewriteScope.hint}
          </p>
          <div
            className="flex flex-wrap gap-2"
            data-testid="object-workspace-selection-ai-actions"
            role="toolbar"
            aria-label="选区 AI 六动作"
          >
            {view.selectionRewriteActions.map((item) => (
              <Button
                key={item.action}
                type="button"
                size="sm"
                variant="outline"
                data-testid={`copy-rewrite-${item.action}`}
                data-selection-ai-action={item.action}
                {...(item.action === 'continue' ||
                item.action === 'rewrite' ||
                item.action === 'expand' ||
                item.action === 'shorten' ||
                item.action === 'tone' ||
                item.action === 'custom'
                  ? { 'data-primary-selection-ai': 'true' }
                  : {})}
                onClick={() => runSelectionRewrite(item.action)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {pendingInstructionAction ? (
            <div
              className="space-y-2 rounded-md border p-3"
              data-testid="selection-ai-instruction-panel"
              data-pending-action={pendingInstructionAction}
            >
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">
                  {pendingInstructionAction === 'custom'
                    ? '自定义要求'
                    : '想要的语气'}
                </span>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2"
                  data-testid="selection-ai-instruction-input"
                  value={instructionDraft}
                  onChange={(event) => setInstructionDraft(event.target.value)}
                  placeholder={
                    pendingInstructionAction === 'custom'
                      ? '例如：更口语、少用感叹号'
                      : '专业温和的美容顾问口吻'
                  }
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="selection-ai-instruction-confirm"
                  onClick={() =>
                    runSelectionRewrite(
                      pendingInstructionAction,
                      instructionDraft
                    )
                  }
                >
                  生成预览
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="selection-ai-instruction-cancel"
                  onClick={() => {
                    setPendingInstructionAction(null);
                    setInstructionDraft('');
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          {rewritePreview ? (
            <div
              className="space-y-2 rounded-md border p-3"
              data-testid="copy-selection-rewrite-preview"
              data-rewrite-action={rewritePreview.action}
              data-rewrite-scope={rewritePreview.scope}
            >
              <p className="text-sm font-medium">
                {quickEditCopy.previewHeading}
              </p>
              <p
                className="text-sm text-muted-foreground line-through"
                data-testid="copy-selection-rewrite-before"
              >
                {quickEditCopy.previewBefore}：{rewritePreview.before}
              </p>
              <p className="text-sm" data-testid="copy-selection-rewrite-after">
                {quickEditCopy.previewAfter}：{rewritePreview.after}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="copy-selection-rewrite-adopt"
                  disabled={!props.onQuickEdit || quickEditBusy !== null}
                  onClick={() =>
                    void sendQuickEdit(
                      'selection',
                      {
                        action: quickEditActionForSelectionRewrite(
                          rewritePreview.action
                        ),
                        instruction: rewritePreview.instruction,
                        changes: {
                          body: rewritePreview.fieldAfter,
                          conversionHook: draft.conversionHook,
                          title: draft.title,
                        },
                      },
                      () => setRewritePreview(null)
                    )
                  }
                >
                  {quickEditBusy === 'selection'
                    ? quickEditCopy.pending
                    : quickEditCopy.adopt}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="copy-selection-rewrite-cancel"
                  onClick={() => setRewritePreview(null)}
                >
                  {quickEditCopy.discard}
                </Button>
              </div>
            </div>
          ) : null}
          {selectionConflict ? (
            <div
              className="space-y-2 rounded-md border border-destructive/40 p-3"
              data-testid="copy-selection-rewrite-conflict"
              role="alert"
            >
              <p className="text-sm text-destructive">
                {selectionConflict.message}
              </p>
              <div className="flex flex-wrap gap-2">
                {selectionConflict.choices.map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    size="sm"
                    variant={choice === 'discard' ? 'outline' : 'default'}
                    data-testid={`copy-rewrite-conflict-${choice}`}
                    onClick={() => {
                      if (choice === 'discard') {
                        setSelectionConflict(null);
                      }
                    }}
                  >
                    {choice === 'compare'
                      ? '比较版本'
                      : choice === 'discard'
                        ? '丢弃选区'
                        : '重新应用'}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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

      {/*
        One place for a failed quick edit, whichever gesture started it — the
        export row is reachable without the selection-rewrite section, and an
        error rendered inside that section would have nowhere to appear.
      */}
      {quickEditError ? (
        <p
          className="text-sm text-destructive"
          data-testid="copy-quick-edit-error"
          role="alert"
        >
          {quickEditError}
        </p>
      ) : null}

      {props.onQuickEdit ? (
        <section
          className="space-y-2 rounded-lg border p-4"
          data-testid="copy-export-use-actions"
        >
          <h3 className="text-sm font-medium">{quickEditCopy.exportHeading}</h3>
          <p className="text-xs text-muted-foreground">
            {quickEditCopy.exportHint}
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_EDIT_EXPORT_USE_ACTIONS.map((action) => {
              const label = quickEditExportUseLabel(action);
              return (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid={`copy-export-use-${action}`}
                  disabled={quickEditBusy !== null}
                  onClick={() =>
                    void sendQuickEdit(action, {
                      action,
                      instruction: label,
                      changes: {
                        body: draft.body,
                        conversionHook: draft.conversionHook,
                        title: draft.title,
                      },
                    })
                  }
                >
                  {quickEditBusy === action ? quickEditCopy.pending : label}
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}

      <AdjustPrompt
        onSubmit={props.onAdjust}
        disabled={Boolean(props.adjustUnavailableReason)}
        {...(props.adjustUnavailableReason
          ? { unavailableReason: props.adjustUnavailableReason }
          : {})}
      />

      {props.facts.lifecycle === 'candidate' ? (
        <div className="space-y-2">
          <Button
            type="button"
            data-testid="copy-adopt-action"
            disabled={!props.onAdopt || adopting}
            onClick={async () => {
              setAdopting(true);
              setAdoptionError(undefined);
              try {
                await props.onAdopt?.();
              } catch (error) {
                setAdoptionError(
                  error instanceof Error
                    ? error.message
                    : '采用版本失败，请重试。'
                );
              } finally {
                setAdopting(false);
              }
            }}
          >
            {adopting ? '采用中…' : '采用此版本'}
          </Button>
          {adoptionError ? (
            <p className="text-sm text-destructive" role="alert">
              {adoptionError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Explicit: mobile never gates to desktop. */}
      <span data-testid="copy-mobile-desktop-gate" hidden>
        {view.mobileDesktopGate}
      </span>
    </div>
    </ObjectWorkspaceShell>
  );
}
