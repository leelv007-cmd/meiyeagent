/**
 * Composer home tools strip (C3 / #97, D-077 / D-078 / D-092).
 *
 * Desktop ≤3 / mobile ≤2 ordinary tools.
 * Capability-unpublished tools are hidden (not counted, not shown).
 * Entitlement-locked tools may show with lock reason.
 *
 * Pro Studio banner retired — D-170 / P1 fail-closed.
 */

import { buildComposerCatalogHref } from './composer-nav';
import {
  COMPOSER_TOOL_ENTRY_SEEDS,
  type ComposerToolEntrySeed,
} from './tool-entry-seeds';
import {
  openToolWithHandoff,
  type ToolHandoff,
  type ToolHandoffOpenResult,
} from './tool-handoff';

export const ORDINARY_TOOL_CAP = {
  desktop: 3,
  mobile: 2,
} as const;

export type ComposerViewportKind = 'desktop' | 'mobile';

export type ComposerToolChipView = {
  id: string;
  label: string;
  summary: string;
  order: number;
  locked: boolean;
  lockReason?: string;
  /** Container hint (dialog | route | workspace) — not a third runtime. */
  container: ComposerToolEntrySeed['container'];
};

export type ComposerToolsStripView = {
  ordinary: ComposerToolChipView[];
  /** "查看全部创作工具" entry. */
  viewAllHref: string;
  viewAllLabel: string;
  viewport: ComposerViewportKind;
  cap: number;
};

export type ComposerToolsStripInput = {
  viewport: ComposerViewportKind;
  /** Override seeds (tests / surface projection). */
  tools?: readonly ComposerToolEntrySeed[];
  /** Opaque return key for catalog / tool handoff. */
  returnKey?: string;
  surfaceRevisionId?: string;
  /** When false, capability-gated tools stay hidden even if in seeds. */
  capabilityGateOpen?: Record<string, boolean>;
};

function isPublishedVisible(
  tool: ComposerToolEntrySeed,
  capabilityGateOpen?: Record<string, boolean>
): boolean {
  if (!tool.capabilityPublished) return false;
  if (capabilityGateOpen && capabilityGateOpen[tool.id] === false) {
    return false;
  }
  return true;
}

/**
 * Ordinary tools for the home strip.
 * Caps: desktop ≤3, mobile ≤2. Does not pad with unavailable tools.
 */
export function listOrdinaryHomeTools(
  input: ComposerToolsStripInput
): ComposerToolChipView[] {
  const cap = ORDINARY_TOOL_CAP[input.viewport];
  const seeds = input.tools ?? COMPOSER_TOOL_ENTRY_SEEDS;
  return seeds
    .filter((tool) => isPublishedVisible(tool, input.capabilityGateOpen))
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, cap)
    .map((tool) => ({
      id: tool.id,
      label: tool.label,
      summary: tool.summary,
      order: tool.order,
      locked: tool.entitlementLocked,
      ...(tool.entitlementLocked && tool.lockReason
        ? { lockReason: tool.lockReason }
        : {}),
      container: tool.container,
    }));
}

/** Full home tools strip view model. */
export function projectComposerToolsStrip(
  input: ComposerToolsStripInput
): ComposerToolsStripView {
  const ordinary = listOrdinaryHomeTools(input);
  return {
    ordinary,
    viewAllHref: buildComposerCatalogHref({
      tab: 'tools',
      ...(input.returnKey ? { returnKey: input.returnKey } : {}),
      ...(input.surfaceRevisionId
        ? { surfaceRevisionId: input.surfaceRevisionId }
        : {}),
    }),
    viewAllLabel: '查看全部创作工具',
    viewport: input.viewport,
    cap: ORDINARY_TOOL_CAP[input.viewport],
  };
}

/** Open an ordinary tool via typed handoff. */
export function openComposerTool(
  toolEntryId: string,
  context: {
    sourceKind?: ToolHandoff['sourceKind'];
    sourceId?: string;
    sourceRevisionId?: string;
    role?: string;
    returnToDraftKey?: string;
    focusKey?: string;
    surfaceRevisionId?: string;
    minimalSettings?: ToolHandoff['minimalSettings'];
  } = {}
): ToolHandoffOpenResult {
  const handoff: ToolHandoff = {
    toolEntryId,
    ...context,
  };
  return openToolWithHandoff(handoff);
}
