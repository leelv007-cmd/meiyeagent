import { LangfuseHttpSender, langfuseTraceId } from './langfuse-sender.js';
import { harnessRuntimeId } from './workspace-scope.js';

export const LANGFUSE_OBSERVABILITY_FILTER_AXES = [
  'axisScope',
  'catalogRevision',
  'promptVersion',
  'scene',
] as const;

type FilterAxis = (typeof LANGFUSE_OBSERVABILITY_FILTER_AXES)[number];

export interface LangfuseObservabilityLiveAcceptanceOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  runId: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  consistencyTimeoutMs?: number;
  pollIntervalMs?: number;
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
    axisScope: 'task_root',
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
      ...axes,
      skillRevision: `issue-248-observability@${options.runId}`,
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
  let observationId: string | undefined;
  for (const axis of LANGFUSE_OBSERVABILITY_FILTER_AXES) {
    const positive = await waitForExactObservationMatch({
      ...options,
      fetch,
      traceId,
      axis,
      value: axes[axis],
    });
    observationId ??= positive.id;
    if (positive.id !== observationId) {
      throw new Error(
        `Langfuse observability ${axis} filter returned a different observation.`,
      );
    }
    positiveMatches[axis] = 1;

    const negative = await queryObservations({
      ...options,
      fetch,
      traceId,
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

  if (!observationId) {
    throw new Error('Langfuse observability acceptance returned no observation ID.');
  }
  return {
    runId: options.runId,
    traceId,
    observationId,
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

async function waitForExactObservationMatch(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    traceId: string;
    axis: FilterAxis;
    value: string;
  },
) {
  const deadline = Date.now() + (options.consistencyTimeoutMs ?? 30_000);
  do {
    const matches = await queryObservations(options);
    if (matches.length === 1) {
      const [match] = matches;
      if (
        match?.traceId !== options.traceId ||
        match.metadata?.[options.axis] !== options.value
      ) {
        throw new Error(
          `Langfuse observability ${options.axis} filter returned invalid metadata.`,
        );
      }
      return match;
    }
    if (matches.length > 1) {
      throw new Error(
        `Langfuse observability ${options.axis} filter returned multiple observations.`,
      );
    }
    await delay(options.pollIntervalMs ?? 500);
  } while (Date.now() < deadline);
  throw new Error(
    `Langfuse observability ${options.axis} filter did not return the live observation before timeout.`,
  );
}

async function queryObservations(
  options: LangfuseObservabilityLiveAcceptanceOptions & {
    fetch: typeof globalThis.fetch;
    traceId: string;
    axis: FilterAxis;
    value: string;
  },
) {
  const baseUrl = options.baseUrl.replace(/\/$/u, '');
  const url = new URL(`${baseUrl}/api/public/v2/observations`);
  url.searchParams.set('fields', 'core,metadata');
  url.searchParams.set('limit', '10');
  url.searchParams.set(
    'filter',
    JSON.stringify([
      {
        type: 'string',
        column: 'traceId',
        operator: '=',
        value: options.traceId,
      },
      {
        type: 'stringObject',
        column: 'metadata',
        key: options.axis,
        operator: '=',
        value: options.value,
      },
    ]),
  );
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
    throw new Error('Langfuse observability filter request failed.');
  }
  if (!response.ok) {
    throw new Error(
      `Langfuse observability filter failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error('Langfuse observability filter response is invalid.');
  }
  return body.data.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.traceId !== 'string' ||
      !isRecord(item.metadata)
    ) {
      throw new Error('Langfuse observability filter item is invalid.');
    }
    return {
      id: item.id,
      traceId: item.traceId,
      metadata: item.metadata,
    };
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
