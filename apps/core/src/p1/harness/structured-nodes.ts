import {
  contextBundleSchema,
  imageIntentSchema,
  questionCardSchema,
  taskIntentInputSchema,
  type ContextBundle,
  type QuestionCard,
  type TaskIntentInput,
} from '@meiye/contracts';
import { z } from 'zod';
import {
  HARNESS_BUILTIN_PROMPTS,
  type HarnessFrozenPrompt,
} from './langfuse-prompts.js';
import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  materializeSkillInstructions,
} from '../skills/stage-injection.js';
import type { ResolvedSkillInstruction } from '../skills/types.js';

export type { StructuredNodeRunner } from '../model-supply/structured-node-runner.js';
import {
  StructuredNodeRunError,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest as ModelSupplyStructuredNodeRunnerRequest,
  type StructuredNodeRunnerResult as ModelSupplyStructuredNodeRunnerResult,
} from '../model-supply/structured-node-runner.js';
import { merchantConfirmationQuestion } from './merchant-delivery-language.js';

export interface StructuredNodeRepairEvent {
  reason: string;
}

export interface StructuredNodeRepairObservation {
  count: number;
  reasons: readonly string[];
}

/** Optional repair callback/result fields keep old StructuredNodeRunner implementations valid. */
export type StructuredNodeRunnerRequest<Output> =
  ModelSupplyStructuredNodeRunnerRequest<Output> & {
    onRepair?: (event: StructuredNodeRepairEvent) => void;
  };

export type StructuredNodeRunnerResult<Output> =
  ModelSupplyStructuredNodeRunnerResult<Output> & {
    repair?: StructuredNodeRepairObservation;
  };
/*
 * Only model/schema failures may enter the deterministic guidance fallback.
 * Authorization and source-fence errors must keep failing closed.
 */
function isIntentModelFailure(error: unknown) {
  return error instanceof z.ZodError || error instanceof StructuredNodeRunError;
}

export const HARNESS_TASK_TYPES = [
  'daily_service_exposure',
  'traffic_opportunity',
  'brand_personal_ip',
  'promotion_groupbuy_conversion',
  'routine_marketing_materials',
] as const;

export const harnessTaskTypeSchema = z.enum(HARNESS_TASK_TYPES);
export const deliveryLayerSchema = z.enum(['copy', 'finished_media']);
export const intentRouteSchema = z.enum([
  'customized',
  'guidance',
  'free',
]);

export const OPERATING_ASSET_CATEGORIES = [
  'store',
  'product_service',
  'promotion_activity',
  'brand',
  'personal_ip',
  'material',
  'history_preference',
  'industry_category',
] as const;

export const operatingAssetCategorySchema = z.enum(
  OPERATING_ASSET_CATEGORIES,
);

const blockingGapSchema = z
  .object({
    field: z.string().trim().min(1),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).max(12),
    allowFreeText: z.boolean(),
    scope: z.enum(['current_task', 'current_series', 'workspace']),
  })
  .strict();

export const intentNamingOutputSchema = z
  .object({
    normalizedIntent: z.string().trim().min(1).max(4_000),
    taskType: harnessTaskTypeSchema,
    deliveryLayer: deliveryLayerSchema,
    relevantAssetCategories: z
      .array(operatingAssetCategorySchema)
      .max(OPERATING_ASSET_CATEGORIES.length),
    usedAssetCategories: z
      .array(operatingAssetCategorySchema)
      .max(OPERATING_ASSET_CATEGORIES.length),
    route: z.enum(['customized', 'guidance']),
    implicitConstraints: z.array(z.string().trim().min(1)).max(30),
    blockingGap: blockingGapSchema.nullable(),
  })
  .strict()
  .superRefine((output, context) => {
    const relevant = new Set(output.relevantAssetCategories);
    if (
      output.usedAssetCategories.some((category) => !relevant.has(category))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Used asset categories must also be relevant.',
        path: ['usedAssetCategories'],
      });
    }
    if (output.route === 'customized') {
      if (output.usedAssetCategories.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Customized routing requires at least one useful category.',
          path: ['usedAssetCategories'],
        });
      }
      if (output.blockingGap !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Customized routing cannot carry a guidance question.',
          path: ['blockingGap'],
        });
      }
    }
    if (output.route === 'guidance' && output.blockingGap === null) {
      context.addIssue({
        code: 'custom',
        message: 'Guidance routing requires one focused question.',
        path: ['blockingGap'],
      });
    }
  });

