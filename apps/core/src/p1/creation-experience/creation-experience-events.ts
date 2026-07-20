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
import { P1DomainError } from '../foundation/domain.js';

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
const AUDIT_REFERENCE = /^ref:[a-f0-9]{64}$/;
const CATALOG_REVISION =
  /^(?:recipe|surface)(?:\.[a-z0-9_.-]{1,80})?@[1-9]\d{0,8}$/;
export const CREATION_EVENT_ACTION_IDS = [
  'action.exposure',
  'action.select',
  'action.apply',
  'action.apply_recipe',
  'action.start',
  'action.complete',
  'action.correct',
  'action.cancel',
] as const;
const ACTION_ID_SET = new Set<string>(CREATION_EVENT_ACTION_IDS);

export interface RecordCreationExperienceEventInput {
  kind: CreationExperienceEventKind;
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
   * Optional non-text scalar meta. All strings and nested values are stripped
   * so user-sensitive body text cannot be smuggled under an unknown key.
   */
  meta?: Record<string, unknown>;
}

export interface CreationExperienceEventAuditPort {
  append(
    workspaceId: string,
    input: RecordCreationExperienceEventInput,
  ): Promise<CreationExperienceEvent> | CreationExperienceEvent;
}

function isScalarMetaValue(
  value: unknown,
): value is number | boolean | null {
  if (value === null) return true;
  const t = typeof value;
  return t === 'number' || t === 'boolean';
}

/**
 * Sanitize meta: drop forbidden keys, strings, and non-scalars.
 */
export function sanitizeEventMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, number | boolean | null> | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return undefined;
  }
  const out: Record<string, number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_SET.has(key)) continue;
    // Nested objects / arrays never accepted (could smuggle body text).
    if (!isScalarMetaValue(value)) continue;
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
  if (
    input.lensId !== undefined &&
    input.lensId !== 'copy' &&
    input.lensId !== 'image_text' &&
    input.lensId !== 'video'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'lensId must be a registered Creation Lens.',
    );
  }
  for (const [field, value] of Object.entries({
    actorId: input.actorId,
    correlationId: input.correlationId,
    sessionId: input.sessionId,
  })) {
    if (value !== undefined && !AUDIT_REFERENCE.test(value)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `${field} must be a server-derived audit reference.`,
      );
    }
  }
  if (
    input.lensRevisionId !== undefined &&
    input.lensRevisionId !== 'lens.static@1'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'lensRevisionId must reference the static server Lens revision.',
    );
  }
  for (const [field, value] of Object.entries({
    recipeRevisionId: input.recipeRevisionId,
    surfaceRevisionId: input.surfaceRevisionId,
  })) {
    if (value !== undefined && !CATALOG_REVISION.test(value)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `${field} must be a server Catalog revision.`,
      );
    }
  }
  if (input.actionId !== undefined && !ACTION_ID_SET.has(input.actionId)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'actionId must be a registered Creation action.',
    );
  }
  if (
    input.actionRevisionId !== undefined &&
    (!input.actionId || input.actionRevisionId !== `${input.actionId}@1`)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'actionRevisionId must match the registered Creation action revision.',
    );
  }
  const event: CreationExperienceEvent = {
    eventId: nextEventId(),
    kind: input.kind,
    recordedAt: new Date().toISOString(),
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
  private readonly events: Array<{
    event: CreationExperienceEvent;
    workspaceId: string;
  }> = [];

  append(
    workspaceId: string,
    input: RecordCreationExperienceEventInput,
  ): CreationExperienceEvent;
  append(
    workspaceId: string,
    input: RecordCreationExperienceEventInput,
  ): CreationExperienceEvent {
    const event = buildCreationExperienceEvent(input);
    // Append-only: push a frozen clone so callers cannot mutate history.
    const frozen = Object.freeze(structuredClone(event));
    this.events.push({ event: frozen, workspaceId });
    return frozen;
  }

  /** Snapshot of all events in append order. */
  list(workspaceId?: string): readonly CreationExperienceEvent[] {
    return this.events
      .filter((stored) => !workspaceId || stored.workspaceId === workspaceId)
      .map((stored) => stored.event);
  }

  /** Count by kind (audit helper — not a dashboard). */
  countByKind(workspaceId?: string): Record<CreationExperienceEventKind, number> {
    const counts = Object.fromEntries(
      creationExperienceEventKinds.map((k) => [k, 0]),
    ) as Record<CreationExperienceEventKind, number>;
    for (const stored of this.events) {
      if (workspaceId && stored.workspaceId !== workspaceId) continue;
      counts[stored.event.kind] += 1;
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
