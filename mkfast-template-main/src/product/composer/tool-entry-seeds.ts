/**
 * Browser-side CreativeToolEntry seeds (C3 / #97, D-092 / D-098 C3).
 *
 * Mirror of core `static-seeds` TOOL_ENTRY_SEEDS — browser must not import core.
 * Registry metadata for planned tools. Only entries whose complete execution
 * chain has been verified may set `capabilityPublished` to true.
 *
 * Pro Studio (`tool.pro_studio`) retired — D-170 / P1 fail-closed.
 */

import type { CreativeToolContainer, CreativeToolKind } from '@meiye/contracts';

import type { STANDALONE_TOOL_ENTRY_IDS } from './tool-handoff';

/** Task-language tool categories (D-093). */
export const TOOL_CATALOG_CATEGORIES = [
  'all',
  'image',
  'video',
  'publish',
] as const;

export type ToolCatalogCategory = (typeof TOOL_CATALOG_CATEGORIES)[number];

export const TOOL_CATALOG_CATEGORY_LABELS: Record<ToolCatalogCategory, string> =
  {
    all: '全部',
    image: '图片处理',
    video: '视频处理',
    publish: '发布与适配',
  };

export type ComposerToolEntrySeed = {
  id: (typeof STANDALONE_TOOL_ENTRY_IDS)[number];
  label: string;
  summary: string;
  kind: CreativeToolKind;
  container: CreativeToolContainer;
  order: number;
  /** Task-language categories this tool belongs to (excluding synthetic "all"). */
  categories: Exclude<ToolCatalogCategory, 'all'>[];
  /**
   * Capability / entitlement gate. Unpublished or capability-gated tools stay
   * hidden from published-visible counts (D-093).
   */
  capabilityPublished: boolean;
  /** Entitlement lock (visible with reason when capability is published). */
  entitlementLocked: boolean;
  lockReason?: string;
};

/**
 * Planned standalone tools. Remain unpublished until input, preview, submit,
 * task and billing are all wired and acceptance-tested.
 */
export const COMPOSER_TOOL_ENTRY_SEEDS: readonly ComposerToolEntrySeed[] = [
  {
    id: 'tool.multi_size',
    label: '多平台尺寸重排导出',
    summary: '将成品适配到多个发布尺寸并导出',
    kind: 'standalone_tool',
    container: 'dialog',
    order: 1,
    categories: ['image', 'publish'],
    capabilityPublished: false,
    entitlementLocked: false,
  },
  {
    id: 'tool.batch_bg_remove',
    label: '批量去背景',
    summary: '批量去除素材背景',
    kind: 'standalone_tool',
    container: 'dialog',
    order: 2,
    categories: ['image'],
    capabilityPublished: false,
    entitlementLocked: false,
  },
  {
    id: 'tool.subtitle_erase',
    label: '字幕擦除修复',
    summary: '擦除视频字幕以便重配',
    kind: 'standalone_tool',
    container: 'route',
    order: 3,
    categories: ['video'],
    capabilityPublished: false,
    entitlementLocked: false,
  },
];

export function listComposerToolEntrySeeds(): ComposerToolEntrySeed[] {
  return COMPOSER_TOOL_ENTRY_SEEDS.map((entry) => structuredClone(entry));
}

export function getComposerToolEntrySeed(
  toolEntryId: string
): ComposerToolEntrySeed | null {
  return (
    COMPOSER_TOOL_ENTRY_SEEDS.find((entry) => entry.id === toolEntryId) ?? null
  );
}
