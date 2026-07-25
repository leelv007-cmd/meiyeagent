/**
 * Composer home tools strip (C3 / #97, D-077 / D-078 / D-092).
 *
 * Desktop ≤3 / mobile ≤2 ordinary tools.
 * Pro Studio is a full-width banner → /pro-studio canonical gate only.
 * Capability-unpublished tools are hidden (not counted, not shown).
 * Entitlement-locked tools may show with lock reason.
 *
 * R-08 / #211: the Pro Studio banner state is read from the canonical
 * entitlement projection only. Absent an answer it is `unknown` — never the
 * seed-defaulted `active` that promised entry before the gate refused it.
 */

import {
  canEnterProStudio,
  type ProStudioEntitlementState,
} from '@/lib/pro-studio-entitlement';

import {
  PRO_STUDIO_CANONICAL_PATH,
  buildComposerCatalogHref,
} from './composer-nav';
import {
  COMPOSER_TOOL_ENTRY_SEEDS,
  type ComposerToolEntrySeed,
  type OrdinaryToolEntrySeed,
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

export type ProStudioBannerView = {
  id: 'tool.pro_studio';
  label: string;
  summary: string;
  /** Always the canonical gate path. */
  href: string;
  status: ProStudioEntitlementState;
  /** Mirrors the route gate verdict — presentation may never promise more. */
  canEnter: boolean;
  lockReason?: string;
  ctaLabel: string;
};

export type ComposerToolsStripView = {
  ordinary: ComposerToolChipView[];
  proStudio: ProStudioBannerView | null;
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
  /**
   * Pro Studio entitlement from the canonical projection
   * (`lib/pro-studio-entitlement`). Omitted = not read yet = `unknown`.
   */
  proStudioStatus?: ProStudioEntitlementState;
  proStudioLockReason?: string;
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
 * Ordinary tools for the home strip (excludes Pro Studio banner).
 * Caps: desktop ≤3, mobile ≤2. Does not pad with unavailable tools.
 */
export function listOrdinaryHomeTools(
  input: ComposerToolsStripInput
): ComposerToolChipView[] {
  const cap = ORDINARY_TOOL_CAP[input.viewport];
  const seeds = input.tools ?? COMPOSER_TOOL_ENTRY_SEEDS;
  return seeds
    .filter(
      (tool): tool is OrdinaryToolEntrySeed =>
        !tool.isProStudioBanner &&
        isPublishedVisible(tool, input.capabilityGateOpen)
    )
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

/** CTA copy per entitlement state. Only `active` may promise entry (R-08). */
const PRO_STUDIO_CTA_LABEL: Record<ProStudioEntitlementState, string> = {
  active: '进入专业工作区',
  locked: '了解并解锁',
  unknown: '查看权益状态',
};

const PRO_STUDIO_FALLBACK_REASON: Record<
  Exclude<ProStudioEntitlementState, 'active'>,
  string
> = {
  locked: '尚未开通 Pro Studio',
  unknown: '权益状态读取中，暂不可进入',
};

/** Pro Studio full-width banner projection. Hidden when capability unpublished. */
export function projectProStudioBanner(
  input: ComposerToolsStripInput
): ProStudioBannerView | null {
  const seeds = input.tools ?? COMPOSER_TOOL_ENTRY_SEEDS;
  const entry =
    seeds.find((tool) => tool.isProStudioBanner) ??
    seeds.find((tool) => tool.id === 'tool.pro_studio');
  if (!entry) return null;
  if (!isPublishedVisible(entry, input.capabilityGateOpen)) return null;

  // No seed fallback: absent a canonical answer the honest state is `unknown`.
  const status: ProStudioEntitlementState = input.proStudioStatus ?? 'unknown';
  const lockReason =
    status === 'active'
      ? undefined
      : (input.proStudioLockReason ?? PRO_STUDIO_FALLBACK_REASON[status]);

  return {
    id: 'tool.pro_studio',
    label: entry.label,
    summary: entry.summary,
    href: PRO_STUDIO_CANONICAL_PATH,
    status,
    canEnter: canEnterProStudio(status),
    ...(lockReason ? { lockReason } : {}),
    ctaLabel: PRO_STUDIO_CTA_LABEL[status],
  };
}

/** Full home tools strip view model. */
export function projectComposerToolsStrip(
  input: ComposerToolsStripInput
): ComposerToolsStripView {
  const ordinary = listOrdinaryHomeTools(input);
  const proStudio = projectProStudioBanner(input);
  return {
    ordinary,
    proStudio,
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

/**
 * Open an ordinary tool or Pro Studio via typed handoff.
 * Pro Studio href is always the canonical gate (no Canvas deep link).
 */
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
  return openToolWithHandoff(handoff, {
    proStudioPath: PRO_STUDIO_CANONICAL_PATH,
  });
}

/**
 * Assert Pro Studio never bypasses the canonical gate via Canvas deep links.
 */
export function assertProStudioCanonicalHref(href: string): void {
  const path = href.split('?')[0] ?? href;
  if (path !== PRO_STUDIO_CANONICAL_PATH) {
    throw new Error(
      `Pro Studio must use canonical gate ${PRO_STUDIO_CANONICAL_PATH}, got: ${path}`
    );
  }
  if (/canvas|launchUrl|sso/i.test(href)) {
    throw new Error(
      `Pro Studio href must not deep-link Canvas / SSO bypass: ${href}`
    );
  }
}
