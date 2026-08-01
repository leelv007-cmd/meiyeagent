/**
 * Static Creation Experience seeds (D-098 C3).
 *
 * Lens = frozen enum projection (no publish lifecycle).
 * ToolEntry = static registry seed (no publish lifecycle).
 * First-ship six-card / eight-variant Recipe + Surface seeds live in
 * `launch-seeds.ts` (A2 / #89) and publish via CatalogService.
 */

import type { CreationLensSeed, CreativeToolEntry } from '@meiye/contracts';
import { creationLensIds } from '@meiye/contracts';

const LENS_LABELS: Record<(typeof creationLensIds)[number], string> = {
  copy: '文案',
  image_text: '图文',
  video: '视频',
};

/** Static lens enum seeds — three user-facing creation lenses (D-081). */
export const CREATION_LENS_SEEDS: readonly CreationLensSeed[] =
  creationLensIds.map((id) => ({
    id,
    label: LENS_LABELS[id],
  }));

/**
 * Minimal static tool registry seed for A1.
 * A2/C3 expand presentation and availability gates; lifecycle stays static.
 */
export const TOOL_ENTRY_SEEDS: readonly CreativeToolEntry[] = [
  {
    id: 'tool.multi_size',
    label: '多尺寸适配',
    summary: '将成品适配到多个发布尺寸',
    kind: 'standalone_tool',
    container: 'dialog',
    order: 1,
  },
  {
    id: 'tool.batch_bg_remove',
    label: '批量去背景',
    summary: '批量去除素材背景',
    kind: 'standalone_tool',
    container: 'dialog',
    order: 2,
  },
  {
    id: 'tool.subtitle_erase',
    label: '字幕擦除',
    summary: '擦除视频字幕以便重配',
    kind: 'standalone_tool',
    container: 'dialog',
    order: 3,
  },
];

export const TOOL_ENTRY_ID_SET: ReadonlySet<string> = new Set(
  TOOL_ENTRY_SEEDS.map((entry) => entry.id),
);

export function listCreationLensSeeds(): CreationLensSeed[] {
  return CREATION_LENS_SEEDS.map((seed) => ({ ...seed }));
}

export function listToolEntrySeeds(): CreativeToolEntry[] {
  return TOOL_ENTRY_SEEDS.map((entry) => ({ ...entry }));
}

export function getToolEntrySeed(
  toolEntryId: string,
): CreativeToolEntry | null {
  return TOOL_ENTRY_SEEDS.find((entry) => entry.id === toolEntryId) ?? null;
}
