/**
 * Carrier → CompiledExecutionPlan recipes (V31-25 / V3.1 §22.2 / §22.4).
 *
 * New product carrier must register a recipe + unit handlers + tests.
 * Forking a whole runner is forbidden (constructive gate).
 *
 * Recipes are plan-as-data: typed units + dependency groups + retry default-off.
 * Control flow (HITL / bounded) stays in TypeScript carrier programs invoked
 * by the single compiled-plan executor — no grammar interpreter.
 */

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  compiledExecutionPlanSchema,
  type CompiledExecutionPlan,
  type ExecutionUnit,
  type ExecutionUnitId,
} from '@meiye/contracts';

import {
  createCanonicalExecutionUnitRegistry,
  type ExecutionUnitRegistry,
} from '../agent-session/execution-unit-registry.js';

/** Product content carriers (ContentPackage kind vocabulary). */
export type ContentCarrierKind = 'copy' | 'note' | 'media';

/**
 * One executable step this carrier implements. The compiled plan directs
 * execution by naming steps (`primitive` + `role`); the executor refuses any
 * unit whose step is not declared here, so the catalog is the carrier's
 * executable surface — not documentation.
 */
export type CarrierStepDeclaration = {
  readonly primitive:
    | 'read_context'
    | 'ask_merchant'
    | 'generate'
    | 'check'
    | 'revise'
    | 'record';
  readonly role: string;
  /** A plan omitting a required step is rejected. */
  readonly required: boolean;
  /** Repeatable steps may appear once per deliverable unit. */
  readonly repeatable: boolean;
};

export type CarrierUnitRecipe = {
  readonly carrier: ContentCarrierKind;
  readonly description: string;
  /** plan-as-data recipe used for admission / shadow / executor observability. */
  readonly plan: CompiledExecutionPlan;
  /**
   * Six-primitive sequence for this carrier (intent→read/ask; brief→generate;
   * execution→generate/check/revise). Used by constructive docs & eval layers.
   */
  readonly primitiveSequence: readonly string[];
  /** Executable step surface consumed by the compiled-plan executor. */
  readonly stepCatalog: readonly CarrierStepDeclaration[];
};

export class CarrierRecipeRegistryError extends Error {
  readonly code = 'CARRIER_RECIPE_REGISTRY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'CarrierRecipeRegistryError';
  }
}

function unit(
  unitId: string,
  unitType: string,
  primitive:
    | 'read_context'
    | 'generate'
    | 'revise'
    | 'record'
    | 'check'
    | 'ask_merchant',
  input?: ExecutionUnit['input'],
): ExecutionUnit {
  return {
    unitId: unitId as ExecutionUnitId,
    unitType,
    primitive,
    ...(input !== undefined ? { input } : {}),
  };
}

function retryOff(
  unitIds: readonly string[],
): CompiledExecutionPlan['boundedRetry'] {
  const boundedRetry: CompiledExecutionPlan['boundedRetry'] = {};
  for (const id of unitIds) {
    boundedRetry[id] = {
      maxAttempts: 1,
      maxCostCents: 0,
      retry: { enabled: false },
    };
  }
  return boundedRetry;
}

function buildPlan(units: ExecutionUnit[], groups: CompiledExecutionPlan['dependencyGroups']): CompiledExecutionPlan {
  const unitIds = units.map((u) => u.unitId);
  return compiledExecutionPlanSchema.parse({
    schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
    units,
    dependencyGroups: groups,
    boundedRetry: retryOff(unitIds),
  });
}

const COPY_STEP_CATALOG: readonly CarrierStepDeclaration[] = [
  { primitive: 'read_context', role: 'context', required: true, repeatable: false },
  { primitive: 'generate', role: 'brief', required: true, repeatable: false },
  { primitive: 'generate', role: 'selection', required: true, repeatable: true },
  { primitive: 'check', role: 'gate', required: true, repeatable: false },
  { primitive: 'record', role: 'assemble', required: true, repeatable: false },
];

const NOTE_STEP_CATALOG: readonly CarrierStepDeclaration[] = [
  { primitive: 'read_context', role: 'context', required: true, repeatable: false },
  { primitive: 'generate', role: 'brief', required: true, repeatable: false },
  {
    primitive: 'ask_merchant',
    role: 'style_choice',
    required: true,
    repeatable: false,
  },
  { primitive: 'generate', role: 'pages', required: true, repeatable: true },
  { primitive: 'check', role: 'consistency', required: true, repeatable: false },
  // Page regeneration only runs when the consistency check reports findings, so
  // a plan may legitimately omit it.
  {
    primitive: 'revise',
    role: 'page_regenerate',
    required: false,
    repeatable: false,
  },
  { primitive: 'record', role: 'assemble', required: true, repeatable: false },
];

