/**
 * Viral adapt (爆款复刻) — paste-track first (#324 / P2-12).
 *
 * Spec: docs/specs/xhs-vertical-integration-spec-2026-08-01.md §4.3 / §5 / §8.3 P2-4.
 *
 * Dual-track sourcing:
 * - paste (先行): merchant pastes note text and/or uploads reference images
 * - opencli_link: reserved UI slot; live-gated (#328 owns verification)
 *
 * Red lines (§5.3): no anonymous scrape, no signature reverse-engineering,
 * no account pools. This module never fetches remote XHS note HTML.
 */

import { contentPackageCarrierOf } from '@meiye/contracts';

import { HARNESS_BUILTIN_PROMPTS } from './langfuse-prompts.js';

/** Embedded in merchant rawInput so the note path can detect viral paste track. */
export const VIRAL_ADAPT_SOURCE_MARKER = '[viral_adapt_source:paste]' as const;

export type ViralSourcingTrack = 'paste' | 'opencli_link';

export type ViralOpenCliLiveGate = {
  /** True only after real-account OpenCLI note+download evidence (#328). */
  available: boolean;
  /** Merchant-facing honesty when unavailable. Never claim 「已可用」while closed. */
  statusLabel: string;
  reasonCode: 'live_gate_unverified' | 'live_gate_verified';
};

export type ViralPasteSource = {
  track: 'paste';
  /** Pasted note body / title / tags as the merchant copied them. */
  noteText: string;
  /** Optional reference image asset ids (upload track). */
  imageAssetIds: readonly string[];
};

export type ViralAdaptConfirmProjection = {
  schemaVersion: 'viral-adapt-confirm/v1';
  /** Explicit sourcing method — confirm card must surface this. */
  sourceMethod: {
    track: ViralSourcingTrack;
    label: string;
    detail: string;
  };
  /** OpenCLI slot honesty (reserved even when paste is the active track). */
  opencliSlot: {
    available: boolean;
    label: string;
    statusLabel: string;
  };
  /** Deliverable / recipe specs shown on the confirm card. */
  specs: ReadonlyArray<{
    key: string;
    label: string;
    value: string;
  }>;
};

export type ViralRewriteResult = {
  schemaVersion: 'viral-adapt-rewrite/v1';
  sourceTrack: 'paste';
  title: string;
  body: string;
  tags: readonly string[];
  /** Merchant-language summary of how source material was obtained. */
  sourceSummary: string;
  /** rawInput for the existing image_text_note pipeline. */
  merchantIntent: string;
};

export type ViralAdaptNotePackageProjection = {
  kind: 'image_text';
  orderedAssetIds: readonly string[];
  carrier: 'note' | 'copy' | 'media';
  title: string;
  body: string;
  sourceTrack: 'paste';
  sourceSummary: string;
};

/**
 * OpenCLI live gate. Closed by default until #328 records evidence.
 * Callers may pass `evidencePresent: true` only when a real verification
 * record exists — never invent availability from historical notes.
 */
export function resolveOpenCliLiveGate(input: {
  evidencePresent?: boolean;
} = {}): ViralOpenCliLiveGate {
  if (input.evidencePresent === true) {
    return {
      available: true,
      statusLabel: '已通过 live 核销，可用本机登录态读笔记',
      reasonCode: 'live_gate_verified',
    };
  }
  return {
    available: false,
    statusLabel: '暂不可用（OpenCLI live 门未核销）',
    reasonCode: 'live_gate_unverified',
  };
}

/** Tracks the merchant may select given the live gate. */
export function availableViralSourcingTracks(
  gate: ViralOpenCliLiveGate,
): readonly ViralSourcingTrack[] {
  return gate.available ? (['paste', 'opencli_link'] as const) : (['paste'] as const);
}

export function isOpenCliTrackSelectable(
  gate: ViralOpenCliLiveGate,
): boolean {
  return gate.available;
}

/**
 * Normalize paste source. Empty note text is rejected — paste track needs
 * merchant-supplied material (no scrape fallback).
 */
