import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';

import {
  FixtureDocumentParseProvider,
  ParseProviderError,
  type DocumentParseProvider,
} from './parse-service.js';

type Fetch = typeof fetch;
const jsonSchema = z.json();

interface MinerUResponse {
  code?: number;
  msg?: string;
  data?: Record<string, unknown>;
}

export class MinerUOfficialParseProvider implements DocumentParseProvider {
  private readonly fetchImpl: Fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string,
    options: {
      baseUrl?: string;
      fetchImpl?: Fetch;
      pollIntervalMs?: number;
      timeoutMs?: number;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    if (!token.trim()) {
      throw new Error('MINERU_API_TOKEN is required in official mode.');
    }
    this.baseUrl = (options.baseUrl ?? 'https://mineru.net').replace(/\/$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async parse(input: Parameters<DocumentParseProvider['parse']>[0]) {
    if (
      input.source.inputKind === 'visual_asset' ||
      input.source.inputKind === 'sensitive_document' ||
      !input.source.sourceUrl
    ) {
      throw new ParseProviderError(
        'failed',
        'MinerU requires a non-sensitive document with a source URL.',
      );
    }
    const submitted = await this.request('/api/v4/extract/task', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-idempotency-key': input.effectIdempotencyKey,
      },
      body: JSON.stringify({
        url: input.source.sourceUrl,
        model_version:
          input.source.inputKind === 'html' ? 'MinerU-HTML' : 'vlm',
        is_ocr: input.source.inputKind === 'document_image',
        enable_table: true,
        enable_formula: false,
      }),
    });
    const taskId = textField(submitted.data, 'task_id');
    if (!taskId) {
      throw new ParseProviderError(
        'failed',
        'MinerU submit response did not include a task id.',
      );
    }

    const startedAt = Date.now();
    for (;;) {
      if (Date.now() - startedAt >= this.timeoutMs) {
        throw new ParseProviderError('timeout', 'MinerU parse timed out.');
      }
      const response = await this.request(`/api/v4/extract/task/${taskId}`);
      const data = response.data ?? {};
      const state = textField(data, 'state') ?? textField(data, 'status');
      if (state === 'failed') {
        throw new ParseProviderError(
          'failed',
          textField(data, 'err_msg') ?? 'MinerU parse failed.',
        );
      }
      if (state === 'done') {
        const progress = objectField(data, 'extract_progress');
        const totalPages =
          numberField(progress, 'total_pages') ??
          numberField(data, 'total_pages') ??
          1;
        const extractedPages =
          numberField(progress, 'extracted_pages') ??
          numberField(data, 'extracted_pages') ??
          totalPages;
        const output = await this.readOutput(data);
        return {
          parserKind: 'mineru_official' as const,
          parserVersion: textField(data, 'version') ?? 'v4',
          providerTaskRef: taskId,
          markdown: output.markdown,
          structured: output.structured,
          extractedPages,
          totalPages,
        };
      }
      if (
        state !== 'pending' &&
        state !== 'running' &&
        state !== 'converting'
      ) {
        throw new ParseProviderError(
          'failed',
          `MinerU returned an unknown state: ${state ?? 'missing'}.`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async readOutput(
    data: Record<string, unknown>,
  ): Promise<{ markdown: string; structured: z.infer<typeof jsonSchema> }> {
    const markdown =
      textField(data, 'markdown') ??
      textField(objectField(data, 'result'), 'markdown');
    const structured =
      objectField(data, 'structured') ??
      objectField(objectField(data, 'result'), 'structured');
    if (markdown) {
      return { markdown, structured: jsonSchema.parse(structured ?? {}) };
    }
    const zipUrl =
      textField(data, 'full_zip_url') ??
      textField(objectField(data, 'result'), 'full_zip_url');
    if (!zipUrl) {
      throw new ParseProviderError(
        'failed',
        'MinerU completed without a result archive.',
      );
    }
    const response = await this.fetchWithClassification(zipUrl);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const markdownEntry = Object.entries(files).find(([name]) =>
      name.endsWith('.md'),
    );
    if (!markdownEntry) {
      throw new ParseProviderError(
        'failed',
        'MinerU result archive did not contain Markdown.',
      );
    }
    const jsonEntry = Object.entries(files).find(([name]) =>
      name.endsWith('.json'),
    );
    let json: unknown = {};
    if (jsonEntry) {
      try {
        json = JSON.parse(strFromU8(jsonEntry[1]));
      } catch {
        json = {};
      }
    }
    return {
      markdown: strFromU8(markdownEntry[1]),
      structured: jsonSchema.parse(json),
    };
  }

  private async request(path: string, init?: RequestInit) {
    const response = await this.fetchWithClassification(
      `${this.baseUrl}${path}`,
      init,
    );
    let payload: MinerUResponse;
    try {
      payload = (await response.json()) as MinerUResponse;
    } catch {
      throw new ParseProviderError(
        'failed',
        'MinerU returned an invalid JSON response.',
      );
    }
    if (payload.code !== undefined && payload.code !== 0) {
      throw new ParseProviderError(
        payload.code === 429 ? 'rate_limited' : 'failed',
        payload.msg ?? `MinerU returned code ${payload.code}.`,
      );
    }
    return payload;
  }

  private async fetchWithClassification(url: string, init?: RequestInit) {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 429) {
        throw new ParseProviderError(
          'rate_limited',
          'MinerU rate limit was reached.',
        );
      }
      if (!response.ok) {
        throw new ParseProviderError(
          'failed',
          `MinerU request failed with HTTP ${response.status}.`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof ParseProviderError) throw error;
      throw new ParseProviderError(
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'timeout'
          : 'failed',
        'MinerU request could not be completed.',
      );
    }
  }
}

export function documentParseProviderFromEnv(
  env: NodeJS.ProcessEnv,
  options: { fetchImpl?: Fetch } = {},
) {
  if ((env.MINERU_PARSE_MODE ?? 'fixture') !== 'official') {
    return new FixtureDocumentParseProvider();
  }
  return new MinerUOfficialParseProvider(env.MINERU_API_TOKEN ?? '', {
    baseUrl: env.MINERU_API_BASE_URL,
    fetchImpl: options.fetchImpl,
  });
}

function objectField(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const field = value?.[key];
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined;
}

function textField(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const field = value?.[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function numberField(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const field = value?.[key];
  return typeof field === 'number' && Number.isFinite(field)
    ? field
    : undefined;
}
