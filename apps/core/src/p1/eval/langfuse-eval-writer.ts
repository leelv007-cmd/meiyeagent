/**
 * Eval → Langfuse write path (V31-23 / §30.2).
 * Data write only — no view UI.
 *
 * Production path: enqueue into harness Langfuse outbox (audit_events +
 * langfuse_outbox). Delivery is the existing outbox worker + langfuse-sender;
 * enqueue success transfers delivery responsibility (no credentials → backlog,
 * same as other harness audits).
 */

import type { EvalLayerResult } from '@meiye/contracts';

import type { HarnessAuditEvent } from '../harness/postgres-store.js';
import { assertNoEvalTraceLeaks } from './trace-fields.js';

export const EVAL_LAYER_OUTBOX_STAGE = 'eval_layer' as const;
export const EVAL_LAYER_RESULT_EVENT_TYPE = 'eval_layer.result' as const;
/** Platform workspace id for release-bound eval audits (not merchant-scoped). */
export const EVAL_LAYER_OUTBOX_WORKSPACE_ID = '__platform_eval__' as const;

export type LangfuseEvalScoreEvent = {
  id: string;
  type: 'score-create';
  body: {
    id: string;
    name: string;
    value: number;
    comment: string;
    metadata: Record<string, unknown>;
  };
};

export type LangfuseEvalTraceTag = `releaseId:${string}`;

export type EvalLayerOutboxScore = {
  name: string;
  value: number;
  comment: string;
  metadata: Record<string, unknown>;
};

/** Payload shape stored on harness audit / claimed by langfuse-sender. */
export type EvalLayerOutboxPayload = {
  kind: typeof EVAL_LAYER_RESULT_EVENT_TYPE;
  harnessReleaseId: string;
  resultId: string;
  layer: EvalLayerResult['layer'];
  evalSuiteRevision: string;
  datasetRevision: string | null;
  verdict: EvalLayerResult['verdict'];
  scoredBookkept: boolean;
  releasable: boolean;
  sampleTraceId: string | null;
  tags: LangfuseEvalTraceTag[];
  scores: EvalLayerOutboxScore[];
};

