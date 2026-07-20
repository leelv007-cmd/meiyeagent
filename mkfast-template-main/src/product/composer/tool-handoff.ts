/**
 * Typed ToolHandoff (C3 / #97, D-077 / D-092).
 *
 * Cross-entry context for four standalone tools.
 * Field whitelist only — URL / sessionStorage must never carry body text,
 * asset authorization, hidden prompt, Provider, or a full composer draft.
 * Open / preview / return = zero business writes.
 */

/** Four first-ship standalone tool entry ids (D-092). */
export const STANDALONE_TOOL_ENTRY_IDS = [
  'tool.multi_size',
  'tool.batch_bg_remove',
  'tool.subtitle_erase',
  'tool.pro_studio',
] as const;

export type StandaloneToolEntryId = (typeof STANDALONE_TOOL_ENTRY_IDS)[number];

export const TOOL_SOURCE_KINDS = [
  'work',
  'content',
  'asset',
  'content_package',
] as const;

export type ToolSourceKind = (typeof TOOL_SOURCE_KINDS)[number];

/**
 * Allowlisted ToolHandoff fields (stable ids / revision / role / minimal settings).
 * Anything else is stripped or rejected.
 */
export type ToolHandoff = {
  toolEntryId: StandaloneToolEntryId | string;
  sourceKind?: ToolSourceKind;
  sourceId?: string;
  sourceRevisionId?: string;
  /** Adoption / slot role (primary | cover | gallery | standalone …). */
  role?: string;
  /**
   * Minimal non-sensitive settings only (scalar values).
   * Never prompt bodies, provider profiles, or full drafts.
   */
  minimalSettings?: Record<string, string | number | boolean>;
  returnToDraftKey?: string;
  focusKey?: string;
  surfaceRevisionId?: string;
};

/** Keys allowed on a serialized ToolHandoff (URL / sessionStorage). */
export const TOOL_HANDOFF_ALLOWED_KEYS = [
  'toolEntryId',
  'sourceKind',
  'sourceId',
  'sourceRevisionId',
  'role',
  'minimalSettings',
  'returnToDraftKey',
  'focusKey',
  'surfaceRevisionId',
] as const;

export type ToolHandoffAllowedKey = (typeof TOOL_HANDOFF_ALLOWED_KEYS)[number];

/**
 * Forbidden sensitive keys — must never appear in handoff URL/session payload.
 * Mirrors D-077 / D-092 + browser channel boundary.
 */
export const FORBIDDEN_TOOL_HANDOFF_KEYS = [
  'body',
  'text',
  'userText',
  'intent',
  'prompt',
  'promptBody',
  'hiddenPrompt',
  'systemPrompt',
  'authorization',
  'auth',
  'assetRights',
  'rights',
  'provider',
  'Provider',
  'providerProfile',
  'ProviderProfile',
  'deployment',
  'credential',
  'Credential',
  'draft',
  'fullDraft',
  'composerDraft',
  'settings',
  'sources',
  'password',
  'token',
  'apiKey',
  'secret',
] as const;

const ALLOWED_SET = new Set<string>(TOOL_HANDOFF_ALLOWED_KEYS);
const FORBIDDEN_SET = new Set<string>(
  FORBIDDEN_TOOL_HANDOFF_KEYS.map((k) => k.toLowerCase())
);

export type ToolHandoffValidation =
  | { ok: true; handoff: ToolHandoff }
  | { ok: false; reason: string; forbiddenKey?: string };