const MEDIA_STEP_CATALOG: readonly CarrierStepDeclaration[] = [
  { primitive: 'read_context', role: 'context', required: true, repeatable: false },
  { primitive: 'generate', role: 'brief', required: true, repeatable: false },
  { primitive: 'generate', role: 'selection', required: true, repeatable: true },
  { primitive: 'check', role: 'gate', required: true, repeatable: false },
  { primitive: 'record', role: 'assemble', required: true, repeatable: false },
];

/** Copy carrier: context → brief generate → selection generate/check → assembly record. */
export function buildCopyCarrierRecipe(): CarrierUnitRecipe {
  const units = [
    unit('unit-copy-context', 'context.read', 'read_context', {
      stage: 'context_injection',
      role: 'context',
    }),
    unit('unit-copy-brief', 'copy.generate', 'generate', {
      stage: 'brief_compilation',
      role: 'brief',
    }),
    unit('unit-copy-select', 'copy.generate', 'generate', {
      stage: 'execution_selection',
      role: 'selection',
    }),
    unit('unit-copy-check', 'compliance.check', 'check', {
      stage: 'execution_selection',
      role: 'gate',
      rubric: 'copy_delivery_readiness',
    }),
    unit('unit-copy-assemble', 'delivery.record', 'record', {
      stage: 'assembly_delivery',
      role: 'assemble',
    }),
  ];
  return {
    carrier: 'copy',
    description: 'Pure copy deliverable path (D-043 confirmation exempt).',
    plan: buildPlan(units, [
      { groupId: 'g-context', unitIds: ['unit-copy-context' as ExecutionUnitId] },
      { groupId: 'g-brief', unitIds: ['unit-copy-brief' as ExecutionUnitId] },
      {
        groupId: 'g-execute',
        unitIds: [
          'unit-copy-select' as ExecutionUnitId,
          'unit-copy-check' as ExecutionUnitId,
        ],
      },
      {
        groupId: 'g-assemble',
        unitIds: ['unit-copy-assemble' as ExecutionUnitId],
      },
    ]),
    primitiveSequence: [
      'read_context',
      'generate',
      'generate',
      'check',
      'record',
    ],
    stepCatalog: COPY_STEP_CATALOG,
  };
}

/** Note carrier: context → brief generate → style ask → page generate/check/revise → assemble. */
export function buildNoteCarrierRecipe(): CarrierUnitRecipe {
  const units = [
    unit('unit-note-context', 'context.read', 'read_context', {
      stage: 'context_injection',
      role: 'context',
    }),
    unit('unit-note-brief', 'note.generate', 'generate', {
      stage: 'brief_compilation',
      role: 'brief',
    }),
    unit('unit-note-style-ask', 'merchant.ask', 'ask_merchant', {
      stage: 'brief_compilation',
      role: 'style_choice',
    }),
    unit('unit-note-pages', 'note.generate', 'generate', {
      stage: 'execution_selection',
      role: 'pages',
    }),
    unit('unit-note-check', 'compliance.check', 'check', {
      stage: 'execution_selection',
      role: 'consistency',
      rubric: 'note_page_consistency',
    }),
    unit('unit-note-revise', 'note.revise', 'revise', {
      stage: 'execution_selection',
      role: 'page_regenerate',
    }),
    unit('unit-note-assemble', 'delivery.record', 'record', {
      stage: 'assembly_delivery',
      role: 'assemble',
    }),
  ];
  return {
    carrier: 'note',
    description: 'Image-text note with style choice and page-level frame.',
    plan: buildPlan(units, [
      { groupId: 'g-context', unitIds: ['unit-note-context' as ExecutionUnitId] },
      {
        groupId: 'g-brief',
        unitIds: [
          'unit-note-brief' as ExecutionUnitId,
          'unit-note-style-ask' as ExecutionUnitId,
        ],
      },
      {
        groupId: 'g-execute',
        unitIds: [
          'unit-note-pages' as ExecutionUnitId,
          'unit-note-check' as ExecutionUnitId,
          'unit-note-revise' as ExecutionUnitId,
        ],
      },
      {
        groupId: 'g-assemble',
        unitIds: ['unit-note-assemble' as ExecutionUnitId],
      },
    ]),
    primitiveSequence: [
      'read_context',
      'generate',
      'ask_merchant',
      'generate',
      'check',
      'revise',
      'record',
    ],
    stepCatalog: NOTE_STEP_CATALOG,
  };
}

