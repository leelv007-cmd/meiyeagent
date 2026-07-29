import { createHash } from 'node:crypto';

import { harnessLogicalId } from './workspace-scope.js';
import type {
  HarnessLangfuseOutboxItem,
  HarnessLangfuseSender,
} from './outbox-worker.js';

export const LANGFUSE_INGESTION_EVENT_FIELDS = [
  'id',
  'timestamp',
  'type',
  'body',
] as const;

export const LANGFUSE_TRACE_BODY_FIELDS = [
  'id',
  'name',
  'sessionId',
  'tags',
  'metadata',
] as const;

export const LANGFUSE_SPAN_BODY_FIELDS = [
  'id',
  'traceId',
  'name',
  'startTime',
  'input',
  'output',
  'metadata',
] as const;

export const LANGFUSE_SCORE_BODY_FIELDS = [
  'id',
  'traceId',
  'observationId',
  'name',
  'value',
  'comment',
  'metadata',
] as const;

export const LANGFUSE_DATASET_ITEM_FIELDS = [
  'id',
  'datasetName',
  'input',
  'expectedOutput',
  'metadata',
  'sourceTraceId',
  'sourceObservationId',
] as const;

const STAGE_NAMES: Record<string, string> = {
  intent_naming: '01-intent-naming',
  context_injection: '02-context-injection',
  brief_compilation: '03-brief-compilation',
  execution_selection: '04-execution-selection',
  assembly_delivery: '05-assembly-delivery',
};

const LANGFUSE_SCORE_REASON_CODE = 'model_score_reason_redacted';

export interface LangfuseHttpSenderOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

type IngestionEvent = {
  id: string;
  timestamp: string;
  type: 'trace-create' | 'span-create' | 'score-create';
  body: Record<string, unknown>;
};

export class LangfuseHttpSender implements HarnessLangfuseSender {
  private readonly fetch: typeof globalThis.fetch;
  private readonly ingestionUrl: string;
  private readonly datasetItemsUrl: string;

  constructor(private readonly options: LangfuseHttpSenderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    const baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.ingestionUrl = `${baseUrl}/api/public/ingestion`;
    this.datasetItemsUrl = `${baseUrl}/api/public/dataset-items`;
  }

  async send(item: HarnessLangfuseOutboxItem) {
    const { batch, datasetItem } = mapOutboxItem(item);
    await this.post(this.ingestionUrl, { batch }, 'ingestion');
    if (datasetItem) {
      await this.post(this.datasetItemsUrl, datasetItem, 'dataset item');
    }
  }

  private async post(url: string, body: unknown, operation: string) {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.options.publicKey}:${this.options.secretKey}`,
        ).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Langfuse ${operation} failed with HTTP ${response.status}.`,
      );
    }
    const result = await response.json().catch(() => null);
    if (
      isRecord(result) &&
      Array.isArray(result.errors) &&
      result.errors.length > 0
    ) {
      throw new Error(
        `Langfuse ${operation} reported one or more event errors.`,
      );
    }
  }
}

export function langfuseSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
): HarnessLangfuseSender {
  const missing = [
    'LANGFUSE_BASE_URL',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
  ].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return {
      async send() {
        throw new Error(
          `Harness Langfuse sender is not configured: ${missing.join(', ')}.`,
        );
      },
    };
  }
  return new LangfuseHttpSender({
    baseUrl: env.LANGFUSE_BASE_URL!,
    publicKey: env.LANGFUSE_PUBLIC_KEY!,
    secretKey: env.LANGFUSE_SECRET_KEY!,
    ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
      ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
      : {}),
  });
}

