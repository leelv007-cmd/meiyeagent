import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type {
  StrictByokExecutionPort,
  StrictByokExecutionRequest,
} from './contracts.js';

export class RecordedByokExecutionAdapter implements StrictByokExecutionPort {
  private readonly recordedAttempts: Array<Omit<StrictByokExecutionRequest, 'credential'>> = [];
  private nextFailure?: 'unauthorized' | 'failed';

  failNext(failure: 'unauthorized' | 'failed') {
    this.nextFailure = failure;
  }

  attempts() {
    return structuredClone(this.recordedAttempts);
  }

  async execute(request: StrictByokExecutionRequest) {
    this.recordedAttempts.push({
      endpoint: request.endpoint,
      catalogModelId: request.catalogModelId,
      prompt: request.prompt,
    });
    if (this.nextFailure) {
      const status = this.nextFailure;
      this.nextFailure = undefined;
      return { status } as const;
    }
    return { status: 'completed' as const, output: `recorded:${request.catalogModelId}` };
  }
}

export interface LiveByokExecutionOptions {
  modelBindings: Readonly<Record<string, string>>;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class LiveByokExecutionAdapter implements StrictByokExecutionPort {
  constructor(private readonly options: LiveByokExecutionOptions) {}

  async execute(request: StrictByokExecutionRequest) {
    const modelName = this.options.modelBindings[request.catalogModelId]?.trim();
    if (!modelName) return { status: 'failed' as const };

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.options.timeoutMs ?? 60_000,
    );
    try {
      const provider = createOpenAICompatible({
        apiKey: request.credential,
        baseURL: request.endpoint.replace(/\/$/, ''),
        fetch: this.options.fetch,
        name: 'meiye-byok',
      });
      const result = await generateText({
        abortSignal: abortController.signal,
        maxRetries: 0,
        model: provider.chatModel(modelName),
        prompt: request.prompt,
      });
      const output = result.text.trim();
      return output
        ? { status: 'completed' as const, output }
        : { status: 'failed' as const };
    } catch (error) {
      const statusCode = providerStatusCode(error);
      return {
        status:
          statusCode === 401 || statusCode === 403
            ? ('unauthorized' as const)
            : ('failed' as const),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function providerStatusCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return undefined;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}