export type IntentDeclaration = Omit<
  z.infer<typeof intentNamingOutputSchema>,
  'blockingGap' | 'route'
> & {
  route: z.infer<typeof intentRouteSchema>;
  // `policy` records a server-side routing rule, without claiming that the
  // merchant submitted a decision.
  routingSource: 'entry' | 'model' | 'fallback' | 'decision' | 'policy';
};

export const briefContextBundleSchema = contextBundleSchema;

export type BriefContextBundle = ContextBundle;

const copyBriefSchema = z
  .object({
    kind: z.literal('copy'),
    instructions: z.string().trim().min(80),
    platform: z.enum([
      'xiaohongshu',
      'douyin',
      'video_account',
      'wechat_moments',
      'offline',
    ]),
    cta: z.string().trim().min(1),
    factRefs: z.array(z.string().trim().min(1)),
    assetRefs: z.array(z.string().trim().min(1)),
    identityRefs: z.array(z.string().trim().min(1)),
    constraints: z.array(z.string().trim().min(1)),
  })
  .strict();

const imageBriefSchema = z
  .object({
    kind: z.literal('image'),
    intent: imageIntentSchema,
    prompt: z.string().trim().min(20),
    referenceAssetIds: z.array(z.string().trim().min(1)),
    parameters: z
      .object({
        ratio: z.string().trim().min(1),
        resolution: z.string().trim().min(1),
      })
      .strict(),
    constraints: z.array(z.string().trim().min(1)),
  })
  .strict();

const videoBriefSchema = z
  .object({
    kind: z.literal('video'),
    storyboard: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            description: z.string().trim().min(1),
            narration: z.string().trim().min(1).optional(),
            durationSeconds: z.number().positive(),
          })
          .strict()
      )
      .min(1),
    firstFramePrompt: z.string().trim().min(20),
    referenceAssetIds: z.array(z.string().trim().min(1)),
    parameters: z
      .object({
        durationSeconds: z.number().positive(),
        ratio: z.string().trim().min(1),
      })
      .strict(),
    constraints: z.array(z.string().trim().min(1)),
  })
  .strict();

export const executionBriefSchema = z.discriminatedUnion('kind', [
  copyBriefSchema,
  imageBriefSchema,
  videoBriefSchema,
]);

export type ExecutionBrief = z.infer<typeof executionBriefSchema>;
export type ExecutionUnitKind = ExecutionBrief['kind'];

export interface StructuredNodeMetricsSnapshot {
  /** Initial means the first schema-validation event for one node effect. */
  initial: { calls: number; schemaValid: number; schemaInvalid: number };
  /** Repair is observed only from a runner result or an invoked runner callback. */
  repair: {
    status: 'observed';
    count: number;
    reasons: string[];
  };
  /** Retry counts additional provider attempts reported by the model-supply chain. */
  retry: { triggered: number };
  nestedCompleteness: { complete: number; total: number };
}

export interface StructuredNodeMetrics {
  record(input: {
    schemaValid: boolean;
    attempts: number;
    complete: number;
    total: number;
    repair?: StructuredNodeRepairObservation;
  }): void;
}

export class InMemoryStructuredNodeMetrics implements StructuredNodeMetrics {
  private calls = 0;
  private valid = 0;
  private invalid = 0;
  private retries = 0;
  private repairs = 0;
  private repairReasons: string[] = [];
  private complete = 0;
  private total = 0;