function mapOutboxItem(item: HarnessLangfuseOutboxItem) {
  const taskId = harnessLogicalId(item.workflowId);
  const traceId = stableUuid(`trace:${item.workflowId}`);
  const spanId = stableUuid(
    `span:${item.workflowId}:${item.stage}:${item.auditId}`,
  );
  const decisionTrace = projectDecisionTrace(item.stage, item.decisionTrace);
  const prompt =
    projectPromptReference(isRecord(item.decisionTrace)?.prompt) ??
    projectPromptReference(isRecord(item.payload)?.prompt);
  const metrics = projectMetrics(isRecord(item.decisionTrace)?.metrics);
  const productMetrics = projectProductMetrics(item.eventType, item.payload);
  const skillRevisionRefs = stringArray(
    isRecord(item.decisionTrace)?.skillRevisionRefs,
  ) ?? [];
  const skillContentHashes = stringArray(
    isRecord(item.decisionTrace)?.skillContentHashes,
  ) ?? [];
  const skillLineage =
    skillRevisionRefs.length > 0 || skillContentHashes.length > 0
      ? { skillRevisionRefs, skillContentHashes }
      : {};
  const traceBody = exactFields(LANGFUSE_TRACE_BODY_FIELDS, {
    id: traceId,
    name: 'beauty-marketing-task',
    sessionId: item.workflowId,
    tags: ['harness', item.stage],
    metadata: { taskId, workflowId: item.workflowId, ...skillLineage },
  });
  const spanMetadata: Record<string, unknown> = {
    auditId: item.auditId,
    taskId,
    workflowId: item.workflowId,
    spanId,
    stage: item.stage,
    eventType: item.eventType,
    ...(decisionTrace ? { decisionTrace } : {}),
    ...(prompt ? { prompt } : {}),
    ...(metrics ? { metrics } : {}),
    ...(productMetrics ? { productMetrics } : {}),
    ...skillLineage,
  };
  const spanBody = exactFields(LANGFUSE_SPAN_BODY_FIELDS, {
    id: spanId,
    traceId,
    name: STAGE_NAMES[item.stage] ?? `event-${safeLabel(item.stage)}`,
    startTime: item.occurredAt,
    input: { eventType: item.eventType },
    output: projectStageOutput(item.stage, item.decisionTrace, item.payload),
    metadata: spanMetadata,
  });
  const events: IngestionEvent[] = [
    ingestionEvent(item, 'trace', 'trace-create', traceBody),
    ingestionEvent(item, 'span', 'span-create', spanBody),
  ];
  events.push(...selectionScores(item, traceId, spanId));
  events.push(...metricScores(item, traceId, spanId, prompt, metrics));
  events.push(...productMetricScores(item, traceId, spanId, productMetrics));
  return {
    batch: events,
    datasetItem: metricsDatasetItem(
      item,
      taskId,
      traceId,
      spanId,
      prompt,
      metrics,
    ),
  };
}

function selectionScores(
  item: HarnessLangfuseOutboxItem,
  traceId: string,
  spanId: string,
): IngestionEvent[] {
  if (item.stage !== 'execution_selection') return [];
  const trace = isRecord(item.decisionTrace);
  const scores = Array.isArray(trace?.candidateScores)
    ? trace.candidateScores
    : [];
  return scores.flatMap((candidate, index) => {
    const value = isRecord(candidate) ? candidate : undefined;
    if (
      typeof value?.candidateId !== 'string' ||
      typeof value.score !== 'number' ||
      !Number.isFinite(value.score)
    ) {
      return [];
    }
    const body = exactFields(LANGFUSE_SCORE_BODY_FIELDS, {
      id: stableUuid(
        `score:${item.auditId}:selection:${value.candidateId}:${index}`,
      ),
      traceId,
      observationId: spanId,
      name: 'harness.selection.candidate_score',
      value: value.score,
      comment: LANGFUSE_SCORE_REASON_CODE,
      metadata: {
        candidateId: value.candidateId,
        reasonCode: LANGFUSE_SCORE_REASON_CODE,
      },
    });
    return [
      ingestionEvent(
        item,
        `selection-score:${value.candidateId}:${index}`,
        'score-create',
        body,
      ),
    ];
  });
}

