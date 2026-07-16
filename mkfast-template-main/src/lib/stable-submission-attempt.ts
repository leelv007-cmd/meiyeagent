export interface SubmissionAttemptStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface StableSubmissionAttempt {
  fingerprint: string;
  idempotencyKey: string;
  scope: string;
}

interface SubmissionAttemptOptions {
  createIdempotencyKey?: () => string;
  storage?: SubmissionAttemptStorage;
}

const STORAGE_PREFIX = 'meiye-submission-attempt:v1:';

export async function runWithStableSubmissionAttempt<T>(
  scope: string,
  payload: unknown,
  action: (idempotencyKey: string) => Promise<T>,
  options: SubmissionAttemptOptions = {}
) {
  const attempt = await beginStableSubmissionAttempt(scope, payload, options);
  const result = await action(attempt.idempotencyKey);
  completeStableSubmissionAttempt(attempt, options);
  return result;
}

export async function beginStableSubmissionAttempt(
  scope: string,
  payload: unknown,
  options: SubmissionAttemptOptions = {}
): Promise<StableSubmissionAttempt> {
  const storage = options.storage ?? sessionStorageForAttempt();
  const fingerprint = await payloadFingerprint(payload);
  const storageKey = `${STORAGE_PREFIX}${scope}`;
  const existing = readAttempt(storage.getItem(storageKey));
  if (existing?.fingerprint === fingerprint) {
    return { ...existing, scope };
  }

  const attempt = {
    fingerprint,
    idempotencyKey:
      options.createIdempotencyKey?.() ?? globalThis.crypto.randomUUID(),
  };
  storage.setItem(storageKey, JSON.stringify(attempt));
  return { ...attempt, scope };
}

export function completeStableSubmissionAttempt(
  attempt: StableSubmissionAttempt,
  options: Pick<SubmissionAttemptOptions, 'storage'> = {}
) {
  const storage = options.storage ?? sessionStorageForAttempt();
  const storageKey = `${STORAGE_PREFIX}${attempt.scope}`;
  const current = readAttempt(storage.getItem(storageKey));
  if (
    current?.fingerprint === attempt.fingerprint &&
    current.idempotencyKey === attempt.idempotencyKey
  ) {
    storage.removeItem(storageKey);
  }
}

function readAttempt(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.idempotencyKey === 'string'
    ) {
      return {
        fingerprint: parsed.fingerprint,
        idempotencyKey: parsed.idempotencyKey,
      };
    }
  } catch {}
  return undefined;
}

async function payloadFingerprint(payload: unknown) {
  const canonical = JSON.stringify(stableValue(payload));
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function sessionStorageForAttempt(): SubmissionAttemptStorage {
  if (typeof window === 'undefined') {
    throw new Error(
      'Stable submission attempts require browser session storage.'
    );
  }
  return window.sessionStorage;
}