  record(input: {
    schemaValid: boolean;
    attempts: number;
    complete: number;
    total: number;
    repair?: StructuredNodeRepairObservation;
  }) {
    this.calls += 1;
    this.valid += input.schemaValid ? 1 : 0;
    this.invalid += input.schemaValid ? 0 : 1;
    this.retries += Math.max(0, input.attempts - 1);
    this.repairs += input.repair?.count ?? 0;
    this.repairReasons.push(...(input.repair?.reasons ?? []));
    this.complete += input.complete;
    this.total += input.total;
  }

  snapshot(): StructuredNodeMetricsSnapshot {
    return {
      initial: {
        calls: this.calls,
        schemaValid: this.valid,
        schemaInvalid: this.invalid,
      },
      repair: {
        status: 'observed',
        count: this.repairs,
        reasons: [...this.repairReasons],
      },
      retry: { triggered: this.retries },
      nestedCompleteness: { complete: this.complete, total: this.total },
    };
  }
}

export async function nameHarnessIntent(
  input: {
    workflowId: string;
    workflowRevision: number;
    creationMode?: 'customized' | 'free';
    deliveryLayer?: 'copy' | 'finished_media';
    intent: TaskIntentInput;
    round?: number;
    prompt?: HarnessFrozenPrompt;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  },
  runner: StructuredNodeRunner,
  metrics?: StructuredNodeMetrics
) {
  const parsedIntent = taskIntentInputSchema.parse(input.intent);
  if (input.creationMode === 'free') {
    return {
      declaration: {
        normalizedIntent: parsedIntent.context.intent,
        taskType: fallbackTaskType(parsedIntent.context.intent),
        deliveryLayer: input.deliveryLayer ?? ('copy' as const),
        relevantAssetCategories: [],
        usedAssetCategories: [],
        route: 'free' as const,
        routingSource: 'entry' as const,
        implicitConstraints: [],
      },
      blockingQuestion: null,
      fallbackUsed: false,
    };
  }
  const request = {
    effectIdempotencyKey: `wf:${input.workflowId}:s1:intent:${input.round ?? 0}`,
    schemaName: 'harness_intent_naming_v1',
    schemaRevision: 'intent-naming-v1',
    instructions: materializeSkillInstructions(
      input.prompt?.content ?? HARNESS_BUILTIN_PROMPTS.intentNaming,
      input.skillInstructions,
    ),
    prompt: canonicalJson(parsedIntent),
    schema: intentNamingOutputSchema,
  };
  let result: StructuredNodeRunnerResult<
    z.infer<typeof intentNamingOutputSchema>
  >;
  let fallbackUsed = false;
  try {
    result = await runMeasured(
      request,
      runner,
      metrics,
      intentCompletenessShape
    );
  } catch (error) {
    if (!isIntentModelFailure(error)) throw error;
    fallbackUsed = true;
    result = {
      output: fallbackIntentOutput(parsedIntent),
      attempts: 1,
      providerTaskRef: 'deterministic-guidance-fallback',
      replayed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  const { blockingGap, ...declaration } = result.output;
  return {
    declaration: {
      ...declaration,
      ...(input.deliveryLayer
        ? { deliveryLayer: input.deliveryLayer }
        : {}),
      routingSource: fallbackUsed ? ('fallback' as const) : ('model' as const),
    },
    blockingQuestion: blockingGap
      ? toQuestionCard(input.workflowId, input.workflowRevision, blockingGap)
      : null,
    fallbackUsed,
  };
}

const CONSERVATIVE_COPY_PLATFORMS = new Set([
  'xiaohongshu',
  'douyin',
  'video_account',
  'wechat_moments',
  'offline',
]);

/**
 * ③段的确定性保守兜底 (D-122). When brief compilation cannot produce a brief,
 * the merchant should still get something usable rather than an error — so the
 * run continues on a brief that claims nothing: no fact references, no assets,
 * no identity, and constraints that forbid inventing any of them.
 *
 * Copy only, on purpose. An image or video brief carries an execution contract
 * (exact text, storyboard, reference assets) that cannot be invented safely;
 * a fabricated one would be a worse lie than an honest failure, and since W03
 * that failure now reaches the merchant as a 申报卡 with a way forward.
 */
export function conservativeCopyBrief(input: {
  declaration: IntentDeclaration;
  executionSnapshot?: CreationExecutionSnapshot;
}): Extract<ExecutionBrief, { kind: 'copy' }> {
  const platform = input.executionSnapshot?.platform.id;
  return copyBriefSchema.parse({
    kind: 'copy',
    instructions:
      `围绕「${input.declaration.normalizedIntent}」写一条可以直接审核的门店内容。` +
      '先说清这次服务对顾客的价值和适用场景，再给出到店或咨询的方式；' +
      '只写输入里可以核对的内容，不写价格、效果、资质或顾客案例，' +
      '也不要引用没有授权的素材。',
    platform:
      platform && CONSERVATIVE_COPY_PLATFORMS.has(platform)
        ? platform
        : 'xiaohongshu',
    cta: '私信了解详情并预约',
    factRefs: [],
    assetRefs: [],
    identityRefs: [],
    constraints: ['不得编造价格、效果、资质或顾客案例', '只使用已确认的本店事实'],
  });
}

export async function compileExecutionBrief(
  input: {
    workflowId: string;
    unitId: string;
    unitKind: ExecutionUnitKind;
    declaration: IntentDeclaration;
    bundle: z.infer<typeof briefContextBundleSchema>;
    allowedFactRefs?: readonly string[];
    executionSnapshot?: CreationExecutionSnapshot;
    prompt?: HarnessFrozenPrompt;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  },
  runner: StructuredNodeRunner,
  metrics?: StructuredNodeMetrics,
  /** Called instead of throwing when a copy brief falls back (D-122). */
  onConservativeFallback?: (input: {
    unitKind: 'copy';
    reason: 'structured_brief_unavailable';
  }) => void
): Promise<ExecutionBrief> {
  if (input.unitKind === 'copy' && onConservativeFallback) {
    try {
      return await runExecutionBriefCompilation(input, runner, metrics);
    } catch (error) {
      // Same rule as ①段 (isIntentModelFailure): only a model failure degrades.
      // Authorization, source-fence and revocation errors must reach the caller
      // — continuing past those on a conservative brief would be the hard gate
      // quietly turning into a soft one.
      if (!isIntentModelFailure(error)) throw error;
      onConservativeFallback({
        unitKind: 'copy',
        reason: 'structured_brief_unavailable',
      });
      return conservativeCopyBrief(input);
    }
  }
  return runExecutionBriefCompilation(input, runner, metrics);
}

async function runExecutionBriefCompilation(
  input: {
    workflowId: string;
    unitId: string;
    unitKind: ExecutionUnitKind;
    declaration: IntentDeclaration;
    bundle: z.infer<typeof briefContextBundleSchema>;
    allowedFactRefs?: readonly string[];
    executionSnapshot?: CreationExecutionSnapshot;
    prompt?: HarnessFrozenPrompt;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    onConservativeFallback?: (input: {
      unitKind: 'copy';
      reason: 'structured_brief_unavailable';
    }) => void;
  },
  runner: StructuredNodeRunner,
  metrics?: StructuredNodeMetrics
): Promise<ExecutionBrief> {
  const bundle = briefBundleWithAuthorizedFacts(
    briefContextBundleSchema.parse(input.bundle),
    input.allowedFactRefs,
  );
  const result = await runMeasured<ExecutionBrief>(
    {
      effectIdempotencyKey: `wf:${input.workflowId}:s3:${input.unitId}:0`,
      schemaName: `harness_${input.unitKind}_brief_v1`,
      schemaRevision: `${input.unitKind}-brief-v1`,
      instructions: materializeSkillInstructions(
        input.prompt?.content ?? briefInstructions[input.unitKind],
        input.skillInstructions,
      ),
      prompt: canonicalJson({
        unitId: input.unitId,
        unitKind: input.unitKind,
        declaration: input.declaration,
        bundle,
        ...(input.executionSnapshot
          ? {
              executionContract: briefExecutionContract(
                input.executionSnapshot,
              ),
            }
          : {}),
      }),
      schema: executionBriefSchema,
    },
    runner,
    metrics,
    briefCompletenessShapes[input.unitKind],
  );
  const brief = briefSchemaByKind[input.unitKind].parse(
    result.output,
  ) as ExecutionBrief;
  if (
    brief.kind === 'copy' &&
    input.allowedFactRefs &&
    brief.factRefs.some(
      (reference) => !input.allowedFactRefs?.includes(reference),
    )
  ) {
    throw new Error(
      'The copy brief referenced a fact outside the authorized satisfaction result.',
    );
  }
  return brief;
}

function briefBundleWithAuthorizedFacts(
  bundle: BriefContextBundle,
  allowedFactRefs: readonly string[] | undefined,
): BriefContextBundle {
  const allowed = allowedFactRefs ? new Set(allowedFactRefs) : undefined;
  const storeFactsAssets = Object.fromEntries(
    Object.entries(bundle.dimensions.store_facts_assets).filter(
      ([, contribution]) =>
        contribution.factSnapshot === undefined ||
        (contribution.layer === 'current_fact' &&
          (allowed === undefined || allowed.has(contribution.sourceRef))),
    ),
  );
  const retainedFactIds = new Set(
    Object.values(storeFactsAssets)
      .map((contribution) => contribution.factSnapshot?.factId)
      .filter((factId): factId is string => factId !== undefined),
  );
  return {
    ...bundle,
    referencedFactRevisions: bundle.referencedFactRevisions.filter(
      ({ factId }) => retainedFactIds.has(factId),
    ),
    dimensions: {
      ...bundle.dimensions,
      store_facts_assets: storeFactsAssets,
    },
  };
}

function briefExecutionContract(snapshot: CreationExecutionSnapshot) {
  return {
    briefConfirmation: snapshot.briefConfirmation,
    briefContext: snapshot.briefContext,
    catalogModel: snapshot.catalogModel,
    contentModules: snapshot.contentModules,
    deliverables: snapshot.deliverables,
    identity: snapshot.identity,
    identityDecision: snapshot.identityDecision,
    lens: snapshot.lens,
    modelPolicy: snapshot.modelPolicy,
    operation: snapshot.operation,
    platform: snapshot.platform,
    quote: snapshot.quote,
    route: snapshot.route,
    sources: snapshot.sources,
  };
}

const briefSchemaByKind = {
  copy: copyBriefSchema,
  image: imageBriefSchema,
  video: videoBriefSchema,
} as const;

const briefInstructions = {
  copy: HARNESS_BUILTIN_PROMPTS.briefCompilation,
  image:
    'Compile a complete image execution brief with a production-ready prompt, authorized reference asset IDs, explicit ratio and resolution, and safety constraints.',
  video:
    'Compile a complete video execution brief with ordered shots, timing, narration where needed, first-frame prompt, authorized references, parameters, and safety constraints.',
} as const;

type CompletenessShape = Record<string, CompletenessRule>;

interface CompletenessRule {
  /** Optional/nullable branches are excluded when absent and counted when present. */
  optional?: boolean;
  fields?: CompletenessShape;
  each?: CompletenessShape;
  minimumItems?: number;
}

const intentCompletenessShape = {
  normalizedIntent: {},
  taskType: {},
  deliveryLayer: {},
  relevantAssetCategories: {},
  usedAssetCategories: {},
  route: {},
  implicitConstraints: {},
  blockingGap: {
    optional: true,
    fields: {
      field: {},
      question: {},
      options: {},
      allowFreeText: {},
      scope: {},
    },
  },
} satisfies CompletenessShape;

const briefCompletenessShapes = {
  copy: {
    kind: {},
    instructions: {},
    platform: {},
    cta: {},
    factRefs: {},
    assetRefs: {},
    identityRefs: {},
    constraints: {},
  },
  image: {
    kind: {},
    intent: {
      fields: {
        operation: {},
        purpose: {},
        subject: {},
        scene: {},
        composition: {},
        references: {},
        exactText: {},
        changes: {},
        invariants: {},
        factRefs: {},
        rightsRefs: {},
        outputPlan: {},
      },
    },
    prompt: {},
    referenceAssetIds: {},
    parameters: { fields: { ratio: {}, resolution: {} } },
    constraints: {},
  },
  video: {
    kind: {},
    storyboard: {
      each: {
        index: {},
        description: {},
        narration: { optional: true },
        durationSeconds: {},
      },
      minimumItems: 1,
    },
    firstFramePrompt: {},
    referenceAssetIds: {},
    parameters: { fields: { durationSeconds: {}, ratio: {} } },
    constraints: {},
  },
} satisfies Record<ExecutionUnitKind, CompletenessShape>;

async function runMeasured<Output>(
  request: StructuredNodeRunnerRequest<Output>,
  runner: StructuredNodeRunner,
  metrics: StructuredNodeMetrics | undefined,
  completenessShape: CompletenessShape,
): Promise<StructuredNodeRunnerResult<Output>> {
  const callbackRepairs: StructuredNodeRepairEvent[] = [];
  const requestWithRepair: StructuredNodeRunnerRequest<Output> = {
    ...request,
    onRepair: (event) => {
      callbackRepairs.push(normalizeRepairEvent(event));
    },
  };
  try {
    const result = (await runner.run(
      requestWithRepair,
    )) as StructuredNodeRunnerResult<Output>;
    const repair = observedRepair(result.repair, callbackRepairs);
    const completeness = measureCompleteness(
      result.output,
      completenessShape
    );
    metrics?.record({
      schemaValid: true,
      attempts: result.attempts,
      repair,
      ...completeness,
    });
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const { total } = measureCompleteness(undefined, completenessShape);
      metrics?.record({
        schemaValid: false,
        attempts: 1,
        repair: observedRepair(undefined, callbackRepairs),
        complete: 0,
        total,
      });
    }
    throw error;
  }
}

function observedRepair(
  result: StructuredNodeRepairObservation | undefined,
  callbackRepairs: readonly StructuredNodeRepairEvent[],
): StructuredNodeRepairObservation {
  if (result !== undefined && callbackRepairs.length > 0) {
    throw new Error(
      'Structured node repair was reported by both result and callback.',
    );
  }
  if (result !== undefined) return normalizeRepairObservation(result);
  return {
    count: callbackRepairs.length,
    reasons: callbackRepairs.map(({ reason }) => reason),
  };
}

function normalizeRepairObservation(
  input: unknown,
): StructuredNodeRepairObservation {
  if (!isRecord(input) || !Array.isArray(input.reasons)) {
    throw new Error('Invalid structured node repair observation.');
  }
  const count = input.count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 0 ||
    input.reasons.length !== count
  ) {
    throw new Error('Invalid structured node repair observation.');
  }
  return {
    count,
    reasons: input.reasons.map((reason) => normalizeRepairReason(reason)),
  };
}

