/**
 * Startup secret hardening — the single cross-tier authority (Core service and
 * Workers App Shell both consume this module; neither keeps a local copy).
 *
 * Weak fixture secrets are refused only in production/staging (or
 * NODE_ENV=production when APP_ENV is unset). Local CLI, unit tests and
 * fixture/e2e keep placeholder defaults so onboarding stays low-friction.
 *
 * History: until 2026-08-12 the App Shell carried a hand-copied 6-item subset
 * of this list (missing dev-token/password/secret/test-service-token/
 * test-token/token) and no minimum-length rule — the exact drift this
 * centralization removes.
 */

export const WEAK_SECRET_VALUES = [
  'better-auth-secret',
  'change-me',
  'change-me-callback',
  'change-me-canvas',
  'dev-token',
  'local-core-service-token',
  'local-canvas-service-token',
  'password',
  'secret',
  'test-service-token',
  'test-token',
  'token',
] as const;

export const ALL_ZERO_INTEGRATION_SECRET_STORE_KEY = '0'.repeat(64);

const STRICT_APP_ENVS = new Set(['production', 'staging']);
const WEAK_SECRET_SET = new Set<string>(WEAK_SECRET_VALUES);
export const MIN_STRICT_SECRET_LENGTH = 16;

export const REJECTED_SECRET_SET_HINT =
  'Rejected set: better-auth-secret, change-me, change-me-callback, change-me-canvas, dev-token, local-core-service-token, local-canvas-service-token, password, secret, test-service-token, test-token, token, all-zero INTEGRATION_SECRET_STORE_KEY, length < 16 in production/staging.';

type EnvLike = Readonly<Record<string, string | undefined>>;

export function isStrictSecretEnv(env: EnvLike = process.env): boolean {
  if (STRICT_APP_ENVS.has(env.APP_ENV ?? '')) return true;
  // Treat bare production Node process without APP_ENV as strict.
  return !env.APP_ENV && env.NODE_ENV === 'production';
}

/** True when weak fixture secrets and zod defaults are allowed. */
export function allowsDevSecretDefaults(env: EnvLike = process.env): boolean {
  return !isStrictSecretEnv(env);
}

export function isWeakSecretValue(value: string): boolean {
  return WEAK_SECRET_SET.has(value);
}

export function isAllZeroIntegrationSecretStoreKey(value: string): boolean {
  return value === ALL_ZERO_INTEGRATION_SECRET_STORE_KEY || /^0+$/u.test(value);
}

export function assertStrongSecret(
  name: string,
  value: string | undefined,
  env: EnvLike = process.env,
): asserts value is string {
  if (allowsDevSecretDefaults(env)) {
    if (!value) {
      throw new Error(
        `${name} is required (even in local modes set a non-empty value or rely on process defaults). ${REJECTED_SECRET_SET_HINT}`,
      );
    }
    return;
  }
  if (!value) {
    throw new Error(
      `${name} is required in production/staging. ${REJECTED_SECRET_SET_HINT}`,
    );
  }
  if (isWeakSecretValue(value)) {
    throw new Error(
      `${name} rejects weak placeholder ${JSON.stringify(value)} in production/staging. ${REJECTED_SECRET_SET_HINT}`,
    );
  }
  if (value.length < MIN_STRICT_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_STRICT_SECRET_LENGTH} characters in production/staging. ${REJECTED_SECRET_SET_HINT}`,
    );
  }
}

export function assertIntegrationSecretStoreKey(
  value: string | undefined,
  env: EnvLike = process.env,
): asserts value is string {
  if (!value) {
    throw new Error(
      'File secret mode requires INTEGRATION_SECRET_STORE_KEY. ' +
        REJECTED_SECRET_SET_HINT,
    );
  }
  if (allowsDevSecretDefaults(env)) return;
  if (isAllZeroIntegrationSecretStoreKey(value)) {
    throw new Error(
      'INTEGRATION_SECRET_STORE_KEY rejects the all-zero fixture key in production/staging. ' +
        REJECTED_SECRET_SET_HINT,
    );
  }
}
