import { createHash } from 'node:crypto';
import type {
  LanguageModelOperation,
  ModelSupplyPromptResolver,
} from '../model-supply/index.js';

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
export type LangfusePromptPolicy = 'pilot' | 'strict';

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

export type HarnessFrozenPrompts = Record<
  HarnessPromptKey,
  HarnessFrozenPrompt
>;

export type HarnessPromptRevisionReference = ReturnType<
  typeof promptTraceReference
>;

export interface HarnessPromptResolver {
  resolve(): Promise<HarnessFrozenPrompts>;
}

export function requireHarnessFrozenPrompt(
  prompts: HarnessFrozenPrompts,
  key: HarnessPromptKey,
) {
  const prompt = prompts[key];
  if (!prompt) {
    throw new Error(`Resolved prompt bundle is missing ${key}.`);
  }
  return prompt;
}

const MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION = {
  'copy.generate': 'copyGeneration',
  'copy.adapt': 'platformAdaptation',
  'text.respond': 'textResponse',
} as const satisfies Record<LanguageModelOperation, HarnessPromptKey>;

export function modelSupplyPromptResolverFromHarness(
  resolver: HarnessPromptResolver,
): ModelSupplyPromptResolver {
  return {
    async resolve({ operation }) {
      const prompts = await resolver.resolve();
      return structuredClone(
        requireHarnessFrozenPrompt(
          prompts,
          MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION[operation],
        ),
      );
    },
  };
}

export interface LangfuseHarnessPromptResolverOptions {
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
  label?: string;
  policy?: LangfusePromptPolicy;
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
    if ((this.options.policy ?? 'strict') === 'strict') {
      const missing = entries
        .filter(([key]) => this.options.versions?.[key] === undefined)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(
          `Strict Langfuse prompt resolution is missing pinned prompts: ${missing.join(', ')}.`,
        );
      }
    }
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
    if (version === undefined) {
      return this.fallback(name, builtin, label, 'unpinned');
    }
    const url = `${this.options.baseUrl.replace(/\/$/u, '')}/api/public/v2/prompts/${encodeURIComponent(name)}?version=${encodeURIComponent(String(version))}`;
    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.publicKey}:${this.options.secretKey}`,
          ).toString('base64')}`,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      return this.fallback(name, builtin, label, 'request_failed', version);
    }
    if (!response.ok) {
      return this.fallback(
        name,
        builtin,
        label,
        `http_${response.status}`,
        version,
      );
    }
    const body = await response.json().catch(() => undefined);
    if (
      !isRecord(body) ||
      body.type !== 'text' ||
      typeof body.prompt !== 'string' ||
      body.prompt.trim().length === 0 ||
      !validVersion(body.version)
    ) {
      return this.fallback(name, builtin, label, 'invalid_response', version);
    }
    if (String(body.version) !== String(version)) {
      return this.fallback(name, builtin, label, 'version_mismatch', version);
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
  }

  private fallback(
    name: string,
    builtin: string,
    label: string,
    reason: string,
    version?: number,
  ) {
    if ((this.options.policy ?? 'strict') === 'strict') {
      const pin = version === undefined ? '' : ` version=${version}`;
      throw new Error(
        `Strict Langfuse prompt resolution failed: ${name}${pin} (${reason}).`,
      );
    }
    (this.options.warn ?? warnPromptFallback)({
      name,
      reason,
      ...(version === undefined ? {} : { version }),
    });
    return fallbackPrompt(name, builtin, label, reason);
  }
}

export function assertLangfusePromptRuntimePolicy(
  env: Record<string, string | undefined> = process.env,
) {
  readLangfusePromptRuntimeConfig(env);
}

function readLangfusePromptRuntimeConfig(
  env: Record<string, string | undefined>,
) {
  const policy = promptPolicyFromEnv(env.LANGFUSE_PROMPT_POLICY);
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (policy === 'strict') {
    const missing = [
      ...(baseUrl ? [] : ['LANGFUSE_BASE_URL']),
      ...(publicKey ? [] : ['LANGFUSE_PUBLIC_KEY']),
      ...(secretKey ? [] : ['LANGFUSE_SECRET_KEY']),
      ...(env.LANGFUSE_PROMPT_VERSIONS?.trim()
        ? []
        : ['LANGFUSE_PROMPT_VERSIONS']),
    ];
    if (missing.length > 0) {
      throw new Error(
        `Strict Langfuse prompt policy requires ${missing.join(', ')}.`,
      );
    }
  }
  const versions = promptVersionsFromEnv(
    env.LANGFUSE_PROMPT_VERSIONS,
    policy,
  );
  return {
    policy,
    ...(baseUrl ? { baseUrl } : {}),
    ...(publicKey ? { publicKey } : {}),
    ...(secretKey ? { secretKey } : {}),
    versions,
  };
}

export function langfusePromptResolverFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const runtime = readLangfusePromptRuntimeConfig(env);
  return new LangfuseHarnessPromptResolver({
    ...runtime,
    label: env.LANGFUSE_PROMPT_LABEL ?? 'production',
    ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
      ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
      : {}),
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

function promptPolicyFromEnv(value: string | undefined): LangfusePromptPolicy {
  const normalized = value?.trim() || 'strict';
  if (normalized === 'pilot' || normalized === 'strict') return normalized;
  throw new Error('LANGFUSE_PROMPT_POLICY must be pilot or strict.');
}

function warnPromptFallback(input: {
  name: string;
  reason: string;
  version?: number;
}) {
  const pin = input.version === undefined ? '' : ` version=${input.version}`;
  console.warn(
    `[harness] Langfuse prompt downgraded to builtin: ${input.name}${pin} (${input.reason}).`,
  );
}

function promptVersionsFromEnv(
  value: string | undefined,
  policy: LangfusePromptPolicy,
): Partial<Record<HarnessPromptKey, number>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    if (policy === 'pilot') return {};
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  if (!isRecord(parsed)) {
    if (policy === 'pilot') return {};
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  const versions: Partial<Record<HarnessPromptKey, number>> = {};
  for (const [key, version] of Object.entries(parsed)) {
    if (!(key in HARNESS_LANGFUSE_PROMPT_NAMES)) {
      if (policy === 'pilot') continue;
      throw new Error(`LANGFUSE_PROMPT_VERSIONS contains unknown key: ${key}.`);
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
      if (policy === 'pilot') continue;
      throw new Error(`LANGFUSE_PROMPT_VERSIONS.${key} must be a positive integer.`);
    }
    versions[key as HarnessPromptKey] = version;
  }
  if (policy === 'strict') {
    const missing = Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).filter(
      (key) => versions[key as HarnessPromptKey] === undefined,
    );
    if (missing.length > 0) {
      throw new Error(
        `LANGFUSE_PROMPT_VERSIONS is missing pinned prompts: ${missing.join(', ')}.`,
      );
    }
  }
  return versions;
}