function normalizeRepairEvent(input: unknown): StructuredNodeRepairEvent {
  if (!isRecord(input) || typeof input.reason !== 'string') {
    throw new Error('Invalid structured node repair event reason.');
  }
  return { reason: normalizeRepairReason(input.reason) };
}

function normalizeRepairReason(reason: string) {
  const normalized = reason.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error('Invalid structured node repair event reason.');
  }
  return normalized;
}

function measureCompleteness(
  value: unknown,
  shape: CompletenessShape
): { complete: number; total: number } {
  const record = isRecord(value) ? value : undefined;
  let complete = 0;
  let total = 0;

  for (const [field, rule] of Object.entries(shape)) {
    const fieldValue = record?.[field];
    if (rule.optional && !isNonEmpty(fieldValue)) continue;

    total += 1;
    complete += isNonEmpty(fieldValue) ? 1 : 0;

    if (rule.fields) {
      const nested = measureCompleteness(fieldValue, rule.fields);
      complete += nested.complete;
      total += nested.total;
    }

    if (rule.each) {
      const items = Array.isArray(fieldValue) ? fieldValue : [];
      const itemCount = Math.max(items.length, rule.minimumItems ?? 0);
      for (let index = 0; index < itemCount; index += 1) {
        const nested = measureCompleteness(items[index], rule.each);
        complete += nested.complete;
        total += nested.total;
      }
    }
  }

  return { complete, total };
}

