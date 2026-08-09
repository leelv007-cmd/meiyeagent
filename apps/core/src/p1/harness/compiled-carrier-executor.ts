/**
 * Single CompiledExecutionPlan → executor entry (V31-25 / V3.1 §22.4 step 3).
 *
 * Topology: resolve carrier recipe (or frozen snapshot.executionPlan) → run
 * every typed unit through its bound primitive handler. There is no carrier
 * program fallback or second runner.
 *
 * All product carriers (copy/note/media) enter here; adding a carrier requires
 * recipe + primitive-handler registration (see the constructive gate).
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
  executorPath: 'compiled_plan_executor';
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

export const immediatePrimitiveEffectStore: PrimitiveEffectStore = {
  run(_key, operation) {
    return operation();
  },
};

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
    executorPath: 'compiled_plan_executor',
    usedCanonicalRecipe: !useFrozen,
  };
}

/**
 * Single executor entry. A terminal record unit is mandatory and its output is
 * the execution result; no out-of-plan carrier callback can invent a result.
 */
export async function executeCompiledCarrierPlan<TInput, TResult>(input: {
  context: CompiledCarrierExecutorContext;
  programInput: TInput;
  primitiveHandlers: CompiledPrimitiveHandlers<TInput>;
  effectStore: PrimitiveEffectStore;
  executionId: string;
  selfDurablePrimitives?: readonly CompiledPrimitiveId[];
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
  await input.onResolved?.(resolution);
  assertNoGrammarInterpreter(resolution.executionPlan);
  const outputs = await executePrimitiveUnits({
    plan: resolution.executionPlan,
    programInput: input.programInput,
    handlers: input.primitiveHandlers,
    effectStore: input.effectStore,
    executionId: input.executionId,
    selfDurablePrimitives: input.selfDurablePrimitives,
  });
  const terminal = outputs.at(-1);
  if (terminal?.primitive !== 'record') {
    throw new CompiledCarrierExecutorError(
      'CompiledExecutionPlan must end with a record unit that owns delivery.',
    );
  }
  const result = terminal.output as TResult;
  return { result, resolution };
}

export async function executePrimitiveUnits<TInput>(input: {
  plan: CompiledExecutionPlan;
  programInput: TInput;
  handlers: CompiledPrimitiveHandlers<TInput>;
  effectStore: PrimitiveEffectStore;
  executionId: string;
  selfDurablePrimitives?: readonly CompiledPrimitiveId[];
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
    const operation = () =>
      handler({ unit, programInput: input.programInput, priorOutputs });
    const effectKey = `compiled-primitive:${input.executionId}:${unit.unitId}`;
    const selfDurable = input.selfDurablePrimitives?.includes(unit.primitive);
    if (selfDurable) {
      // Record owns nested business durability. Persist only its topology
      // marker here, then run the internally idempotent delivery operation
      // outside a nested DBOS step.
      await input.effectStore.run(effectKey, async () => ({ admitted: true }));
    }
    const output = selfDurable
      ? await operation()
      : await input.effectStore.run(effectKey, operation);
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
