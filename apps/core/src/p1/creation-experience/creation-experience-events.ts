/**
 * Creation experience event revisions (A3 / #90, D-078 evidence boundary).
 *
 * Seven kinds: exposure / select / apply / start / complete / correct / cancel.
 * Carry surface / recipe / action / lens revision only.
 * NO hidden prompt, NO user-sensitive body text.
 * Append-only audit channel — no dashboard aggregation.
 */

import type {
  CreationExperienceEvent,
  CreationExperienceEventKind,
  CreationLensId,
  CreationLensRevisionId,
  RecipeRevisionId,
  SurfaceRevisionId,
} from '@meiye/contracts';
import { creationExperienceEventKinds } from '@meiye/contracts';

/** Keys that must never appear on audit event payloads. */
export const FORBIDDEN_EVENT_PAYLOAD_KEYS = [
  'hiddenPromptBody',
  'hiddenPrompt',
  'prompt',
  'promptBody',
  'systemPrompt',
  'system_prompt',
  'promptText',
  'prompt_text',
  'instructions',
  'userText',
  'user_text',
  'bodyText',
  'body_text',
  'body',
  'content',
  'message',
  'rawPrompt',
  'raw_prompt',
  'provider',
  'deployment',
  'credential',
  'credentialRef',
  'apiKey',
  'secret',
  'password',
  'token',
] as const;

export type ForbiddenEventPayloadKey =
  (typeof FORBIDDEN_EVENT_PAYLOAD_KEYS)[number];

const FORBIDDEN_SET = new Set<string>(FORBIDDEN_EVENT_PAYLOAD_KEYS);

export interface RecordCreationExperienceEventInput {
  kind: CreationExperienceEventKind;
  recordedAt?: string;
  sessionId?: string;
  correlationId?: string;
  actorId?: string;
  lensId?: CreationLensId;
  lensRevisionId?: CreationLensRevisionId;
  surfaceRevisionId?: SurfaceRevisionId;
  recipeRevisionId?: RecipeRevisionId;
  actionId?: string;
  actionRevisionId?: string;
  /**
   * Optional scalar meta. Forbidden keys and nested objects are stripped.
   * Strings that look like long body text (> 280 chars) are dropped.
   */
  meta?: Record<string, unknown>;
  /** Optional stable id; auto-generated when omitted. */
  eventId?: string;
}

function isScalarMetaValue(
  value: unknown,
): value is string | number | boolean | null {
  if (value === null) return true;
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

/**
 * Sanitize meta: drop forbidden keys, non-scalars, and long body-like strings.
 */
export function sanitizeEventMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return undefined;
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_SET.has(key)) continue;
    // Nested objects / arrays never accepted (could smuggle body text).
    if (!isScalarMetaValue(value)) continue;
    if (typeof value === 'string' && value.length > 280) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Deep-scan an event (or any value) for forbidden payload keys.
 * Returns first forbidden key path, or null if clean.
 */
export function findForbiddenEventPayloadKey(
  value: unknown,
  path = '$',
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenEventPayloadKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key)) {
      return `${path}.${key}`;
    }
    const hit = findForbiddenEventPayloadKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

function assertKnownKind(kind: string): asserts kind is CreationExperienceEventKind {
  if (
    !(creationExperienceEventKinds as readonly string[]).includes(kind)
  ) {
    throw new Error(
      `Unknown creation experience event kind: ${kind}. Expected one of ${creationExperienceEventKinds.join(', ')}.`,
    );
  }
}

let eventSeq = 0;

function nextEventId(): string {
  eventSeq += 1;
  return `cx-event-${Date.now()}-${eventSeq}`;
}

/**
 * Build a privacy-safe audit event record (does not persist).
 */
export function buildCreationExperienceEvent(
  input: RecordCreationExperienceEventInput,
): CreationExperienceEvent {
  assertKnownKind(input.kind);
  const event: CreationExperienceEvent = {
    eventId: input.eventId ?? nextEventId(),
    kind: input.kind,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  if (input.sessionId) event.sessionId = input.sessionId;
  if (input.correlationId) event.correlationId = input.correlationId;
  if (input.actorId) event.actorId = input.actorId;
  if (input.lensId) event.lensId = input.lensId;
  if (input.lensRevisionId) event.lensRevisionId = input.lensRevisionId;
  if (input.surfaceRevisionId) {
    event.surfaceRevisionId = input.surfaceRevisionId;
  }
  if (input.recipeRevisionId) {
    event.recipeRevisionId = input.recipeRevisionId;
  }
  if (input.actionId) event.actionId = input.actionId;
  if (input.actionRevisionId) {
    event.actionRevisionId = input.actionRevisionId;
  }
  const meta = sanitizeEventMeta(input.meta);
  if (meta) event.meta = meta;

  const leak = findForbiddenEventPayloadKey(event);
  if (leak) {
    throw new Error(
      `Creation experience event leaked forbidden payload key: ${leak}`,
    );
  }
  return event;
}

/**
 * In-memory append-only audit channel.
 * No dashboard / aggregation APIs — list only for audit consumers / tests.
 */
export class MemoryCreationExperienceEventAudit {
  private readonly events: CreationExperienceEvent[] = [];

  append(
    input: RecordCreationExperienceEventInput,
  ): CreationExperienceEvent {
    const event = buildCreationExperienceEvent(input);
    // Append-only: push a frozen clone so callers cannot mutate history.
    const frozen = Object.freeze(structuredClone(event));
    this.events.push(frozen);
    return frozen;
  }

  /** Snapshot of all events in append order. */
  list(): readonly CreationExperienceEvent[] {
    return this.events.slice();
  }

  /** Count by kind (audit helper — not a dashboard). */
  countByKind(): Record<CreationExperienceEventKind, number> {
    const counts = Object.fromEntries(
      creationExperienceEventKinds.map((k) => [k, 0]),
    ) as Record<CreationExperienceEventKind, number>;
    for (const event of this.events) {
      counts[event.kind] += 1;
    }
    return counts;
  }

  get size(): number {
    return this.events.length;
  }
}

export function listCreationExperienceEventKinds(): readonly CreationExperienceEventKind[] {
  return creationExperienceEventKinds;
}