function metricScores(
  item: HarnessLangfuseOutboxItem,
  traceId: string,
  spanId: string,
  prompt: ReturnType<typeof projectPromptReference>,
  metrics: ReturnType<typeof projectMetrics>,
): IngestionEvent[] {
  if (!prompt || !metrics) return [];
  const common = {
    promptName: prompt.name,
    promptVersion: prompt.version,
  };
  const definitions = [
    {
      name: 'harness.schema.first_pass_rate',
      value: rate(metrics.initial.schemaValid, metrics.initial.calls),
      comment: `${metrics.initial.schemaValid}/${metrics.initial.calls} initial schemas valid`,
      metadata: {
        ...common,
        numerator: metrics.initial.schemaValid,
        denominator: metrics.initial.calls,
      },
    },
    {
      name: 'harness.repair.call_rate',
      value: rate(metrics.repair.count, metrics.initial.calls),
      comment: `${metrics.repair.count}/${metrics.initial.calls} repair events observed`,
      metadata: {
        ...common,
        numerator: metrics.repair.count,
        denominator: metrics.initial.calls,
        reasons: metrics.repair.reasons,
      },
    },
    {
      name: 'harness.retry.trigger_rate',
      value: rate(metrics.retry.triggered, metrics.initial.calls),
      comment: `${metrics.retry.triggered}/${metrics.initial.calls} calls triggered retry attempts`,
      metadata: {
        ...common,
        numerator: metrics.retry.triggered,
        denominator: metrics.initial.calls,
      },
    },
    {
      name: 'harness.nested_field_completeness_rate',
      value: rate(
        metrics.nestedCompleteness.complete,
        metrics.nestedCompleteness.total,
      ),
      comment: `${metrics.nestedCompleteness.complete}/${metrics.nestedCompleteness.total} nested fields complete`,
      metadata: {
        ...common,
        numerator: metrics.nestedCompleteness.complete,
        denominator: metrics.nestedCompleteness.total,
      },
    },
  ];
  return definitions.map((definition, index) => {
    const body = exactFields(LANGFUSE_SCORE_BODY_FIELDS, {
      id: stableUuid(`score:${item.auditId}:metric:${definition.name}`),
      traceId,
      observationId: spanId,
      name: definition.name,
      value: definition.value,
      comment: definition.comment,
      metadata: definition.metadata,
    });
    return ingestionEvent(
      item,
      `metric-score:${index}:${definition.name}`,
      'score-create',
      body,
    );
  });
}

function productMetricScores(
  item: HarnessLangfuseOutboxItem,
  traceId: string,
  spanId: string,
  metrics: ReturnType<typeof projectProductMetrics>,
): IngestionEvent[] {
  if (!metrics) return [];
  const definitions = [
    ...(metrics.path === 'conflict'
      ? []
      : [
          {
            name: 'product.confirmation_precision',
            value: metrics.userActivationCount <= 2 ? 1 : 0,
            comment: `${metrics.userActivationCount} user activations before first usable draft`,
            metadata: {
              path: metrics.path,
              threshold: 2,
              userActivationCount: metrics.userActivationCount,
            },
          },
        ]),
    {
      name: 'product.time_to_first_usable_draft',
      value: metrics.timeToFirstUsableDraftMs,
      comment: `${metrics.timeToFirstUsableDraftMs}ms to first usable draft`,
      metadata: {
        path: metrics.path,
        unit: 'milliseconds',
        userActivationCount: metrics.userActivationCount,
      },
    },
  ];
  return definitions.map((definition, index) => {
    const body = exactFields(LANGFUSE_SCORE_BODY_FIELDS, {
      id: stableUuid(`score:${item.auditId}:metric:${definition.name}`),
      traceId,
      observationId: spanId,
      name: definition.name,
      value: definition.value,
      comment: definition.comment,
      metadata: definition.metadata,
    });
    return ingestionEvent(
      item,
      `product-metric-score:${index}:${definition.name}`,
      'score-create',
      body,
    );
  });
}