export function normalizeViralPasteSource(input: {
  noteText: string;
  imageAssetIds?: readonly string[];
}): ViralPasteSource | { error: 'empty_note_text' } {
  const noteText = input.noteText.replace(/\r\n/gu, '\n').trim();
  if (!noteText) return { error: 'empty_note_text' };
  const imageAssetIds = (input.imageAssetIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return {
    track: 'paste',
    noteText,
    imageAssetIds,
  };
}

/** Compose durable rawInput for admission / note path. */
export function composeViralAdaptRawInput(source: ViralPasteSource): string {
  const images =
    source.imageAssetIds.length > 0
      ? `\n参考图资产：${source.imageAssetIds.join(', ')}`
      : '';
  return [
    VIRAL_ADAPT_SOURCE_MARKER,
    '请按本店项目仿写复刻以下爆款笔记（取材=商家粘贴，非链接自动读取）：',
    source.noteText,
    images,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function isViralAdaptPasteRequest(rawInput: string): boolean {
  return rawInput.includes(VIRAL_ADAPT_SOURCE_MARKER);
}

export function parseViralAdaptPasteSource(
  rawInput: string,
): ViralPasteSource | null {
  if (!isViralAdaptPasteRequest(rawInput)) return null;
  const withoutMarker = rawInput
    .replace(VIRAL_ADAPT_SOURCE_MARKER, '')
    .replace(
      /请按本店项目仿写复刻以下爆款笔记（取材=商家粘贴，非链接自动读取）：\n?/u,
      '',
    );
  const imageMatch = withoutMarker.match(/参考图资产：([^\n]+)/u);
  const imageAssetIds = imageMatch?.[1]
    ? imageMatch[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  const noteText = withoutMarker
    .replace(/参考图资产：[^\n]*/u, '')
    .trim();
  if (!noteText) return null;
  return { track: 'paste', noteText, imageAssetIds };
}

/**
 * Confirm-card projection — must explicitly name the sourcing method (P2-4).
 */
export function projectViralAdaptConfirm(input: {
  source: ViralPasteSource;
  liveGate?: ViralOpenCliLiveGate;
  pageBound?: number;
  aspectRatio?: '3:4' | '1:1' | '9:16';
}): ViralAdaptConfirmProjection {
  const gate = input.liveGate ?? resolveOpenCliLiveGate();
  const pageBound = input.pageBound ?? 3;
  const aspectRatio = input.aspectRatio ?? '3:4';
  const hasImages = input.source.imageAssetIds.length > 0;
  const detailParts = [
    `已粘贴 ${input.source.noteText.length} 字`,
    hasImages
      ? `已上传 ${input.source.imageAssetIds.length} 张参考图`
      : '未上传参考图',
  ];
  return {
    schemaVersion: 'viral-adapt-confirm/v1',
    sourceMethod: {
      track: 'paste',
      label: hasImages ? '粘贴笔记文字 + 上传图片' : '粘贴笔记文字',
      detail: detailParts.join('；'),
    },
    opencliSlot: {
      available: gate.available,
      label: '链接取材（OpenCLI 本机登录态）',
      statusLabel: gate.statusLabel,
    },
    specs: [
      { key: 'deliverable', label: '产出形态', value: '小红书笔记（note）' },
      { key: 'platform', label: '平台', value: '小红书' },
      { key: 'aspect', label: '比例', value: aspectRatio },
      { key: 'pages', label: '页数', value: `${pageBound} 页` },
      {
        key: 'source_track',
        label: '取材方式',
        value: hasImages ? '粘贴笔记文字 + 上传图片' : '粘贴笔记文字',
      },
    ],
  };
}

/**
 * Fixture / deterministic rewrite for tests and pilot fallback when the
 * structured provider is not exercised. Production LLM path uses
 * `harness/xhs-viral-rewrite` (see langfuse-prompts).
 */
export function fixtureViralRewrite(source: ViralPasteSource): ViralRewriteResult {
  const lines = source.noteText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? '美业门店笔记';
  const title = firstLine
    .replace(/^【标题】/u, '')
    .replace(/^#+\s*/u, '')
    .slice(0, 40);
  const body =
    lines.slice(1).join('\n').trim() ||
    `基于参考笔记改写：${source.noteText.slice(0, 280)}`;
  const tags = ['美业', '门店种草', '到店体验', '小红书笔记'];
  const sourceSummary =
    source.imageAssetIds.length > 0
      ? '取材：商家粘贴笔记文字 + 上传参考图（非链接自动读取）'
      : '取材：商家粘贴笔记文字（非链接自动读取）';
  const merchantIntent = composeViralAdaptRawInput(source);
  return {
    schemaVersion: 'viral-adapt-rewrite/v1',
    sourceTrack: 'paste',
    title: title || '美业门店笔记',
    body,
    tags,
    sourceSummary,
    merchantIntent,
  };
}

/**
 * Note-path package projection. Selected versions with ordered assets
 * derive carrier = note (D-171 / #319).
 */
export function projectViralAdaptNotePackage(input: {
  rewrite: ViralRewriteResult;
  orderedAssetIds: readonly string[];
}): ViralAdaptNotePackageProjection {
  const orderedAssetIds = [...input.orderedAssetIds];
  const carrier = contentPackageCarrierOf({
    kind: 'image_text',
    orderedAssetCount: orderedAssetIds.length,
  });
  return {
    kind: 'image_text',
    orderedAssetIds,
    carrier,
    title: input.rewrite.title,
    body: input.rewrite.body,
    sourceTrack: 'paste',
    sourceSummary: input.rewrite.sourceSummary,
  };
}

/**
 * Production-path helper: paste track → rewrite → note package shape.
 * Callers still run the full image_text_note workflow for media generation;
 * this seals the carrier contract for the viral adapt entry.
 */
export function runViralAdaptPasteToNoteProjection(input: {
  noteText: string;
  imageAssetIds?: readonly string[];
  /** Asset ids produced by the note media stage (fixture or live). */
  generatedAssetIds: readonly string[];
}):
  | { ok: true; confirm: ViralAdaptConfirmProjection; package: ViralAdaptNotePackageProjection; rewrite: ViralRewriteResult }
  | { ok: false; error: 'empty_note_text' | 'note_requires_assets' } {
  const source = normalizeViralPasteSource({
    noteText: input.noteText,
    imageAssetIds: input.imageAssetIds,
  });
  if ('error' in source) return { ok: false, error: source.error };
  if (input.generatedAssetIds.length === 0) {
    return { ok: false, error: 'note_requires_assets' };
  }
  const rewrite = fixtureViralRewrite(source);
  const confirm = projectViralAdaptConfirm({ source });
  const pkg = projectViralAdaptNotePackage({
    rewrite,
    orderedAssetIds: input.generatedAssetIds,
  });
  return { ok: true, confirm, package: pkg, rewrite };
}

/**
 * Production consumer for `xhsViralRewrite` (#324 / D-150).
 * When the note-plan input carries the paste-track marker, prepend the viral
 * rewrite system prompt so the existing image_text_note plan stage adapts
 * merchant-pasted material instead of free-form creation.
 */
export function notePlanInstructionsForViralAdapt(input: {
  baseInstructions: string;
  /** JSON blob or structured plan input that may embed rawInput. */
  planInput: unknown;
  viralRewritePrompt?: string;
}): { instructions: string; usedViralRewrite: boolean } {
  const blob =
    typeof input.planInput === 'string'
      ? input.planInput
      : JSON.stringify(input.planInput);
  if (!blob.includes(VIRAL_ADAPT_SOURCE_MARKER)) {
    return { instructions: input.baseInstructions, usedViralRewrite: false };
  }
  const viral =
    input.viralRewritePrompt?.trim() ||
    HARNESS_BUILTIN_PROMPTS.xhsViralRewrite;
  return {
    usedViralRewrite: true,
    instructions: [
      viral,
      '---',
      '以下为 NotePlan 结构要求（仿写结果须可落 note 页组）：',
      input.baseInstructions,
    ].join('\n'),
  };
}