function isScalarSetting(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isSourceKind(value: unknown): value is ToolSourceKind {
  return (
    typeof value === 'string' &&
    (TOOL_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Deep-scan for forbidden sensitive keys in a raw bag.
 * Returns first forbidden path or null.
 */
export function findForbiddenToolHandoffKey(
  value: unknown,
  path = '$'
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenToolHandoffKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key.toLowerCase())) {
      return `${path}.${key}`;
    }
    // Nested bags under minimalSettings still scanned for forbidden names.
    const hit = findForbiddenToolHandoffKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

/** Project an unknown bag into a whitelist-only ToolHandoff. */
export function projectToolHandoff(raw: unknown): ToolHandoffValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'handoff must be an object' };
  }
  const bag = raw as Record<string, unknown>;

  const forbidden = findForbiddenToolHandoffKey(bag);
  if (forbidden) {
    return {
      ok: false,
      reason: `forbidden sensitive key: ${forbidden}`,
      forbiddenKey: forbidden,
    };
  }

  for (const key of Object.keys(bag)) {
    if (!ALLOWED_SET.has(key)) {
      return {
        ok: false,
        reason: `key not on whitelist: ${key}`,
        forbiddenKey: key,
      };
    }
  }

  const toolEntryId = bag.toolEntryId;
  if (typeof toolEntryId !== 'string' || !toolEntryId.trim()) {
    return { ok: false, reason: 'toolEntryId is required' };
  }

  const handoff: ToolHandoff = { toolEntryId: toolEntryId.trim() };

  if (bag.sourceKind !== undefined) {
    if (!isSourceKind(bag.sourceKind)) {
      return { ok: false, reason: 'sourceKind invalid' };
    }
    handoff.sourceKind = bag.sourceKind;
  }
  if (typeof bag.sourceId === 'string' && bag.sourceId.trim()) {
    handoff.sourceId = bag.sourceId.trim();
  }
  if (typeof bag.sourceRevisionId === 'string' && bag.sourceRevisionId.trim()) {
    handoff.sourceRevisionId = bag.sourceRevisionId.trim();
  }
  if (typeof bag.role === 'string' && bag.role.trim()) {
    handoff.role = bag.role.trim();
  }
  if (typeof bag.returnToDraftKey === 'string' && bag.returnToDraftKey.trim()) {
    handoff.returnToDraftKey = bag.returnToDraftKey.trim();
  }
  if (typeof bag.focusKey === 'string' && bag.focusKey.trim()) {
    handoff.focusKey = bag.focusKey.trim();
  }
  if (typeof bag.surfaceRevisionId === 'string' && bag.surfaceRevisionId.trim()) {
    handoff.surfaceRevisionId = bag.surfaceRevisionId.trim();
  }

  if (bag.minimalSettings !== undefined) {
    if (
      !bag.minimalSettings ||
      typeof bag.minimalSettings !== 'object' ||
      Array.isArray(bag.minimalSettings)
    ) {
      return { ok: false, reason: 'minimalSettings must be a scalar map' };
    }
    const settings: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(
      bag.minimalSettings as Record<string, unknown>
    )) {
      if (FORBIDDEN_SET.has(k.toLowerCase())) {
        return {
          ok: false,
          reason: `forbidden key in minimalSettings: ${k}`,
          forbiddenKey: k,
        };
      }
      if (!isScalarSetting(v)) {
        return {
          ok: false,
          reason: `minimalSettings.${k} must be string|number|boolean`,
        };
      }
      settings[k] = v;
    }
    handoff.minimalSettings = settings;
  }

  return { ok: true, handoff };
}

/** Serialize handoff to URL search params (whitelist only). */
export function serializeToolHandoffToSearchParams(
  handoff: ToolHandoff
): URLSearchParams {
  const projected = projectToolHandoff(handoff);
  if (!projected.ok) {
    throw new Error(projected.reason);
  }
  const clean = projected.handoff;
  const params = new URLSearchParams();
  params.set('toolEntryId', clean.toolEntryId);
  if (clean.sourceKind) params.set('sourceKind', clean.sourceKind);
  if (clean.sourceId) params.set('sourceId', clean.sourceId);
  if (clean.sourceRevisionId) {
    params.set('sourceRevisionId', clean.sourceRevisionId);
  }
  if (clean.role) params.set('role', clean.role);
  if (clean.returnToDraftKey) {
    params.set('returnToDraftKey', clean.returnToDraftKey);
  }
  if (clean.focusKey) params.set('focusKey', clean.focusKey);
  if (clean.surfaceRevisionId) {
    params.set('surfaceRevisionId', clean.surfaceRevisionId);
  }
  if (clean.minimalSettings && Object.keys(clean.minimalSettings).length > 0) {
    // Compact JSON of scalar map only — still whitelist-validated.
    params.set('minimalSettings', JSON.stringify(clean.minimalSettings));
  }
  return params;
}

/** Parse handoff from URL search params. */
export function parseToolHandoffFromSearchParams(
  params: URLSearchParams
): ToolHandoffValidation {
  const raw: Record<string, unknown> = {};
  const toolEntryId = params.get('toolEntryId');
  if (toolEntryId) raw.toolEntryId = toolEntryId;
  for (const key of [
    'sourceKind',
    'sourceId',
    'sourceRevisionId',
    'role',
    'returnToDraftKey',
    'focusKey',
    'surfaceRevisionId',
  ] as const) {
    const value = params.get(key);
    if (value) raw[key] = value;
  }
  const settingsRaw = params.get('minimalSettings');
  if (settingsRaw) {
    try {
      raw.minimalSettings = JSON.parse(settingsRaw) as unknown;
    } catch {
      return { ok: false, reason: 'minimalSettings is not valid JSON' };
    }
  }
  // Reject any extra query keys that look sensitive.
  for (const key of params.keys()) {
    if (key === 'minimalSettings') continue;
    if (!ALLOWED_SET.has(key) && FORBIDDEN_SET.has(key.toLowerCase())) {
      return {
        ok: false,
        reason: `forbidden query key: ${key}`,
        forbiddenKey: key,
      };
    }
  }
  return projectToolHandoff(raw);
}

