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

import type { CompiledExecutionPlan } from '@meiye/contracts';

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
  programs: CarrierProgramRegistry<TInput, TResult>;
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
  if (!input.programs.has(resolution.carrier)) {
    throw new CompiledCarrierExecutorError(
      `Carrier ${resolution.carrier} has a recipe but no program. Constructive gate failed.`,
    );
  }
  await input.onResolved?.(resolution);
  // A18 / §22.2: no grammar interpreter — program is registered TS only.
  assertNoGrammarInterpreter(resolution.executionPlan);
  const program = input.programs.resolve(resolution.carrier);
  const result = await program(input.programInput);
  return { result, resolution };
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
