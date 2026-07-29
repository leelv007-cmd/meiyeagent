import { createHash } from 'node:crypto';

export interface LangfuseLongPromptAcceptanceOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  name: string;
  prompt: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface LangfuseLongPromptAcceptanceResult {
  name: string;
  version: number;
  characters: number;
  utf8Bytes: number;
  contentHash: string;
  matched: true;
}

export async function runLangfuseLongPromptAcceptance(
  options: LangfuseLongPromptAcceptanceOptions,
): Promise<LangfuseLongPromptAcceptanceResult> {
  const characters = [...options.prompt].length;
  if (characters <= 1024) {
    throw new Error(
      'Langfuse long prompt acceptance requires more than 1024 characters.',
    );
  }
  if (!options.name.trim()) {
    throw new Error('Langfuse long prompt acceptance name must not be empty.');
  }

  const baseUrl = options.baseUrl.replace(/\/$/u, '');
  const authorization = `Basic ${Buffer.from(
    `${options.publicKey}:${options.secretKey}`,
  ).toString('base64')}`;
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const created = await requestJson(
    fetch,
    `${baseUrl}/api/public/v2/prompts`,
    {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: options.name,
        type: 'text',
        prompt: options.prompt,
        labels: ['acceptance'],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
    'create',
  );
  const version = validVersion(created.version);
  if (version === undefined) {
    throw new Error(
      'Langfuse long prompt acceptance create response has no exact version.',
    );
  }

  const fetched = await requestJson(
    fetch,
    `${baseUrl}/api/public/v2/prompts/${encodeURIComponent(options.name)}?version=${encodeURIComponent(String(version))}`,
    {
      headers: { authorization },
      signal: AbortSignal.timeout(timeoutMs),
    },
    'read exact version',
  );
  if (
    fetched.type !== 'text' ||
    fetched.name !== options.name ||
    String(fetched.version) !== String(version) ||
    typeof fetched.prompt !== 'string'
  ) {
    throw new Error(
      'Langfuse long prompt acceptance exact-version response is invalid.',
    );
  }

  const expectedHash = sha256(options.prompt);
  const fetchedHash = sha256(fetched.prompt);
  if (fetched.prompt !== options.prompt || fetchedHash !== expectedHash) {
    throw new Error(
      'Langfuse long prompt acceptance detected truncated or changed content.',
    );
  }

  return {
    name: options.name,
    version,
    characters,
    utf8Bytes: Buffer.byteLength(options.prompt),
    contentHash: expectedHash,
    matched: true,
  };
}

export function assertLangfuseLongPromptLiveConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.RUN_LIVE_LANGFUSE_PROMPT_ACCEPTANCE !== '1') {
    throw new Error(
      'Set RUN_LIVE_LANGFUSE_PROMPT_ACCEPTANCE=1 to run the live Langfuse prompt acceptance.',
    );
  }
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!baseUrl || !publicKey || !secretKey) {
    throw new Error(
      'LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY are required.',
    );
  }
  return { baseUrl, publicKey, secretKey };
}

async function requestJson(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  operation: string,
) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(`Langfuse prompt ${operation} request failed.`);
  }
  if (!response.ok) {
    throw new Error(
      `Langfuse prompt ${operation} failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    throw new Error(`Langfuse prompt ${operation} response is invalid.`);
  }
  return body;
}

function validVersion(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