/** Map three-state verdict to a stable numeric score for Langfuse dashboards. */
export function verdictToLangfuseValue(
  verdict: EvalLayerResult['verdict'],
): number {
  switch (verdict) {
    case 'passed':
      return 1;
    case 'scored':
      return 0.5;
    case 'failed':
      return 0;
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

/**
 * Project an EvalLayerResult into Langfuse ingestion-shaped score events.
 * Never includes API keys, raw CoT, or upstream USD costs.
 */
export function projectEvalResultToLangfuseScores(
  result: EvalLayerResult,
): {
  tags: LangfuseEvalTraceTag[];
  events: LangfuseEvalScoreEvent[];
} {
  const tags: LangfuseEvalTraceTag[] = [
    `releaseId:${result.harnessReleaseId}`,
  ];
  const metadata = {
    resultId: result.resultId,
    layer: result.layer,
    harnessReleaseId: result.harnessReleaseId,
    evalSuiteRevision: result.evalSuiteRevision,
    datasetRevision: result.datasetRevision ?? null,
    verdict: result.verdict,
    scoredBookkept: result.scoredBookkept,
    releasable: result.releasable,
    sampleTraceId: result.sampleTraceId ?? null,
  };
  assertNoEvalTraceLeaks(metadata);

  const events: LangfuseEvalScoreEvent[] = [
    {
      id: `eval-verdict:${result.resultId}`,
      type: 'score-create',
      body: {
        id: `eval-verdict:${result.resultId}`,
        name: 'eval.layer.verdict',
        value: verdictToLangfuseValue(result.verdict),
        comment: `verdict=${result.verdict}`,
        metadata,
      },
    },
  ];

  for (const gate of result.gates) {
    events.push({
      id: `eval-gate:${result.resultId}:${gate.id}`,
      type: 'score-create',
      body: {
        id: `eval-gate:${result.resultId}:${gate.id}`,
        name: `eval.gate.${gate.kind}`,
        value: gate.passed ? 1 : 0,
        comment: gate.reason ?? `gate=${gate.id}`,
        metadata: {
          resultId: result.resultId,
          harnessReleaseId: result.harnessReleaseId,
          gateId: gate.id,
          kind: gate.kind,
        },
      },
    });
  }

  assertNoEvalTraceLeaks(events);
  return { tags, events };
}

/** Build the audit/outbox payload consumed by langfuse-sender projection. */
export function buildEvalLayerOutboxPayload(
  result: EvalLayerResult,
  projected: ReturnType<typeof projectEvalResultToLangfuseScores> = projectEvalResultToLangfuseScores(
    result,
  ),
): EvalLayerOutboxPayload {
  const payload: EvalLayerOutboxPayload = {
    kind: EVAL_LAYER_RESULT_EVENT_TYPE,
    harnessReleaseId: result.harnessReleaseId,
    resultId: result.resultId,
    layer: result.layer,
    evalSuiteRevision: result.evalSuiteRevision,
    datasetRevision: result.datasetRevision ?? null,
    verdict: result.verdict,
    scoredBookkept: result.scoredBookkept,
    releasable: result.releasable,
    sampleTraceId: result.sampleTraceId ?? null,
    tags: projected.tags,
    scores: projected.events.map((event) => ({
      name: event.body.name,
      value: event.body.value,
      comment: event.body.comment,
      metadata: event.body.metadata,
    })),
  };
  assertNoEvalTraceLeaks(payload);
  return payload;
}

export type LangfuseEvalWriter = {
  writeEvalResult(result: EvalLayerResult): Promise<{ eventCount: number }>;
};

/**
 * Port onto harness audit → langfuse_outbox enqueue.
 * Production adapter: PostgresHarnessAuditStore.appendEvalLayerAudit.
 */
export type EvalLangfuseOutboxEnqueuePort = {
  enqueueEvalLayerAudit(
    event: Pick<
      HarnessAuditEvent,
      'workspaceId' | 'id' | 'workflowId' | 'stage' | 'eventType' | 'payload'
    >,
  ): Promise<void>;
};

export class MemoryEvalLangfuseOutboxEnqueue
  implements EvalLangfuseOutboxEnqueuePort
{
  readonly events: Array<
    Pick<
      HarnessAuditEvent,
      'workspaceId' | 'id' | 'workflowId' | 'stage' | 'eventType' | 'payload'
    >
  > = [];

  async enqueueEvalLayerAudit(
    event: Pick<
      HarnessAuditEvent,
      'workspaceId' | 'id' | 'workflowId' | 'stage' | 'eventType' | 'payload'
    >,
  ): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

/**
 * Production writer: project scores → D-061 check → enqueue outbox.
 * Does not call Langfuse HTTP; worker + sender own delivery.
 */
export class OutboxLangfuseEvalWriter implements LangfuseEvalWriter {
  constructor(
    private readonly outbox: EvalLangfuseOutboxEnqueuePort,
    private readonly options: { workspaceId?: string } = {},
  ) {}

  async writeEvalResult(
    result: EvalLayerResult,
  ): Promise<{ eventCount: number }> {
    const projected = projectEvalResultToLangfuseScores(result);
    const payload = buildEvalLayerOutboxPayload(result, projected);
    assertNoEvalTraceLeaks(payload);

    await this.outbox.enqueueEvalLayerAudit({
      workspaceId: this.options.workspaceId ?? EVAL_LAYER_OUTBOX_WORKSPACE_ID,
      id: `eval-layer:${result.resultId}`,
      workflowId: `eval:${result.harnessReleaseId}:${result.resultId}`,
      stage: EVAL_LAYER_OUTBOX_STAGE,
      eventType: EVAL_LAYER_RESULT_EVENT_TYPE,
      payload,
    });

    return { eventCount: projected.events.length };
  }
}

/** Wire PostgresHarnessAuditStore (or any store with appendEvalLayerAudit). */
export function evalLangfuseOutboxFromAuditStore(store: {
  appendEvalLayerAudit(event: HarnessAuditEvent): Promise<void>;
}): EvalLangfuseOutboxEnqueuePort {
  return {
    async enqueueEvalLayerAudit(event) {
      await store.appendEvalLayerAudit({
        workspaceId: event.workspaceId,
        id: event.id,
        workflowId: event.workflowId,
        stage: event.stage,
        eventType: event.eventType,
        payload: event.payload,
      });
    },
  };
}

/**
 * In-memory / test-only writer. Production assembly must not default to this.
 */
export class RecordingLangfuseEvalWriter implements LangfuseEvalWriter {
  readonly written: Array<{
    tags: LangfuseEvalTraceTag[];
    events: LangfuseEvalScoreEvent[];
  }> = [];

  async writeEvalResult(
    result: EvalLayerResult,
  ): Promise<{ eventCount: number }> {
    const projected = projectEvalResultToLangfuseScores(result);
    this.written.push(projected);
    return { eventCount: projected.events.length };
  }
}
