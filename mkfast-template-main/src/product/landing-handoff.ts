/**
 * Landing → Composer intent handoff (P1-A1 / #148).
 *
 * Short-lived same-browser sessionStorage payload. Whitelist only:
 * intent text, optional explicit CreationLens, and createdAt.
 * Never stores assets, rights, quotes, providers, or hidden prompts.
 */

import { creationLensIds, type CreationLensId } from '@meiye/contracts';

export const LANDING_HANDOFF_STORAGE_KEY = 'meiye.landing-handoff.v1';
export const LANDING_HANDOFF_SCHEMA = 'landing-handoff/v1' as const;

/** Max age for a recoverable handoff (same browser session, ~24h). */
export const LANDING_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type LandingHandoff = {
  schemaVersion: typeof LANDING_HANDOFF_SCHEMA;
  intent: string;
  createdAt: string;
  /** Only when the visitor explicitly picked a creation lens. */
  lens?: CreationLensId;
};

export const LANDING_HANDOFF_ALLOWED_KEYS = [
  'schemaVersion',
  'intent',
  'createdAt',
  'lens',
] as const;

/**
 * Keys that must never appear on a landing handoff payload.
 * Mirrors #148 AC + ToolHandoff sensitive boundary.
 */
export const LANDING_HANDOFF_FORBIDDEN_KEYS = [
  'assets',
  'assetIds',
  'sources',
  'rights',
  'authorization',
  'quote',
  'quoteRevisionId',
  'provider',
  'providerProfile',
  'prompt',
  'promptBody',
  'hiddenPrompt',
  'systemPrompt',
  'draft',
  'composerDraft',
  'userText',
  'credential',
  'token',
  'apiKey',
  'secret',
  'password',
] as const;

export type LandingHandoffValidation =
  | { ok: true; handoff: LandingHandoff }
  | { ok: false; reason: string; forbiddenKey?: string };

const ALLOWED_SET = new Set<string>(LANDING_HANDOFF_ALLOWED_KEYS);
const FORBIDDEN_SET = new Set(
  LANDING_HANDOFF_FORBIDDEN_KEYS.map((key) => key.toLowerCase())
);
const LENS_SET = new Set<string>(creationLensIds);

function isIsoTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function normalizeIntent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const intent = value.trim().slice(0, 4_000);
  return intent.length >= 2 ? intent : undefined;
}

function findForbiddenKey(value: unknown, path = '$'): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findForbiddenKey(value[index], `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key.toLowerCase())) {
      return `${path}.${key}`;
    }
    const hit = findForbiddenKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

/** Project an unknown bag into a whitelist-only LandingHandoff. */
export function projectLandingHandoff(raw: unknown): LandingHandoffValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'handoff must be an object' };
  }
  const bag = raw as Record<string, unknown>;

  const forbidden = findForbiddenKey(bag);
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

  if (bag.schemaVersion !== LANDING_HANDOFF_SCHEMA) {
    return { ok: false, reason: 'unsupported schemaVersion' };
  }

  const intent = normalizeIntent(bag.intent);
  if (!intent) {
    return { ok: false, reason: 'intent must be 2–4000 characters' };
  }

  if (typeof bag.createdAt !== 'string' || !isIsoTimestamp(bag.createdAt)) {
    return { ok: false, reason: 'createdAt must be an ISO timestamp' };
  }

  const handoff: LandingHandoff = {
    schemaVersion: LANDING_HANDOFF_SCHEMA,
    intent,
    createdAt: bag.createdAt,
  };

  if (bag.lens !== undefined) {
    if (typeof bag.lens !== 'string' || !LENS_SET.has(bag.lens)) {
      return { ok: false, reason: 'lens must be an explicit CreationLensId' };
    }
    handoff.lens = bag.lens as CreationLensId;
  }

  return { ok: true, handoff };
}

export function buildLandingHandoff(input: {
  intent: string;
  lens?: CreationLensId;
  createdAt?: string;
}): LandingHandoffValidation {
  return projectLandingHandoff({
    schemaVersion: LANDING_HANDOFF_SCHEMA,
    intent: input.intent,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.lens ? { lens: input.lens } : {}),
  });
}

export function isLandingHandoffFresh(
  handoff: LandingHandoff,
  nowMs: number = Date.now(),
  maxAgeMs: number = LANDING_HANDOFF_MAX_AGE_MS
) {
  const created = Date.parse(handoff.createdAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created >= 0 && nowMs - created <= maxAgeMs;
}

function browserSessionStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

export function writeLandingHandoff(
  handoff: LandingHandoff,
  storage: Pick<Storage, 'setItem'> | undefined = browserSessionStorage()
): boolean {
  const projected = projectLandingHandoff(handoff);
  if (!projected.ok || !storage) return false;
  storage.setItem(
    LANDING_HANDOFF_STORAGE_KEY,
    JSON.stringify(projected.handoff)
  );
  return true;
}

export function readLandingHandoff(
  storage: Pick<Storage, 'getItem'> | undefined = browserSessionStorage(),
  options?: { nowMs?: number; maxAgeMs?: number }
): LandingHandoff | null {
  if (!storage) return null;
  const raw = storage.getItem(LANDING_HANDOFF_STORAGE_KEY);
  if (!raw) return null;
  try {
    const projected = projectLandingHandoff(JSON.parse(raw) as unknown);
    if (!projected.ok) return null;
    if (
      !isLandingHandoffFresh(
        projected.handoff,
        options?.nowMs,
        options?.maxAgeMs
      )
    ) {
      return null;
    }
    return projected.handoff;
  } catch {
    return null;
  }
}

export function clearLandingHandoff(
  storage: Pick<Storage, 'removeItem'> | undefined = browserSessionStorage()
) {
  storage?.removeItem(LANDING_HANDOFF_STORAGE_KEY);
}

/**
 * Capture landing intent for post-auth restore. Returns false when intent is
 * empty / too short so the CTA can still navigate to register without a
 * fake handoff.
 */
export function captureLandingIntent(input: {
  intent: string;
  lens?: CreationLensId;
  storage?: Pick<Storage, 'setItem'>;
  createdAt?: string;
}): boolean {
  const built = buildLandingHandoff({
    intent: input.intent,
    lens: input.lens,
    createdAt: input.createdAt,
  });
  if (!built.ok) return false;
  return writeLandingHandoff(built.handoff, input.storage);
}
