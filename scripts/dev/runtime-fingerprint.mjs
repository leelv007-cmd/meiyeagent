import { createHash } from 'node:crypto';

export const DEFAULT_JOB_QUEUE_PREFIX = 'meiye-p1';

export function connectionIdentity(value) {
  if (!value) return { fingerprint: '', host: '', port: '' };
  const url = new URL(String(value));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Runtime database URL must use PostgreSQL.');
  }
  return {
    fingerprint: `sha256:${createHash('sha256').update(url.toString()).digest('hex')}`,
    host: url.hostname,
    port: url.port || '5432',
  };
}

function storedOrComputedFingerprint(input, storedKey, urlKey) {
  if (input?.[storedKey]) return String(input[storedKey]);
  return connectionIdentity(input?.[urlKey]).fingerprint;
}

export function runtimeProfileFingerprint(input) {
  return {
    APP_ENV: String(input?.APP_ENV ?? ''),
    DATABASE_FINGERPRINT: storedOrComputedFingerprint(
      input,
      'DATABASE_FINGERPRINT',
      'DATABASE_URL',
    ),
    HARNESS_DBOS_SYSTEM_DATABASE_FINGERPRINT: storedOrComputedFingerprint(
      input,
      'HARNESS_DBOS_SYSTEM_DATABASE_FINGERPRINT',
      'HARNESS_DBOS_SYSTEM_DATABASE_URL',
    ),
    JOB_QUEUE_PREFIX: String(
      input?.JOB_QUEUE_PREFIX ?? DEFAULT_JOB_QUEUE_PREFIX,
    ),
    MODEL_EXECUTION_MODE: String(input?.MODEL_EXECUTION_MODE ?? ''),
  };
}