/** Media carrier: context → brief generate → selection generate/check → assemble. */
export function buildMediaCarrierRecipe(): CarrierUnitRecipe {
  const units = [
    unit('unit-media-context', 'context.read', 'read_context', {
      stage: 'context_injection',
      role: 'context',
    }),
    unit('unit-media-brief', 'media.generate', 'generate', {
      stage: 'brief_compilation',
      role: 'brief',
    }),
    unit('unit-media-select', 'media.generate', 'generate', {
      stage: 'execution_selection',
      role: 'selection',
    }),
    unit('unit-media-check', 'compliance.check', 'check', {
      stage: 'execution_selection',
      role: 'gate',
      rubric: 'media_delivery_readiness',
    }),
    unit('unit-media-assemble', 'delivery.record', 'record', {
      stage: 'assembly_delivery',
      role: 'assemble',
    }),
  ];
  return {
    carrier: 'media',
    description: 'Image/video finished_media path with paid confirmation gate.',
    plan: buildPlan(units, [
      {
        groupId: 'g-context',
        unitIds: ['unit-media-context' as ExecutionUnitId],
      },
      { groupId: 'g-brief', unitIds: ['unit-media-brief' as ExecutionUnitId] },
      {
        groupId: 'g-execute',
        unitIds: [
          'unit-media-select' as ExecutionUnitId,
          'unit-media-check' as ExecutionUnitId,
        ],
      },
      {
        groupId: 'g-assemble',
        unitIds: ['unit-media-assemble' as ExecutionUnitId],
      },
    ]),
    primitiveSequence: [
      'read_context',
      'generate',
      'generate',
      'check',
      'record',
    ],
    stepCatalog: MEDIA_STEP_CATALOG,
  };
}

export class CarrierUnitRecipeRegistry {
  readonly #byCarrier = new Map<ContentCarrierKind, CarrierUnitRecipe>();

  constructor(
    recipes: readonly CarrierUnitRecipe[],
    private readonly unitRegistry: ExecutionUnitRegistry = createCanonicalExecutionUnitRegistry(),
  ) {
    for (const recipe of recipes) {
      if (this.#byCarrier.has(recipe.carrier)) {
        throw new CarrierRecipeRegistryError(
          `Carrier recipe registered more than once: ${recipe.carrier}`,
        );
      }
      this.assertRecipeUnitsRegistered(recipe);
      this.#byCarrier.set(recipe.carrier, Object.freeze({ ...recipe }));
    }
  }

  list(): CarrierUnitRecipe[] {
    return [...this.#byCarrier.values()];
  }

  has(carrier: string): boolean {
    return this.#byCarrier.has(carrier as ContentCarrierKind);
  }

  resolve(carrier: ContentCarrierKind): CarrierUnitRecipe {
    const found = this.#byCarrier.get(carrier);
    if (!found) {
      throw new CarrierRecipeRegistryError(
        `No unit recipe for carrier ${carrier}. Register a recipe — do not fork a runner.`,
      );
    }
    return found;
  }

  private assertRecipeUnitsRegistered(recipe: CarrierUnitRecipe): void {
    for (const u of recipe.plan.units) {
      if (!this.unitRegistry.has(u.unitType)) {
        throw new CarrierRecipeRegistryError(
          `Carrier ${recipe.carrier} unit ${u.unitId} uses unregistered unitType ${u.unitType}`,
        );
      }
      const definition = this.unitRegistry.resolve(u.unitType);
      if (definition.primitive !== u.primitive) {
        throw new CarrierRecipeRegistryError(
          `Carrier ${recipe.carrier} unit ${u.unitId} primitive ${u.primitive} does not match ${u.unitType}=${definition.primitive}`,
        );
      }
    }
  }
}

export function createCanonicalCarrierUnitRecipeRegistry(
  unitRegistry: ExecutionUnitRegistry = createCanonicalExecutionUnitRegistry(),
): CarrierUnitRecipeRegistry {
  return new CarrierUnitRecipeRegistry(
    [
      buildCopyCarrierRecipe(),
      buildNoteCarrierRecipe(),
      buildMediaCarrierRecipe(),
    ],
    unitRegistry,
  );
}

/**
 * Constructive gate (V3.1 §22.2 / V31-25): a new product carrier may not copy
 * a whole runner. It must register recipe + unit types + primitive handlers + tests.
 */
export function assertCarrierRegistrationComplete(input: {
  carrier: string;
  hasRecipe: boolean;
  hasUnitTypes: boolean;
  hasPrimitiveHandlers: boolean;
  hasTest: boolean;
}): void {
  if (!input.carrier.trim()) {
    throw new CarrierRecipeRegistryError('Carrier id must be non-empty.');
  }
  if (!input.hasRecipe) {
    throw new CarrierRecipeRegistryError(
      `Carrier ${input.carrier} missing CompiledExecutionPlan recipe — do not fork a runner.`,
    );
  }
  if (!input.hasUnitTypes) {
    throw new CarrierRecipeRegistryError(
      `Carrier ${input.carrier} missing registered unit types.`,
    );
  }
  if (!input.hasPrimitiveHandlers) {
    throw new CarrierRecipeRegistryError(
      `Carrier ${input.carrier} missing primitive handlers on the single executor.`,
    );
  }
  if (!input.hasTest) {
    throw new CarrierRecipeRegistryError(
      `Carrier ${input.carrier} missing registration / equivalence test.`,
    );
  }
}

/** Lens (execution snapshot) → product carrier kind. */
export function lensToContentCarrier(
  lens: 'copy' | 'image' | 'video' | 'image_text_note' | undefined,
): ContentCarrierKind {
  if (lens === 'image_text_note') return 'note';
  if (lens === 'image' || lens === 'video') return 'media';
  return 'copy';
}