function isNonEmpty(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toQuestionCard(
  workflowId: string,
  workflowRevision: number,
  gap: z.infer<typeof blockingGapSchema>
): QuestionCard {
  return questionCardSchema.parse({
    questionId: `${workflowId}:s1:${gap.field}`,
    workflowId,
    workflowRevision,
    question: merchantConfirmationQuestion(gap.question),
    options: gap.options.map((label, index) => ({
      id: `option-${index + 1}`,
      label,
    })),
    freeText: { enabled: gap.allowFreeText },
    response: {
      field: gap.field,
      reason: '让这次内容更贴合你的实际情况',
    },
    unattended: 'continue',
    scope: gap.scope,
  });
}

function fallbackIntentOutput(
  intent: TaskIntentInput,
): z.infer<typeof intentNamingOutputSchema> {
  const text = intent.context.intent;
  const gap = fallbackGuidanceGap(text);
  return intentNamingOutputSchema.parse({
    normalizedIntent: text,
    taskType: fallbackTaskType(text),
    deliveryLayer: 'copy',
    relevantAssetCategories: gap.categories,
    usedAssetCategories: [],
    route: 'guidance',
    implicitConstraints: [],
    blockingGap: gap.question,
  });
}

function fallbackTaskType(text: string) {
  if (/团购|优惠|套餐|活动/u.test(text)) {
    return 'promotion_groupbuy_conversion' as const;
  }
  if (/老板|主理人|人设|口吻|个人\s*IP|个人ip/iu.test(text)) {
    return 'brand_personal_ip' as const;
  }
  if (/热点|同城|节日|周末/u.test(text)) {
    return 'traffic_opportunity' as const;
  }
  if (/海报|物料|说明卡/u.test(text)) {
    return 'routine_marketing_materials' as const;
  }
  return 'daily_service_exposure' as const;
}

function fallbackGuidanceGap(text: string) {
  if (/团购|优惠|套餐|活动/u.test(text)) {
    return {
      categories: ['promotion_activity', 'product_service'] as const,
      question: {
        field: 'promotion_details',
        question: '方便补充这次活动的项目和价格档吗？',
        options: [],
        allowFreeText: true,
        scope: 'current_task' as const,
      },
    };
  }
  if (/老板|主理人|人设|口吻|个人\s*IP|个人ip/iu.test(text)) {
    return {
      categories: ['personal_ip'] as const,
      question: {
        field: 'personal_ip_details',
        question: '这次希望由谁来讲，用什么样的口吻？',
        options: [],
        allowFreeText: true,
        scope: 'current_task' as const,
      },
    };
  }
  if (/新品|新项目|上新/u.test(text)) {
    return {
      categories: ['product_service'] as const,
      question: {
        field: 'product_details',
        question: '方便补充新品名称和最想突出的亮点吗？',
        options: [],
        allowFreeText: true,
        scope: 'current_task' as const,
      },
    };
  }
  return {
    categories: ['industry_category'] as const,
    question: {
      field: 'industry_category',
      question: '这次内容主要属于哪一类美业服务？',
      options: ['美发', '美甲', '皮肤管理'],
      allowFreeText: true,
      scope: 'current_task' as const,
    },
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortCanonical(nested)])
    );
  }
  return value;
}
