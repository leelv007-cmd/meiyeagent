import type {
  ProductQuoteSnapshot,
  PublicContentPackage,
  ResultAdjustSource,
} from '@meiye/contracts';

import { commandP1, operationsCommand } from '@/p1/client';
import { resultAdjustSourceForResult } from '@/product/results/result-live-projection';

import { projectNotePlanTimelineFromVersion } from './note-plan-timeline';

type ComposerNotePlanCommandModule =
  | 'operations'
  | 'product-billing'
  | 'result-delivery';

export type ComposerNotePlanCommandSubmit = (
  module: ComposerNotePlanCommandModule,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) => Promise<unknown>;

const submitP1Command: ComposerNotePlanCommandSubmit = (
  module,
  action,
  payload,
  idempotencyKey
) =>
  module === 'operations'
    ? operationsCommand(action, payload, idempotencyKey)
    : commandP1(module, { action, payload }, idempotencyKey);

function currentNoteVersion(contentPackage: PublicContentPackage) {
  const version = contentPackage.versions.find(
    (candidate) => candidate.id === contentPackage.currentVersionId
  );
  if (!version?.note) {
    throw new Error('当前内容版本没有可编辑的图文页组。');
  }
  return { note: version.note, version };
}

export async function saveComposerNotePlanOutline(input: {
  contentPackage: PublicContentPackage;
  edit: { body: string; pageId: string; title: string };
  idempotencyKey?: string;
  submit?: ComposerNotePlanCommandSubmit;
}) {
  const { note, version } = currentNoteVersion(input.contentPackage);
  if (!note.plan.pages.some(({ id }) => id === input.edit.pageId)) {
    throw new Error('当前内容版本中找不到这页大纲。');
  }
  const changedNote = {
    ...structuredClone(note),
    plan: {
      ...structuredClone(note.plan),
      pages: note.plan.pages.map((page) =>
        page.id === input.edit.pageId
          ? {
              ...structuredClone(page),
              textBlock: {
                ...structuredClone(page.textBlock),
                body: input.edit.body,
                title: input.edit.title,
              },
            }
          : structuredClone(page)
      ),
    },
  };
  const submit = input.submit ?? submitP1Command;
  const result = (await submit(
    'operations',
    'edit_content_package_version',
    {
      baseVersionId: version.id,
      changes: {
        body: changedNote.plan.pages
          .map((page) => page.textBlock.body)
          .join('\n\n'),
        ...(version.conversionHook !== undefined
          ? { conversionHook: version.conversionHook }
          : {}),
        note: changedNote,
        orderedAssetIds: [...version.orderedAssetIds],
        title: version.title,
        topics: [...version.topics],
      },
      expectedRevision: input.contentPackage.revision,
      packageId: input.contentPackage.id,
    },
    input.idempotencyKey ?? crypto.randomUUID()
  )) as PublicContentPackage;
  const saved = currentNoteVersion(result);
  return {
    contentPackage: result,
    timeline: projectNotePlanTimelineFromVersion(saved.note, {
      styleId: saved.note.plan.style.id,
      styleName: saved.note.plan.style.name,
    }),
  };
}

type PreparedResultAdjustment = {
  quoteIntent: {
    aspectRatio?: '1:1' | '3:4' | '9:16';
    catalogModelId: string;
    operation: 'copy.generate' | 'image.generate';
    quantity: number;
  };
  task: { id: string };
  work: { id: string };
};

export type PendingComposerNotePlanPageRegeneration = {
  aspectRatio?: '1:1' | '3:4' | '9:16';
  derivedTaskId: string;
  derivedWorkId: string;
  instruction: string;
  pageId: string;
  quantity: number;
  quote: ProductQuoteSnapshot;
  scope: { assetId: string; kind: 'asset' };
  source: Extract<ResultAdjustSource, { kind: 'content_package_snapshot' }>;
};

export async function prepareComposerNotePlanPageRegeneration(input: {
  contentPackage: PublicContentPackage;
  createId?: () => string;
  pageId: string;
  submit?: ComposerNotePlanCommandSubmit;
  workId: string;
  workUpdatedAt: string;
}): Promise<PendingComposerNotePlanPageRegeneration> {
  const { note } = currentNoteVersion(input.contentPackage);
  const page = note.plan.pages.find(({ id }) => id === input.pageId);
  if (!page) throw new Error('当前内容版本中找不到这页配图。');
  if (!page.imageAssetId) {
    throw new Error('当前页尚无可调整的图片，请先完成批量配图。');
  }
  const source = resultAdjustSourceForResult({
    contentPackage: input.contentPackage,
    job: null,
    workId: input.workId,
  });
  if (!source || source.kind !== 'content_package_snapshot') {
    throw new Error('当前图文版本缺少可核验的生成快照，无法重新生成。');
  }
  const instruction = [
    `重新生成图文笔记第 ${page.order} 页配图。`,
    `本页标题：${page.textBlock.title}`,
    `本页大纲：${page.textBlock.body}`,
    '仅调整这一页，保留整篇主题、事实与授权边界。',
  ].join('\n');
  const scope = { assetId: page.imageAssetId, kind: 'asset' as const };
  const createId = input.createId ?? (() => crypto.randomUUID());
  const intentId = createId();
  const submit = input.submit ?? submitP1Command;
  const prepared = (await submit(
    'result-delivery',
    'result_adjust_prepare',
    {
      expectedWorkUpdatedAt: input.workUpdatedAt,
      instruction,
      scope,
      source,
      workId: input.workId,
    },
    `note-regenerate-prepare:${intentId}`
  )) as PreparedResultAdjustment;
  if (
    prepared.quoteIntent.operation !== 'image.generate' ||
    prepared.quoteIntent.quantity !== 1
  ) {
    throw new Error('逐页重生成只接受一张图片的生产报价。');
  }
  const quoteId = intentId;
  const quote = (await submit(
    'product-billing',
    'quote',
    {
      ...(prepared.quoteIntent.aspectRatio
        ? { aspectRatio: prepared.quoteIntent.aspectRatio }
        : {}),
      catalogModelId: prepared.quoteIntent.catalogModelId,
      operation: prepared.quoteIntent.operation,
      quantity: prepared.quoteIntent.quantity,
      quoteId,
    },
    quoteId
  )) as ProductQuoteSnapshot;
  if (quote.quoteId !== quoteId) {
    throw new Error('逐页重生成报价与当前请求不匹配。');
  }
  return {
    ...(prepared.quoteIntent.aspectRatio
      ? { aspectRatio: prepared.quoteIntent.aspectRatio }
      : {}),
    derivedTaskId: prepared.task.id,
    derivedWorkId: prepared.work.id,
    instruction,
    pageId: page.id,
    quantity: prepared.quoteIntent.quantity,
    quote,
    scope,
    source,
  };
}

export async function confirmComposerNotePlanPageRegeneration(input: {
  pending: PendingComposerNotePlanPageRegeneration;
  submit?: ComposerNotePlanCommandSubmit;
}) {
  const submit = input.submit ?? submitP1Command;
  const pending = input.pending;
  return (await submit(
    'result-delivery',
    'result_adjust',
    {
      billingQuoteId: pending.quote.quoteId,
      derivedTaskId: pending.derivedTaskId,
      derivedWorkId: pending.derivedWorkId,
      instruction: pending.instruction,
      scope: pending.scope,
      source: pending.source,
    },
    `note-regenerate-confirm:${pending.derivedWorkId}:${pending.quote.quoteId}`
  )) as {
    contentPackage: { id: string };
    task: { id: string };
    work: { id: string };
  };
}
