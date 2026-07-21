import * as z from 'zod';
import { isStrictSecretEnv } from './secret-hardening';

type EnvLike = Readonly<Record<string, string | undefined>>;

export const INTERNAL_SERVICE_TRANSPORTS = [
  'service-binding',
  'private-network',
] as const;

function isProductionEnv(env: EnvLike): boolean {
  if (env.APP_ENV === 'production') return true;
  return !env.APP_ENV && env.NODE_ENV === 'production';
}

export function internalServiceTransportSchema(env: EnvLike = process.env) {
  const schema = z.enum(INTERNAL_SERVICE_TRANSPORTS);
  return isStrictSecretEnv(env) ? schema : schema.optional();
}

export function canvasOriginSchema(env: EnvLike = process.env) {
  const schema = z.url();

  if (!isProductionEnv(env)) {
    return schema.default('http://127.0.0.1:4200');
  }

  return schema.refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    {
      message: 'CANVAS_ORIGIN must use HTTPS in production.',
    }
  );
}