/**
 * Build a tool open href. Pro Studio always hits the canonical gate.
 * Other tools use a relative path under catalog / tool host — never Canvas deep links.
 */
export function buildToolOpenHref(
  handoff: ToolHandoff,
  options?: { toolBasePath?: string; proStudioPath?: string }
): string {
  const projected = projectToolHandoff(handoff);
  if (!projected.ok) {
    throw new Error(projected.reason);
  }
  const clean = projected.handoff;
  const isProStudio =
    clean.toolEntryId === 'tool.pro_studio' ||
    clean.toolEntryId.endsWith('pro_studio');
  if (isProStudio) {
    // Canonical gate only — no Canvas deep-link bypass (D-077).
    const base = options?.proStudioPath ?? '/pro-studio';
    const params = serializeToolHandoffToSearchParams(clean);
    // Pro Studio gate does not need toolEntryId in query (path is the gate).
    params.delete('toolEntryId');
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
  const base = options?.toolBasePath ?? `/dashboard/tools/${clean.toolEntryId}`;
  const params = serializeToolHandoffToSearchParams(clean);
  params.delete('toolEntryId'); // already in path
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Open/return side-effect ledger — always empty for handoff navigation.
 * Present so tests assert zero Work/Task/Job/ContentPackage writes.
 */
export const TOOL_HANDOFF_FORBIDDEN_WRITES = [
  'Work',
  'Task',
  'Job',
  'ContentPackage',
  'QuotaHold',
] as const;

export type ToolHandoffWriteKind =
  (typeof TOOL_HANDOFF_FORBIDDEN_WRITES)[number];

export type ToolHandoffOpenResult = {
  href: string;
  handoff: ToolHandoff;
  /** Always empty — open/preview/return must not create business objects. */
  sideEffects: ToolHandoffWriteKind[];
};

export function openToolWithHandoff(
  handoff: ToolHandoff,
  options?: { toolBasePath?: string; proStudioPath?: string }
): ToolHandoffOpenResult {
  const projected = projectToolHandoff(handoff);
  if (!projected.ok) {
    throw new Error(projected.reason);
  }
  return {
    href: buildToolOpenHref(projected.handoff, options),
    handoff: projected.handoff,
    sideEffects: [],
  };
}

/** Return from tool — restores draft key/focus; zero writes. */
export function returnFromToolHandoff(handoff: ToolHandoff): {
  returnToDraftKey?: string;
  focusKey?: string;
  sideEffects: ToolHandoffWriteKind[];
} {
  return {
    ...(handoff.returnToDraftKey
      ? { returnToDraftKey: handoff.returnToDraftKey }
      : {}),
    ...(handoff.focusKey ? { focusKey: handoff.focusKey } : {}),
    sideEffects: [],
  };
}

/**
 * Assert a serialized URL/query string contains no sensitive material.
 * Matches query-key / JSON-key shapes only — does not false-positive on
 * allowlisted names like `minimalSettings` that merely contain a substring.
 */
export function assertToolHandoffUrlSafe(urlOrQuery: string): void {
  const lower = urlOrQuery.toLowerCase();
  for (const key of FORBIDDEN_TOOL_HANDOFF_KEYS) {
    const k = key.toLowerCase();
    // Word-boundary style: start / & / ? / " / { before the key, then = or "
    const patterns = [
      new RegExp(`(?:^|[?&{,\\s])"?${k}"?\\s*[:=]`, 'i'),
      new RegExp(`%22${k}%22%3a`, 'i'), // JSON key URL-encoded
      new RegExp(`(?:^|[?&])${k}=`, 'i'),
    ];
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        throw new Error(
          `ToolHandoff URL contains forbidden sensitive key: ${key}`
        );
      }
    }
  }
  // Body-like free text markers (not allowlisted field names).
  if (
    /(?:^|[?&{,\\s])"?(?:usertext|promptbody|hiddenprompt|composer_?draft)"?\s*[:=]/i.test(
      urlOrQuery
    )
  ) {
    throw new Error('ToolHandoff URL appears to contain draft/prompt material');
  }
}