function metricsDatasetItem(
  item: HarnessLangfuseOutboxItem,
  taskId: string,
  traceId: string,
  spanId: string,
  prompt: ReturnType<typeof projectPromptReference>,
  metrics: ReturnType<typeof projectMetrics>,
) {
  if (!prompt || !metrics) return undefined;
  return exactFields(LANGFUSE_DATASET_ITEM_FIELDS, {
    id: stableUuid(`dataset-item:${item.auditId}`),
    datasetName: 'harness-structured-node-metrics',
    input: { taskId, workflowId: item.workflowId, stage: item.stage },
    expectedOutput: { metrics },
    metadata: {
      node: item.stage,
      promptName: prompt.name,
      promptVersion: prompt.version,
      promptContentHash: prompt.contentHash,
      promptFallback: prompt.isFallback,
    },
    sourceTraceId: traceId,
    sourceObservationId: spanId,
  });
}

function projectMetrics(input: unknown) {
  const value = isRecord(input);
  const initial = isRecord(value?.initial);
  const repair = isRecord(value?.repair);
  const retry = isRecord(value?.retry);
  const nestedCompleteness = isRecord(value?.nestedCompleteness);
  const calls = nonnegativeInteger(initial?.calls);
  const schemaValid = nonnegativeInteger(initial?.schemaValid);
  const schemaInvalid = nonnegativeInteger(initial?.schemaInvalid);
  const triggered = nonnegativeInteger(retry?.triggered);
  const complete = nonnegativeInteger(nestedCompleteness?.complete);
  const total = nonnegativeInteger(nestedCompleteness?.total);
  const repairCount = nonnegativeInteger(repair?.count);
  const repairReasons = stringArray(repair?.reasons);
  if (
    calls === undefined ||
    schemaValid === undefined ||
    schemaInvalid === undefined ||
    repair?.status !== 'observed' ||
    repairCount === undefined ||
    repairReasons === undefined ||
    triggered === undefined ||
    complete === undefined ||
    total === undefined
  ) {
    return undefined;
  }
  return {
    initial: { calls, schemaValid, schemaInvalid },
    repair: { status: 'observed' as const, count: repairCount, reasons: repairReasons },
    retry: { triggered },
    nestedCompleteness: { complete, total },
  };
}

function projectProductMetrics(eventType: string, input: unknown) {
  if (eventType !== 'first_usable_draft_observed') return undefined;
  const value = isRecord(input);
  const path = value?.path;
  const userActivationCount = nonnegativeInteger(value?.userActivationCount);
  const timeToFirstUsableDraftMs = nonnegativeInteger(
    value?.timeToFirstUsableDraftMs,
  );
  if (
    (path !== 'canonical_mouse' &&
      path !== 'keyboard' &&
      path !== 'conflict') ||
    userActivationCount === undefined ||
    timeToFirstUsableDraftMs === undefined
  ) {
    return undefined;
  }
  return { path, timeToFirstUsableDraftMs, userActivationCount };
}

function projectPromptReference(input: unknown) {
  const value = isRecord(input);
  if (!value) return undefined;
  const source =
    value.source === 'langfuse' || value.source === 'builtin'
      ? value.source
      : undefined;
  if (
    typeof value.name !== 'string' ||
    typeof value.version !== 'string' ||
    typeof value.contentHash !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.isFallback !== 'boolean' ||
    !source
  ) {
    return undefined;
  }
  return compact({
    name: value.name,
    version: value.version,
    contentHash: value.contentHash,
    label: value.label,
    source,
    isFallback: value.isFallback,
    fallbackReason: stringValue(value.fallbackReason),
  });
}

