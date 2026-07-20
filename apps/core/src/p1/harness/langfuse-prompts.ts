import { createHash } from 'node:crypto';

export const HARNESS_LANGFUSE_PROMPT_NAMES = {
  intentNaming: 'harness/intent-naming',
  briefCompilation: 'harness/brief-copy',
} as const;

export const HARNESS_BUILTIN_PROMPTS = {
  intentNaming:
    'Classify the merchant request into exactly one supported marketing task and one delivery layer. Extract only implicit constraints grounded in the request. If one fact blocks truthful execution, return only the single highest-priority blocking gap; otherwise return null.',
  briefCompilation:
    'Compile a complete professional copy brief. Ground every factual claim in supplied fact references, keep rights references explicit, and include a concrete CTA and platform. Only source refs beginning with marketing_identity: are registered identity refs; tone instructions are not identities. When none exists, use a neutral official brand voice and return an empty identityRefs array.',
} as const;

export interface HarnessFrozenPrompt {
  name: string;
  version: string;
  content: string;
  contentHash: string;
  label: string;
  source: 'langfuse' | 'builtin';
  isFallback: boolean;
  fallbackReason?: string;
}

export interface HarnessFrozenPrompts {
  intentNaming: HarnessFrozenPrompt;
  briefCompilation: HarnessFrozenPrompt;
}

export interface HarnessPromptResolver {
  resolve(): Promise<HarnessFrozenPrompts>;
}

export interface LangfuseHarnessPromptResolverOptions {
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
  label?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class LangfuseHarnessPromptResolver implements HarnessPromptResolver {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: LangfuseHarnessPromptResolverOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async resolve(): Promise<HarnessFrozenPrompts> {
    const [intentNaming, briefCompilation] = await Promise.all([
      this.resolveOne(
        HARNESS_LANGFUSE_PROMPT_NAMES.intentNaming,
        HARNESS_BUILTIN_PROMPTS.intentNaming,
      ),
      this.resolveOne(
        HARNESS_LANGFUSE_PROMPT_NAMES.briefCompilation,
        HARNESS_BUILTIN_PROMPTS.briefCompilation,
      ),
    ]);
    return { intentNaming, briefCompilation };
  }

  private async resolveOne(name: string, builtin: string) {
    const label = this.options.label ?? 'production';
    if (
      !this.options.baseUrl?.trim() ||
      !this.options.publicKey?.trim() ||
      !this.options.secretKey?.trim()
    ) {
      return fallbackPrompt(name, builtin, label, 'unconfigured');
    }
    try {
      const url = `${this.options.baseUrl.replace(/\/$/u, '')}/api/public/v2/prompts/${encodeURIComponent(name)}?label=${encodeURIComponent(label)}`;
      const response = await this.fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.publicKey}:${this.options.secretKey}`,
          ).toString('base64')}`,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        return fallbackPrompt(name, builtin, label, `http_${response.status}`);
      }
      const body = await response.json();
      if (
        !isRecord(body) ||
        body.type !== 'text' ||
        typeof body.prompt !== 'string' ||
        body.prompt.trim().length === 0 ||
        !validVersion(body.version)
      ) {
        return fallbackPrompt(name, builtin, label, 'invalid_response');
      }
      return {
        name,
        version: String(body.version),
        content: body.prompt,
        contentHash: sha256(body.prompt),
        label,
        source: 'langfuse' as const,
        isFallback: false,
      };
    } catch {
      return fallbackPrompt(name, builtin, label, 'request_failed');
    }
  }
}

export function langfusePromptResolverFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return new LangfuseHarnessPromptResolver({
    baseUrl: env.LANGFUSE_BASE_URL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    label: env.LANGFUSE_PROMPT_LABEL ?? 'production',
    ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
      ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
      : {}),
  });
}

export function promptTraceReference(prompt: HarnessFrozenPrompt | undefined) {
  if (!prompt) return undefined;
  return {
    name: prompt.name,
    version: prompt.version,
    contentHash: prompt.contentHash,
    label: prompt.label,
    source: prompt.source,
    isFallback: prompt.isFallback,
    ...(prompt.fallbackReason
      ? { fallbackReason: prompt.fallbackReason }
      : {}),
  };
}

function fallbackPrompt(
  name: string,
  content: string,
  label: string,
  fallbackReason: string,
): HarnessFrozenPrompt {
  return {
    name,
    version: 'builtin-v1',
    content,
    contentHash: sha256(content),
    label,
    source: 'builtin',
    isFallback: true,
    fallbackReason,
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function validVersion(value: unknown) {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value > 0) ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('LANGFUSE_REQUEST_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}
