/**
 * Weak local fixtures are refused only in production/staging (or NODE_ENV=production).
 * Local CLI, unit tests, fixture/e2e keep placeholder defaults so onboarding stays low-friction.
 */
export const WEAK_SECRET_VALUES = [
  'better-auth-secret',
  'change-me',
  'change-me-callback',
  'change-me-canvas',
  'local-core-service-token',
  'local-canvas-service-token',
] as const;

const WEAK_SECRET_SET = new Set<string>(WEAK_SECRET_VALUES);
const STRICT_APP_ENVS = new Set(['production', 'staging']);

export const REJECTED_SECRET_SET_HINT =
  'Rejected set: better-auth-secret, change-me, change-me-callback, change-me-canvas, local-core-service-token, local-canvas-service-token, all-zero INTEGRATION_SECRET_STORE_KEY.';

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
