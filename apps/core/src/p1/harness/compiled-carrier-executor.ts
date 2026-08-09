/**
 * Single CompiledExecutionPlan → executor entry (V31-25 / V3.1 §22.4 step 3).
 *
 * Topology: resolve carrier recipe (or frozen snapshot.executionPlan) → run the
 * registered carrier program. Control flow remains in TypeScript (HITL /
 * bounded / confirm) — no grammar interpreter (D-101 / §22.2).
 *
 * All product carriers (copy/note/media) enter here; adding a carrier requires
 * recipe + program registration (see carrier-unit-recipes constructive gate).
 */

import type {
  CompiledExecutionPlan,
  ExecutionUnit,
} from '@meiye/contracts';

import {
  createCanonicalCarrierUnitRecipeRegistry,
  lensToContentCarrier,
  type CarrierUnitRecipe,
  type CarrierUnitRecipeRegistry,
  type ContentCarrierKind,
} from './carrier-unit-recipes.js';

export type CarrierProgramKind = ContentCarrierKind;

export type CompiledCarrierExecutorContext = {
  /** Lens from execution snapshot (or default copy). */
  lens?: 'copy' | 'image' | 'video' | 'image_text_note';
  /** Frozen plan from ExecutionPlanSnapshot when present. */
  frozenExecutionPlan?: CompiledExecutionPlan;
  /** force_legacy_five_stage kill switch — still uses single entry, tags path. */
  forceLegacyFiveStage?: boolean;
};

export type CompiledCarrierResolution = {
  carrier: ContentCarrierKind;
  recipe: CarrierUnitRecipe;
  /**
   * Plan used for this run: frozen snapshot plan when present and valid shape,
   * otherwise the canonical carrier recipe plan.
   */
  executionPlan: CompiledExecutionPlan;
  /** Observability path tag (D-036 / ops). */
  executorPath: 'compiled_plan_executor' | 'legacy_five_stage_runner';
  /** True when recipe was used because freeze lacked a plan. */
  usedCanonicalRecipe: boolean;
};

export class CompiledCarrierExecutorError extends Error {
  readonly code = 'COMPILED_CARRIER_EXECUTOR_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'CompiledCarrierExecutorError';
  }
}

export type CarrierProgramRegistry<TInput, TResult> = {
  has(carrier: ContentCarrierKind): boolean;
  resolve(
    carrier: ContentCarrierKind,
  ): (input: TInput) => Promise<TResult>;
  list(): ContentCarrierKind[];
};

export type CompiledPrimitiveId = NonNullable<ExecutionUnit['primitive']>;

export type CompiledPrimitiveHandlerInput<TInput> = {
  unit: ExecutionUnit;
  programInput: TInput;
  priorOutputs: ReadonlyMap<string, unknown>;
};

export type CompiledPrimitiveHandlers<TInput> = Record<
  CompiledPrimitiveId,
  (input: CompiledPrimitiveHandlerInput<TInput>) => Promise<unknown>
>;

/** Durable boundary used by DBOS in production and a restartable store in tests. */
export interface PrimitiveEffectStore {
  run<Output>(
    idempotencyKey: string,
    operation: () => Promise<Output>,
  ): Promise<Output>;
}

export function createMemoryPrimitiveEffectStore(): PrimitiveEffectStore {
  const completed = new Map<string, unknown>();
  return {
    async run<Output>(key: string, operation: () => Promise<Output>) {
      if (completed.has(key)) return structuredClone(completed.get(key)) as Output;
      const output = await operation();
      completed.set(key, structuredClone(output));
      return structuredClone(output);
    },
  };
}

const immediateEffectStore: PrimitiveEffectStore = {
  run(_key, operation) {
    return operation();
  },
};

function inertPrimitiveHandlers<TInput>(): CompiledPrimitiveHandlers<TInput> {
  const inert = async () => null;
  return {
    read_context: inert,
    ask_merchant: inert,
    generate: inert,
    check: inert,
    revise: inert,
    record: inert,
  };
}

export function createCarrierProgramRegistry<TInput, TResult>(
  programs: Partial<
    Record<ContentCarrierKind, (input: TInput) => Promise<TResult>>
  >,
): CarrierProgramRegistry<TInput, TResult> {
  const map = new Map<
    ContentCarrierKind,
    (input: TInput) => Promise<TResult>
  >();
  for (const [carrier, program] of Object.entries(programs) as Array<
    [ContentCarrierKind, ((input: TInput) => Promise<TResult>) | undefined]
  >) {
    if (program) map.set(carrier, program);
  }
  return {
    has(carrier) {
      return map.has(carrier);
    },
    resolve(carrier) {
      const found = map.get(carrier);
      if (!found) {
        throw new CompiledCarrierExecutorError(
          `No carrier program for ${carrier}. Register a program on the single executor — do not fork a runner.`,
        );
      }
      return found;
    },
    list() {
      return [...map.keys()];
    },
  };
}

/**
 * Resolve carrier + plan for this Make run (pure). Does not execute side effects.
 */
