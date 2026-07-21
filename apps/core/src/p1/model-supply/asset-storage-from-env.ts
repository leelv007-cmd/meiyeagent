import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  FileSystemAssetStorage,
  fileSystemAssetStorageFromEnv,
} from './filesystem-asset-storage.js';
import {
  S3CompatibleAssetStorage,
  S3CompatibleObjectClient,
} from './s3-asset-storage.js';
import { resolveFfprobePath } from './media-tool-paths.js';

export function modelAssetStorageFromEnv(env: NodeJS.ProcessEnv) {
  if (env.P1_ASSET_STORAGE_MODE === 's3') {
    const endpoint = required(env, 'P1_ASSET_S3_ENDPOINT');
    const bucket = required(env, 'P1_ASSET_S3_BUCKET');
    const accessKeyId = required(env, 'P1_ASSET_S3_ACCESS_KEY_ID');
    const secretAccessKey = required(env, 'P1_ASSET_S3_SECRET_ACCESS_KEY');
    return new S3CompatibleAssetStorage({
      cacheDirectory:
        env.P1_ASSET_MATERIALIZATION_DIR ??
        resolve(tmpdir(), 'meiye-core-p1-assets'),
      client: new S3CompatibleObjectClient({
        accessKeyId,
        bucket,
        endpoint,
        region: env.P1_ASSET_S3_REGION ?? 'auto',
        secretAccessKey,
        timeoutMs: positiveInteger(
          env.P1_ASSET_S3_TIMEOUT_MS,
          'P1_ASSET_S3_TIMEOUT_MS',
          30_000,
        ),
      }),
      ...(env.FFPROBE_PATH ? { ffprobePath: resolveFfprobePath(env) } : {}),
      publicBaseUrl: assetPublicBaseUrl(env),
    });
  }
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? '';
  if (
    (env.P1_ASSET_STORAGE_MODE === undefined ||
      env.P1_ASSET_STORAGE_MODE === 'filesystem') &&
    ['development', 'test', 'e2e'].includes(appEnv)
  ) {
    return fileSystemAssetStorageFromEnv(env);
  }
  if (
    env.P1_ASSET_STORAGE_MODE &&
    env.P1_ASSET_STORAGE_MODE !== 'filesystem'
  ) {
    throw new Error(
      'P1_ASSET_STORAGE_MODE must be s3 or filesystem.',
    );
  }
  throw new Error(
    'Shared object storage is required unless APP_ENV explicitly selects development, test, or e2e.',
  );
}

function assetPublicBaseUrl(env: NodeJS.ProcessEnv) {
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? '';
  const configured = env.P1_ASSET_PUBLIC_BASE_URL?.trim();
  const appBaseUrl = env.APP_BASE_URL?.trim();
  const value =
    configured ||
    (appBaseUrl
      ? `${appBaseUrl.replace(/\/+$/u, '')}/api/core/p1/assets?objectKey=`
      : undefined);

  if (!value) {
    if (appEnv === 'production' || appEnv === 'staging') {
      throw new Error(
        'P1_ASSET_PUBLIC_BASE_URL or APP_BASE_URL is required for shared asset storage in production and staging.',
      );
    }
    return 'http://localhost:3000/api/core/p1/assets?objectKey=';
  }

  if (appEnv === 'production' || appEnv === 'staging') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        'The shared asset public base URL must be a valid HTTPS URL in production and staging.',
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    ) {
      throw new Error(
        'The shared asset public base URL must be a non-local HTTPS URL without credentials or a fragment in production and staging.',
      );
    }
  }
  return value;
}

export type ModelAssetStorage =
  | FileSystemAssetStorage
  | S3CompatibleAssetStorage;

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required for shared asset storage.`);
  return value;
}

function positiveInteger(value: string | undefined, name: string, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
