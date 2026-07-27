import { createHash } from 'node:crypto';

export const HARNESS_LANGFUSE_PROMPT_NAMES = {
  intentNaming: 'harness/intent-naming',
  briefCompilation: 'harness/brief-copy',
  briefImage: 'harness/brief-image',
  briefVideo: 'harness/brief-video',
  factSatisfaction: 'harness/fact-satisfaction',
  factCriticality: 'harness/fact-criticality',
  copyCandidate: 'harness/copy-candidate',
  notePlan: 'harness/note-plan',
  noteTextBlock: 'harness/note-text-block',
  noteConsistency: 'harness/note-consistency',
  destinationMapping: 'harness/destination-mapping',
  copyGeneration: 'harness/copy-generation',
  platformAdaptation: 'harness/platform-adaptation',
  textResponse: 'harness/text-response',
} as const;

export type HarnessPromptKey = keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES;

export const HARNESS_BUILTIN_PROMPTS = {
  intentNaming:
    'Restate the merchant request as a clear creative intent, classify one supported marketing task and delivery layer, and identify which operating asset categories are relevant and genuinely useful for this request. Route to customized only when at least one relevant category has a real benefit; an inferred industry category is the minimum useful unit. Otherwise route to guidance and ask one conversational question covering at most two related details. Never route directly to free, never invent merchant facts, and extract only grounded constraints.',
  briefCompilation:
    'Compile a complete professional copy brief. Ground every factual claim in supplied fact references, keep rights references explicit, and include a concrete CTA and platform. Only source refs beginning with marketing_identity: are registered identity refs; tone instructions are not identities. When none exists, use a neutral official brand voice and return an empty identityRefs array.',
  briefImage:
    'Compile a production-ready image execution brief with an actionable visual prompt, authorized references, output parameters, and explicit safety constraints.',
  briefVideo:
    'Compile a production-ready video execution brief with ordered shots, timing, first-frame direction, authorized references, and explicit safety constraints.',
  factSatisfaction:
    'Assess whether the authorized current facts satisfy every fact requirement for this intent. Return only grounded matched references and the missing fact kinds.',
  factCriticality:
    'Classify whether missing facts block truthful execution for this intent. Return critical only when executing without the facts would make a material claim unsafe.',
  copyCandidate:
    'Generate a materially distinct beauty-business copy candidate grounded in the frozen brief and authorized facts.',
  notePlan:
    'Create a semantic NotePlan before page generation. Follow the merchant intent, include one image intent and one text block per page, and preserve dependencies.',
  noteTextBlock:
    'Finalize one NotePlan page in the configured style. Preserve the theme and prior-page dependency, returning title, body, and exact text only.',
  noteConsistency:
    'Evaluate NotePlan theme continuity, visual consistency, non-repetition, role coverage, and image-text cross-reference. Return only pages needing regeneration.',
  destinationMapping:
    'Map the merchant destination answer only when platform and delivery are unambiguous; otherwise ask one focused clarification question with safe options.',
  copyGeneration:
    'Return complete beauty-business copy candidates with grounded facts, a clear conversion hook, and materially different bodies.',
  platformAdaptation:
    'Adapt canonical beauty-business content into complete xiaohongshu, douyin, and video_account variants without changing facts.',
  textResponse:
    'Return one plain-text response for the requested creative task without provider protocol fields or unsupported claims.',
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
  [key: string]: HarnessFrozenPrompt;
}

export type HarnessPromptRevisionReference = ReturnType<
  typeof promptTraceReference
>;

export interface HarnessPromptResolver {
  resolve(): Promise<HarnessFrozenPrompts>;
}

export interface LangfuseHarnessPromptResolverOptions {
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
  label?: string;
  versions?: Partial<Record<HarnessPromptKey, number>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  warn?: (input: { name: string; reason: string; version?: number }) => void;
}

export class LangfuseHarnessPromptResolver implements HarnessPromptResolver {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: LangfuseHarnessPromptResolverOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async resolve(): Promise<HarnessFrozenPrompts> {
    const entries = Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES) as Array<
      [HarnessPromptKey, string]
    >;
    const resolved = await Promise.all(
      entries.map(async ([key, name]) => [
        key,
        await this.resolveOne(
          key,
          name,
          HARNESS_BUILTIN_PROMPTS[key],
        ),
      ] as const),
    );
    return Object.fromEntries(resolved) as HarnessFrozenPrompts;
  }

  private async resolveOne(
    key: HarnessPromptKey,
    name: string,
    builtin: string,
  ) {
    const label = this.options.label ?? 'production';
    const version = this.options.versions?.[key];
    if (
      !this.options.baseUrl?.trim() ||
      !this.options.publicKey?.trim() ||
      !this.options.secretKey?.trim()
    ) {
      return this.fallback(name, builtin, label, 'unconfigured', version);
    }
    try {
      const selector =
        version === undefined
          ? `label=${encodeURIComponent(label)}`
          : `version=${encodeURIComponent(String(version))}`;
      const url = `${this.options.baseUrl.replace(/\/$/u, '')}/api/public/v2/prompts/${encodeURIComponent(name)}?${selector}`;
      const response = await this.fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.publicKey}:${this.options.secretKey}`,
          ).toString('base64')}`,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        return this.fallback(name, builtin, label, `http_${response.status}`, version);
      }
      const body = await response.json();
      if (
        !isRecord(body) ||
        body.type !== 'text' ||
        typeof body.prompt !== 'string' ||
        body.prompt.trim().length === 0 ||
        !validVersion(body.version)
      ) {
        return this.fallback(name, builtin, label, 'invalid_response', version);
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
      return this.fallback(name, builtin, label, 'request_failed', version);
    }
  }

  private fallback(
    name: string,
    builtin: string,
    label: string,
    reason: string,
    version?: number,
  ) {
    this.options.warn?.({ name, reason, ...(version === undefined ? {} : { version }) });
    return fallbackPrompt(name, builtin, label, reason);
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
    ...(env.LANGFUSE_PROMPT_VERSIONS
      ? { versions: promptVersionsFromEnv(env.LANGFUSE_PROMPT_VERSIONS) }
      : {}),
    ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
      ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
      : {}),
    warn: ({ name, reason, version }) => {
      const pin = version === undefined ? '' : ` version=${version}`;
      console.warn(
        `[harness] Langfuse prompt downgraded to builtin: ${name}${pin} (${reason}).`,
      );
    },
  });
}

export function promptRevisionReferences(
  prompts: HarnessFrozenPrompts,
): Record<string, HarnessPromptRevisionReference> {
  return Object.fromEntries(
    Object.entries(prompts).map(([key, prompt]) => [
      key,
      promptTraceReference(prompt),
    ]),
  ) as Record<string, HarnessPromptRevisionReference>;
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

function promptVersionsFromEnv(value: string): Partial<Record<HarnessPromptKey, number>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  if (!isRecord(parsed)) {
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  const versions: Partial<Record<HarnessPromptKey, number>> = {};
  for (const [key, version] of Object.entries(parsed)) {
    if (!(key in HARNESS_LANGFUSE_PROMPT_NAMES)) {
      throw new Error(`LANGFUSE_PROMPT_VERSIONS contains unknown key: ${key}.`);
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
      throw new Error(`LANGFUSE_PROMPT_VERSIONS.${key} must be a positive integer.`);
    }
    versions[key as HarnessPromptKey] = version;
  }
  return versions;
}
