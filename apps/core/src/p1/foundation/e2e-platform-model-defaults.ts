import type { PlatformDefaultModelConfigKey } from './workspace-provision.js';

const ENV_KEY_BY_OPERATION = {
  audio: 'E2E_PLATFORM_DEFAULT_MODEL_AUDIO',
  copy: 'E2E_PLATFORM_DEFAULT_MODEL_COPY',
  image: 'E2E_PLATFORM_DEFAULT_MODEL_IMAGE',
  video: 'E2E_PLATFORM_DEFAULT_MODEL_VIDEO',
} as const satisfies Record<PlatformDefaultModelConfigKey, string>;

export function e2ePlatformModelDefaultsFromEnv(
  env: NodeJS.ProcessEnv
): Partial<Record<PlatformDefaultModelConfigKey, string>> {
  if (env.APP_ENV !== 'e2e') return {};

  const configured = (
    Object.entries(ENV_KEY_BY_OPERATION) as Array<
      [PlatformDefaultModelConfigKey, string]
    >
  ).flatMap(([operation, envKey]) => {
    const modelId = env[envKey]?.trim();
    return modelId ? [[operation, modelId] as const] : [];
  });
  if (configured.length !== 0 && configured.length !== 4) {
    throw new Error(
      'E2E platform default models must configure copy, image, video, and audio together.'
    );
  }
  return Object.fromEntries(configured);
}
