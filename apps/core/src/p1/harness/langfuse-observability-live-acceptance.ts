import { LangfuseHttpSender, langfuseTraceId } from './langfuse-sender.js';
import { harnessRuntimeId } from './workspace-scope.js';

export const LANGFUSE_OBSERVABILITY_FILTER_AXES = [
  'skillRevision',
  'catalogRevision',
  'promptVersion',
  'scene',
] as const;

type FilterAxis = (typeof LANGFUSE_OBSERVABILITY_FILTER_AXES)[number];
type Sleep = (milliseconds: number) => Promise<void>;

const MIN_POLL_INTERVAL_MS = 5_000;
const DEFAULT_CONSISTENCY_TIMEOUT_MS = 120_000;

export interface LangfuseObservabilityLiveAcceptanceOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  runId: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  consistencyTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: Sleep;
}

export interface LangfuseObservabilityLiveAcceptanceResult {
  runId: string;
  traceId: string;
  observationId: string;
  positiveMatches: Record<FilterAxis, number>;
  negativeMatches: Record<FilterAxis, 0>;
  matched: true;
}

export async function runLangfuseObservabilityLiveAcceptance(
  options: LangfuseObservabilityLiveAcceptanceOptions,
): Promise<LangfuseObservabilityLiveAcceptanceResult> {
  if (!options.runId.trim()) {
    throw new Error('Langfuse observability acceptance run ID must not be empty.');
  }

  const fetch = options.fetch ?? globalThis.fetch;
  const taskId = `issue-248-live-${options.runId}`;
  const workflowId = harnessRuntimeId('issue-248-live', taskId);
  const traceId = langfuseTraceId(workflowId);
  const axes = {
    skillRevision: `issue-248-observability@${options.runId}`,
    catalogRevision: `issue-248-catalog-${options.runId}`,
    promptVersion: `issue-248-prompt@${options.runId}`,
    scene: `issue-248-scene-${options.runId}`,
  } as const;
  const sender = new LangfuseHttpSender({
    baseUrl: options.baseUrl,
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    fetch,
    timeoutMs: options.requestTimeoutMs,
  });

  await sender.send({
    auditId: `issue-248-live-${options.runId}`,
    workflowId,
    stage: 'observability_event_ingest',
    eventType: 'agent_primitive.lifecycle',
    occurredAt: new Date().toISOString(),
    payload: {
      eventType: 'agent_primitive.lifecycle',
      taskId,
      workspaceId: 'issue-248-live',
      actorId: `ref:${'2'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: `issue-248-live-${options.runId}`,
      axisScope: 'task_root',
      ...axes,
      payload: {
        primitiveId: 'harness-assembly:task_pin',
        phase: 'succeeded',
        billing: { kind: 'not_billed' },
      },
    },
    decisionTrace: null,
    traceContractVersion: 'observability/v1',
    attempts: 1,
  });

  const positiveMatches = {} as Record<FilterAxis, number>;
  const negativeMatches = {} as Record<FilterAxis, 0>;
  const observation = await waitForTaskRootObservation({
    ...options,
    fetch,
    traceId,
    axes,
  });
  for (const axis of LANGFUSE_OBSERVABILITY_FILTER_AXES) {
    await waitForExactTraceMatch({
      ...options,
      fetch,
      traceId,
      axis,
      value: axes[axis],
    });
    positiveMatches[axis] = 1;

    const negative = await waitForTraceQuery({
      ...options,
      fetch,
      axis,
      value: `${axes[axis]}-negative-control`,
    });
    if (negative.length !== 0) {
      throw new Error(
        `Langfuse observability ${axis} filter matched its negative control.`,
      );
    }
    negativeMatches[axis] = 0;
  }

  return {
    runId: options.runId,
    traceId,
    observationId: observation.id,
    positiveMatches,
    negativeMatches,
    matched: true,
  };
}

export function assertLangfuseObservabilityLiveConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.RUN_LIVE_LANGFUSE_OBSERVABILITY_ACCEPTANCE !== '1') {
    throw new Error(
      'Set RUN_LIVE_LANGFUSE_OBSERVABILITY_ACCEPTANCE=1 to run the live Langfuse observability acceptance.',
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

async function waitForExactTraceMatch(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    traceId: string;
    axis: FilterAxis;
    value: string;
  },
) {
  const deadline = consistencyDeadline(options);
  while (true) {
    const result = await queryTraces(options);
    if (!result.rateLimited && result.data.length === 1) {
      const match = result.data[0]!;
      if (
        match?.id !== options.traceId ||
        match.metadata?.[options.axis] !== options.value
      ) {
        throw new Error(
          `Langfuse observability ${options.axis} trace filter returned invalid metadata.`,
        );
      }
      return match;
    }
    if (!result.rateLimited && result.data.length > 1) {
      throw new Error(
        `Langfuse observability ${options.axis} filter returned multiple traces.`,
      );
    }
    await waitForRetry(
      options,
      deadline,
      `Langfuse observability ${options.axis} filter did not return the live trace before timeout.`,
    );
  }
}

async function waitForTraceQuery(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    axis: FilterAxis;
    value: string;
  },
) {
  const deadline = consistencyDeadline(options);
  while (true) {
    const result = await queryTraces(options);
    if (!result.rateLimited) return result.data;
    await waitForRetry(
      options,
      deadline,
      `Langfuse observability ${options.axis} filter remained rate limited before timeout.`,
    );
  }
}

async function waitForTaskRootObservation(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    traceId: string;
    axes: Record<FilterAxis, string>;
  },
) {
  const deadline = consistencyDeadline(options);
  while (true) {
    const result = await queryObservations(options);
    if (!result.rateLimited && result.data.length === 1) {
      const observation = result.data[0]!;
      if (
        observation.metadata.axisScope !== 'task_root' ||
        LANGFUSE_OBSERVABILITY_FILTER_AXES.some(
          (axis) => observation.metadata[axis] !== options.axes[axis],
        )
      ) {
        throw new Error(
          'Langfuse observability Task-root observation returned invalid metadata.',
        );
      }
      return observation;
    }
    if (!result.rateLimited && result.data.length > 1) {
      throw new Error(
        'Langfuse observability trace returned multiple Task-root observations.',
      );
    }
    await waitForRetry(
      options,
      deadline,
      'Langfuse observability Task-root observation did not become visible before timeout.',
    );
  }
}

async function queryTraces(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    axis: FilterAxis;
    value: string;
  },
) {
  const baseUrl = options.baseUrl.replace(/\/$/u, '');
  const url = new URL(`${baseUrl}/api/public/traces`);
  url.searchParams.set('limit', '10');
  url.searchParams.set(
    'filter',
    JSON.stringify([
      {
        type: 'stringObject',
        column: 'metadata',
        key: options.axis,
        operator: '=',
        value: options.value,
      },
    ]),
  );
  const response = await getLangfuseResponse(options, url, 'filter');
  if (response.status === 429) return { rateLimited: true as const };
  if (!response.ok) {
    throw new Error(
      `Langfuse observability filter failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error('Langfuse observability filter response is invalid.');
  }
  return {
    rateLimited: false as const,
    data: body.data.map((item) => parseMetadataItem(item, 'trace')),
  };
}

async function queryObservations(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    traceId: string;
  },
) {
  const baseUrl = options.baseUrl.replace(/\/$/u, '');
  const url = new URL(`${baseUrl}/api/public/observations`);
  url.searchParams.set('traceId', options.traceId);
  const response = await getLangfuseResponse(options, url, 'observation readback');
  if (response.status === 429) return { rateLimited: true as const };
  if (!response.ok) {
    throw new Error(
      `Langfuse observability observation readback failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error(
      'Langfuse observability observation readback response is invalid.',
    );
  }
  return {
    rateLimited: false as const,
    data: body.data.map((item) => parseMetadataItem(item, 'observation')),
  };
}

async function getLangfuseResponse(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
  },
  url: URL,
  operation: string,
) {
  const authorization = `Basic ${Buffer.from(
    `${options.publicKey}:${options.secretKey}`,
  ).toString('base64')}`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { authorization },
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10_000),
    });
  } catch {
    throw new Error(`Langfuse observability ${operation} request failed.`);
  }
  return response;
}

function parseMetadataItem(value: unknown, resource: 'trace' | 'observation') {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isRecord(value.metadata)
  ) {
    throw new Error(`Langfuse observability ${resource} item is invalid.`);
  }
  return { id: value.id, metadata: value.metadata };
}

function consistencyDeadline(options: LangfuseObservabilityLiveAcceptanceOptions) {
  return Date.now() +
    (options.consistencyTimeoutMs ?? DEFAULT_CONSISTENCY_TIMEOUT_MS);
}

async function waitForRetry(
  options: LangfuseObservabilityLiveAcceptanceOptions,
  deadline: number,
  timeoutMessage: string,
) {
  if (Date.now() >= deadline) throw new Error(timeoutMessage);
  const pollIntervalMs = Math.max(
    options.pollIntervalMs ?? MIN_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  await (options.sleep ?? delay)(pollIntervalMs);
  if (Date.now() >= deadline) throw new Error(timeoutMessage);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
