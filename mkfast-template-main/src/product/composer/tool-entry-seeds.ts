/**
 * Browser-side CreativeToolEntry seeds (C3 / #97, D-092 / D-098 C3).
 *
 * Mirror of core `static-seeds` TOOL_ENTRY_SEEDS — browser must not import core.
 * Four first-ship standalone tools; Pro Studio is a workspace gate entry.
 */

import type { CreativeToolContainer, CreativeToolKind } from '@meiye/contracts';

import { STANDALONE_TOOL_ENTRY_IDS } from './tool-handoff';

/** Task-language tool categories (D-093). */
export const TOOL_CATALOG_CATEGORIES = [
  'all',
  'image',
  'video',
  'publish',
  'pro',
] as const;

export type ToolCatalogCategory = (typeof TOOL_CATALOG_CATEGORIES)[number];

export const TOOL_CATALOG_CATEGORY_LABELS: Record<ToolCatalogCategory, string> =
  {
    all: '全部',
    image: '图片处理',
    video: '视频处理',
    publish: '发布与适配',
    pro: '专业工作区',
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
   * When true, surface as Pro Studio full-width banner — not ordinary tool chip.
   * Ordinary strip never mixes Pro Studio into the ≤2/≤3 slots (D-078/D-092).
   */
  isProStudioBanner: boolean;
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
 * First-ship four standalone tools (D-092):
 * multi-size export, batch bg remove, subtitle erase, Pro Studio canvas.
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
    isProStudioBanner: false,
    capabilityPublished: true,
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
    isProStudioBanner: false,
    capabilityPublished: true,
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
    isProStudioBanner: false,
    capabilityPublished: true,
    entitlementLocked: false,
  },
  {
    id: 'tool.pro_studio',
    label: 'Pro Studio 无限画布',
    summary: '进入专业工作区精修多素材编排',
    kind: 'standalone_tool',
    container: 'workspace',
    order: 10,
    categories: ['pro'],
    isProStudioBanner: true,
    capabilityPublished: true,
    entitlementLocked: false,
  },
];

export function listComposerToolEntrySeeds(): ComposerToolEntrySeed[] {
  return COMPOSER_TOOL_ENTRY_SEEDS.map((entry) => ({
    ...entry,
    categories: [...entry.categories],
  }));
}

export function getComposerToolEntrySeed(
  toolEntryId: string
): ComposerToolEntrySeed | null {
  return (
    COMPOSER_TOOL_ENTRY_SEEDS.find((entry) => entry.id === toolEntryId) ?? null
  );
}