export function resolveCompiledCarrierExecution(
  context: CompiledCarrierExecutorContext,
  recipeRegistry: CarrierUnitRecipeRegistry = createCanonicalCarrierUnitRecipeRegistry(),
): CompiledCarrierResolution {
  const carrier = lensToContentCarrier(context.lens);
  const recipe = recipeRegistry.resolve(carrier);
  const frozen = context.frozenExecutionPlan;
  const useFrozen =
    frozen &&
    frozen.schemaVersion === 'compiled-execution-plan/v1' &&
    Array.isArray(frozen.units) &&
    frozen.units.length > 0;
  return {
    carrier,
    recipe,
    executionPlan: useFrozen ? frozen : recipe.plan,
    executorPath: context.forceLegacyFiveStage
      ? 'legacy_five_stage_runner'
      : 'compiled_plan_executor',
    usedCanonicalRecipe: !useFrozen,
  };
}

/**
 * Single executor entry: resolve plan, require registered program, run it.
 * Carrier programs own HITL/bounded control flow; this function never
 * interprets ConditionalNode / dynamic JS.
 */
export async function executeCompiledCarrierPlan<TInput, TResult>(input: {
  context: CompiledCarrierExecutorContext;
  programInput: TInput;
  programs?: CarrierProgramRegistry<TInput, TResult>;
  primitiveHandlers?: CompiledPrimitiveHandlers<TInput>;
  effectStore?: PrimitiveEffectStore;
  executionId?: string;
  recipeRegistry?: CarrierUnitRecipeRegistry;
  /**
   * Optional hook for observability / shadow — receives resolved plan before
   * the program runs. Must be side-effect free w.r.t. business writes.
   */
  onResolved?: (resolution: CompiledCarrierResolution) => void | Promise<void>;
}): Promise<{ result: TResult; resolution: CompiledCarrierResolution }> {
  const resolution = resolveCompiledCarrierExecution(
    input.context,
    input.recipeRegistry,
  );
  if (input.programs && !input.programs.has(resolution.carrier)) {
    throw new CompiledCarrierExecutorError(
      `Carrier ${resolution.carrier} has a recipe but no program. Constructive gate failed.`,
    );
  }
  await input.onResolved?.(resolution);
  assertNoGrammarInterpreter(resolution.executionPlan);
  const outputs = await executePrimitiveUnits({
    plan: resolution.executionPlan,
    programInput: input.programInput,
    handlers: input.primitiveHandlers ?? inertPrimitiveHandlers<TInput>(),
    effectStore: input.effectStore ?? immediateEffectStore,
    executionId: input.executionId ?? resolution.carrier,
  });
  const result = input.programs
    ? await input.programs.resolve(resolution.carrier)(input.programInput)
    : (outputs.at(-1)?.output as TResult);
  return { result, resolution };
}

export async function executePrimitiveUnits<TInput>(input: {
  plan: CompiledExecutionPlan;
  programInput: TInput;
  handlers: CompiledPrimitiveHandlers<TInput>;
  effectStore: PrimitiveEffectStore;
  executionId: string;
}): Promise<Array<{ unitId: string; primitive: CompiledPrimitiveId; output: unknown }>> {
  const unitsById = new Map(input.plan.units.map((unit) => [unit.unitId, unit]));
  const scheduled = input.plan.dependencyGroups.flatMap((group) => group.unitIds);
  if (scheduled.length !== input.plan.units.length || new Set(scheduled).size !== scheduled.length) {
    throw new CompiledCarrierExecutorError(
      'Every execution unit must appear exactly once in dependencyGroups.',
    );
  }
  const priorOutputs = new Map<string, unknown>();
  const results: Array<{
    unitId: string;
    primitive: CompiledPrimitiveId;
    output: unknown;
  }> = [];
  for (const unitId of scheduled) {
    const unit = unitsById.get(unitId);
    if (!unit) {
      throw new CompiledCarrierExecutorError(
        `Dependency group references unknown unit ${unitId}.`,
      );
    }
    if (!unit.primitive) {
      throw new CompiledCarrierExecutorError(
        `Execution unit ${unit.unitId} has no primitive binding.`,
      );
    }
    const handler = input.handlers[unit.primitive];
    if (!handler) {
      throw new CompiledCarrierExecutorError(
        `No primitive handler bound for ${unit.primitive}.`,
      );
    }
    const output = await input.effectStore.run(
      `compiled-primitive:${input.executionId}:${unit.unitId}`,
      () =>
        handler({
          unit,
          programInput: input.programInput,
          priorOutputs,
        }),
    );
    priorOutputs.set(unit.unitId, output);
    results.push({ unitId: unit.unitId, primitive: unit.primitive, output });
  }
  return results;
}

/** Fail closed if a plan embeds forbidden interpreter shapes. */
export function assertNoGrammarInterpreter(plan: CompiledExecutionPlan): void {
  const serialized = JSON.stringify(plan);
  for (const key of [
    'conditionalNodes',
    'ConditionalNode',
    'grammar',
    'ifElse',
    'dynamicExecutable',
  ]) {
    if (serialized.includes(`"${key}"`)) {
      throw new CompiledCarrierExecutorError(
        `CompiledExecutionPlan must not embed ${key} (plan-as-data only; no grammar interpreter).`,
      );
    }
  }
}

/**
 * Constructive check used by tests: every registered recipe has a program.
 */
export function assertRecipesHavePrograms(input: {
  recipes: CarrierUnitRecipeRegistry;
  programs: CarrierProgramRegistry<unknown, unknown>;
}): void {
  for (const recipe of input.recipes.list()) {
    if (!input.programs.has(recipe.carrier)) {
      throw new CompiledCarrierExecutorError(
        `Recipe for ${recipe.carrier} has no carrier program on the single executor.`,
      );
    }
  }
}
