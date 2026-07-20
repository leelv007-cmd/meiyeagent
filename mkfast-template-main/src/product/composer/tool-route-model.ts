import { buildComposerCatalogHref } from './composer-nav';
import { getComposerToolEntrySeed } from './tool-entry-seeds';
import {
  projectToolHandoff,
  returnFromToolHandoff,
  type ToolHandoff,
} from './tool-handoff';

const ORDINARY_TOOL_IDS = new Set([
  'tool.multi_size',
  'tool.batch_bg_remove',
  'tool.subtitle_erase',
]);
const SEARCH_KEYS = new Set([
  'sourceKind',
  'sourceId',
  'sourceRevisionId',
  'role',
  'minimalSettings',
  'returnToDraftKey',
  'focusKey',
  'surfaceRevisionId',
]);

export type OrdinaryToolSearch = {
  sourceKind?: string;
  sourceId?: string;
  sourceRevisionId?: string;
  role?: string;
  minimalSettings?: Record<string, string | number | boolean>;
  returnToDraftKey?: string;
  focusKey?: string;
  surfaceRevisionId?: string;
  invalid?: true;
};

export function validateOrdinaryToolSearch(
  search: Record<string, unknown>
): OrdinaryToolSearch {
  if (Object.keys(search).some((key) => !SEARCH_KEYS.has(key))) {
    return { invalid: true };
  }
  const raw: Record<string, unknown> = { toolEntryId: 'tool.multi_size' };
  for (const key of SEARCH_KEYS) {
    const value = search[key];
    if (value === undefined) continue;
    if (key === 'minimalSettings' && typeof value === 'string') {
      try {
        raw[key] = JSON.parse(value) as unknown;
      } catch {
        return { invalid: true };
      }
    } else {
      raw[key] = value;
    }
  }
  const projected = projectToolHandoff(raw);
  if (!projected.ok) return { invalid: true };
  const { toolEntryId: _toolEntryId, ...safe } = projected.handoff;
  return safe;
}

export type OrdinaryToolRouteResolution =
  | { kind: 'invalid' | 'not_found' }
  | {
      kind: 'ok';
      handoff: ToolHandoff;
      title: string;
      summary: string;
      backHref: string;
      sideEffects: [];
    };

export function resolveOrdinaryToolRoute(
  toolEntryId: string,
  search: OrdinaryToolSearch
): OrdinaryToolRouteResolution {
  if (search.invalid) return { kind: 'invalid' };
  if (!ORDINARY_TOOL_IDS.has(toolEntryId)) return { kind: 'not_found' };
  const tool = getComposerToolEntrySeed(toolEntryId);
  if (!tool?.capabilityPublished) return { kind: 'not_found' };
  const projected = projectToolHandoff({ toolEntryId, ...search });
  if (!projected.ok) return { kind: 'invalid' };
  const returned = returnFromToolHandoff(projected.handoff);
  return {
    kind: 'ok',
    handoff: projected.handoff,
    title: tool.label,
    summary: tool.summary,
    backHref: buildComposerCatalogHref({
      tab: 'tools',
      ...(returned.returnToDraftKey
        ? { returnKey: returned.returnToDraftKey }
        : {}),
      ...(projected.handoff.surfaceRevisionId
        ? { surfaceRevisionId: projected.handoff.surfaceRevisionId }
        : {}),
    }),
    sideEffects: [],
  };
}