function projectDecisionTrace(stage: string, input: unknown) {
  const value = isRecord(input);
  if (!value) return undefined;
  switch (stage) {
    case 'execution_selection':
      return compact({
        winnerCandidateId: stringValue(value.winnerCandidateId),
        candidateScores: Array.isArray(value.candidateScores)
          ? value.candidateScores.flatMap((candidate) => {
              const item = isRecord(candidate);
              if (!item) return [];
              return [
                compact({
                  candidateId: stringValue(item.candidateId),
                  score: numberValue(item.score),
                  dimensions: numberRecord(item.dimensions),
                  reasonCode:
                    typeof item.reason === 'string'
                      ? LANGFUSE_SCORE_REASON_CODE
                      : undefined,
                }),
              ];
            })
          : [],
        blockedCandidates: Array.isArray(value.blockedCandidates)
          ? value.blockedCandidates.flatMap((candidate) => {
              const item = isRecord(candidate);
              if (!item) return [];
              return [
                compact({
                  candidateId: stringValue(item.candidateId),
                  gateIds: stringArray(item.gateIds),
                }),
              ];
            })
          : [],
        rubricVersion: stringValue(value.rubricVersion),
        rubricHash: stringValue(value.rubricHash),
      });
    case 'assembly_delivery': {
      const recommendation = isRecord(value.recommendation);
      const chips = isRecord(recommendation?.decisionTrace);
      return compact({
        recommendedCandidateId: stringValue(
          recommendation?.recommendedCandidateId,
        ),
        chips: chips
          ? compact({
              whyPost: stringValue(chips.whyPost),
              expressionIdentity: stringValue(chips.expressionIdentity),
              factReferences: stringArray(chips.factReferences),
              platforms: stringArray(chips.platforms),
              customerAction: stringValue(chips.customerAction),
              complianceStatus: stringValue(chips.complianceStatus),
              deliverables: stringArray(chips.deliverables),
            })
          : undefined,
      });
    }
    default:
      return undefined;
  }
}

function projectStageOutput(stage: string, traceInput: unknown, auditInput: unknown) {
  const trace = isRecord(traceInput);
  const audit = isRecord(auditInput);
  const projectedDecision = projectDecisionTrace(stage, traceInput);
  if (projectedDecision) return projectedDecision;
  switch (stage) {
    case 'intent_naming':
      return compact({
        declaration: projectDeclaration(trace?.declaration),
        questionId: stringValue(trace?.questionId),
      });
    case 'context_injection':
      return compact({
        bundleId: stringValue(trace?.bundleId),
        revision: numberValue(trace?.revision),
        hash: stringValue(trace?.hash),
        sourceRevisions: numberRecord(trace?.sourceRevisions),
      });
    case 'brief_compilation':
      return compact({
        kind: stringValue(trace?.kind),
        platform: stringValue(trace?.platform),
        factReferenceCount: arrayLength(trace?.factRefs),
        assetReferenceCount: arrayLength(trace?.assetRefs),
        identityReferenceCount: arrayLength(trace?.identityRefs),
      });
    default:
      return compact({
        traceId: stringValue(audit?.traceId),
        code: stringValue(audit?.code),
        status: numberValue(audit?.status),
        packageId: stringValue(audit?.packageId),
        versionId: stringValue(audit?.versionId),
        revision: numberValue(audit?.revision),
      });
  }
}

function projectDeclaration(input: unknown) {
  const value = isRecord(input);
  if (!value) return undefined;
  return compact({
    taskType: stringValue(value.taskType),
    deliveryLayer: stringValue(value.deliveryLayer),
    implicitConstraints: stringArray(value.implicitConstraints),
  });
}

function ingestionEvent(
  item: HarnessLangfuseOutboxItem,
  discriminator: string,
  type: IngestionEvent['type'],
  body: Record<string, unknown>,
): IngestionEvent {
  return exactFields(LANGFUSE_INGESTION_EVENT_FIELDS, {
    id: stableUuid(`event:${item.auditId}:${discriminator}`),
    timestamp: item.occurredAt,
    type,
    body,
  }) as IngestionEvent;
}

function exactFields<const Fields extends readonly string[]>(
  fields: Fields,
  input: Record<Fields[number], unknown>,
) {
  return Object.fromEntries(
    fields.map((field) => [field, input[field as Fields[number]]]),
  );
}

function stableUuid(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function numberRecord(value: unknown) {
  const record = isRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : undefined;
}

function isRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeLabel(value: string) {
  return value.replaceAll(/[^a-z0-9_-]/giu, '-').slice(0, 80) || 'unknown';
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('LANGFUSE_REQUEST_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}
