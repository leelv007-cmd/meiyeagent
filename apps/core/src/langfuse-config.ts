export interface LangfuseTracingConfig {
  baseUrl: string;
  environment?: string;
  publicKey: string;
  secretKey: string;
}

export function langfuseTracingConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): LangfuseTracingConfig | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();
  const environment =
    env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ?? env.APP_ENV?.trim();
  return publicKey && secretKey && baseUrl
    ? {
        baseUrl,
        ...(environment ? { environment } : {}),
        publicKey,
        secretKey,
      }
    : undefined;
}

export function maskLangfuseData(data: unknown): unknown {
  if (typeof data === 'string') {
    return data
      .replace(/\bsk-[A-Za-z0-9._-]+/gu, 'sk-[REDACTED]')
      .replace(/\bpk-[A-Za-z0-9._-]+/gu, 'pk-[REDACTED]')
      .replace(/\bBearer\s+[^\s,;"']+/giu, 'Bearer [REDACTED]')
      .replace(
        /(api[-_]?key["']?\s*[:=]\s*["']?)([^\s,;"'}]+)/giu,
        '$1[REDACTED]',
      );
  }
  if (Array.isArray(data)) {
    return data.map((value) => maskLangfuseData(value));
  }
  if (
    data &&
    typeof data === 'object' &&
    Object.getPrototypeOf(data) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        /^(?:x[-_])?api[-_]?key$/iu.test(key)
          ? '[REDACTED]'
          : maskLangfuseData(value),
      ]),
    );
  }
  return data;
}
