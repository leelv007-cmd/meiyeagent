/**
 * Five-stage demotion to trace taxonomy (V31-25 / V3.1 §22.3 / D-036).
 *
 * Physical stage names remain for durable topology compatibility.
 * New-task control flow is CompiledExecutionPlan → single executor;
 * five stages are only:
 *   - trace grouping
 *   - admin explanation
 *   - metrics dimension
 *   - historical compatibility
 *
 * Six-primitive mount (V3.1 §22.4 step 2):
 *   intent  → read_context / ask_merchant
 *   brief   → generate
 *   execution → generate / check / revise
 */

import type { HarnessStage } from '@meiye/contracts';

export type SixPrimitiveId =
  | 'read_context'
  | 'generate'
  | 'revise'
  | 'record'
  | 'check'
  | 'ask_merchant';

/** D-036: five stages = five semantic spans for observability only. */
export const FIVE_STAGE_TRACE_ROLE = 'trace_taxonomy' as const;

export const STAGE_TO_PRIMITIVES: Readonly<
  Record<HarnessStage, readonly SixPrimitiveId[]>
> = Object.freeze({
  intent_naming: Object.freeze(['read_context', 'ask_merchant'] as const),
  context_injection: Object.freeze(['read_context'] as const),
  brief_compilation: Object.freeze(['generate'] as const),
  execution_selection: Object.freeze([
    'generate',
    'check',
    'revise',
  ] as const),
  assembly_delivery: Object.freeze(['record', 'check'] as const),
});

export type StageTaxonomyPayload = {
  stageRole: typeof FIVE_STAGE_TRACE_ROLE;
  metricsDimension: HarnessStage;
  adminExplanation: string;
  primitives: readonly SixPrimitiveId[];
  /** Executor path tag for ops / shadow reconciliation. */
  executorPath: 'compiled_plan_executor' | 'legacy_five_stage_runner';
};

const ADMIN_EXPLANATION: Readonly<Record<HarnessStage, string>> = Object.freeze(
  {
    intent_naming:
      'Intent span: read frozen facts / ask merchant when gaps block (taxonomy only).',
    context_injection:
      'Context span: inject & fence confirmed materials (taxonomy only).',
    brief_compilation:
      'Brief span: generate or materialize execution brief (taxonomy only).',
    execution_selection:
      'Execution span: generate / check / revise candidates (taxonomy only).',
    assembly_delivery:
      'Assembly span: record delivery & final checks (taxonomy only).',
  },
);

export function stageTaxonomyPayload(
  stage: HarnessStage,
  options: {
    executorPath?: StageTaxonomyPayload['executorPath'];
  } = {},
): StageTaxonomyPayload {
  return {
    stageRole: FIVE_STAGE_TRACE_ROLE,
    metricsDimension: stage,
    adminExplanation: ADMIN_EXPLANATION[stage],
    primitives: STAGE_TO_PRIMITIVES[stage],
    executorPath: options.executorPath ?? 'compiled_plan_executor',
  };
}

/**
 * Merge taxonomy into a stage trace payload without clobbering existing keys.
 * Non-object payloads are wrapped.
 */
export function attachStageTaxonomy(
  stage: HarnessStage,
  payload: unknown,
  options: {
    executorPath?: StageTaxonomyPayload['executorPath'];
  } = {},
): Record<string, unknown> {
  const taxonomy = stageTaxonomyPayload(stage, options);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    // Do not overwrite explicit taxonomy if a caller already set it.
    return {
      ...taxonomy,
      ...record,
      stageRole: record.stageRole ?? taxonomy.stageRole,
      metricsDimension: record.metricsDimension ?? taxonomy.metricsDimension,
      primitives: record.primitives ?? taxonomy.primitives,
      executorPath: record.executorPath ?? taxonomy.executorPath,
      adminExplanation: record.adminExplanation ?? taxonomy.adminExplanation,
    };
  }
  return {
    ...taxonomy,
    value: payload,
  };
}
