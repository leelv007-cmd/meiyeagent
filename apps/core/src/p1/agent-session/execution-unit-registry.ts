/**
 * Execution-unit type registry (V3.1 §22.2 / V31-09).
 *
 * New carrier/recipe does not change the six primitives or executor core.
 * Adding a unit type still requires: registry entry + schema + policy + tests.
 * Domain enums never enter primitive signatures (A8).
 */

import { z } from 'zod';

export type ExecutionUnitSideEffectClass =
  | 'none'
  | 'read'
  | 'bounded_write'
  | 'external_side_effect';

export type ExecutionUnitCachePolicyDefault =
  | { cacheable: false; reason: string }
  | {
      cacheable: true;
      ttlSeconds: number;
      /** Always workspace-scoped; cache key must include harnessReleaseId. */
      scope: 'workspace';
      dependsOn: readonly string[];
    };

export type ExecutionUnitTypeDefinition = {
  readonly unitType: string;
  readonly description: string;
  /** Optional six-primitive mount point — never a domain enum (A8). */
  readonly primitive?:
    | 'read_context'
    | 'generate'
    | 'revise'
    | 'record'
    | 'check'
    | 'ask_merchant';
  readonly sideEffectClass: ExecutionUnitSideEffectClass;
  /**
   * A18: conditional/judgment positions must not carry side effects.
   * Units used as condition predicates must declare this true and sideEffectClass none|read.
   */
  readonly mayAppearInConditional: boolean;
  readonly inputSchema: z.ZodType;
  readonly cacheDefault: ExecutionUnitCachePolicyDefault;
  readonly policyTags: readonly string[];
};

const freeInputSchema = z.record(z.string(), z.unknown()).optional();

export const CANONICAL_EXECUTION_UNIT_TYPES = Object.freeze([
  Object.freeze({
    unitType: 'context.read',
    description: 'Read confirmed facts / assets / experience for the plan.',
    primitive: 'read_context' as const,
    sideEffectClass: 'read' as const,
    mayAppearInConditional: true,
    inputSchema: freeInputSchema,
    cacheDefault: Object.freeze({
      cacheable: true as const,
      ttlSeconds: 300,
      scope: 'workspace' as const,
      dependsOn: Object.freeze(['contextRevision', 'rightsRevisionIds']),
    }),
    policyTags: Object.freeze(['read_only']),
  }),
  Object.freeze({
    unitType: 'copy.generate',
    description: 'Generate pure copy deliverable.',
    primitive: 'generate' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: false,
    inputSchema: freeInputSchema,
    cacheDefault: Object.freeze({
      cacheable: false as const,
      reason: 'generation output is non-deterministic',
    }),
    policyTags: Object.freeze(['billed', 'copy']),
  }),
  Object.freeze({
    unitType: 'note.generate',
    description: 'Generate note (image+text) deliverable.',
    primitive: 'generate' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: false,
    inputSchema: freeInputSchema,
    cacheDefault: Object.freeze({
      cacheable: false as const,
      reason: 'generation output is non-deterministic',
    }),
    policyTags: Object.freeze(['billed', 'paid_media_candidate', 'note']),
  }),
  Object.freeze({
    unitType: 'media.generate',
    description: 'Generate media deliverable.',
    primitive: 'generate' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: false,
    inputSchema: freeInputSchema,
    cacheDefault: Object.freeze({
      cacheable: false as const,
      reason: 'generation output is non-deterministic',
    }),
    policyTags: Object.freeze(['billed', 'paid_media_candidate', 'media']),
  }),
  Object.freeze({
    unitType: 'compliance.check',
    description: 'Deterministic compliance / rights / contract checks.',
    primitive: 'check' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: true,
    inputSchema: freeInputSchema,
    cacheDefault: Object.freeze({
      cacheable: true as const,
      ttlSeconds: 120,
      scope: 'workspace' as const,
      dependsOn: Object.freeze([
        'rightsRevisionIds',
        'compliancePolicyRevision',
      ]),
    }),
    policyTags: Object.freeze(['gate', 'deterministic']),
  }),
] as const satisfies readonly ExecutionUnitTypeDefinition[]);

export class ExecutionUnitRegistryError extends Error {
  readonly code = 'EXECUTION_UNIT_REGISTRY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ExecutionUnitRegistryError';
  }
}

export class ExecutionUnitRegistry {
  readonly #byType = new Map<string, ExecutionUnitTypeDefinition>();

  constructor(definitions: readonly ExecutionUnitTypeDefinition[]) {
    for (const definition of definitions) {
      if (!definition.unitType.trim()) {
        throw new ExecutionUnitRegistryError(
          'Execution unit type must be non-empty.',
        );
      }
      if (this.#byType.has(definition.unitType)) {
        throw new ExecutionUnitRegistryError(
          `Execution unit type registered more than once: ${definition.unitType}`,
        );
      }
      if (
        definition.mayAppearInConditional &&
        definition.sideEffectClass !== 'none' &&
        definition.sideEffectClass !== 'read'
      ) {
        // A18 constructive gate: condition positions cannot carry side effects.
        throw new ExecutionUnitRegistryError(
          `Unit type ${definition.unitType} mayAppearInConditional but has sideEffectClass=${definition.sideEffectClass}`,
        );
      }
      this.#byType.set(
        definition.unitType,
        Object.freeze({ ...definition }),
      );
    }
  }

  list(): ExecutionUnitTypeDefinition[] {
    return [...this.#byType.values()];
  }

  has(unitType: string): boolean {
    return this.#byType.has(unitType);
  }

  resolve(unitType: string): ExecutionUnitTypeDefinition {
    const found = this.#byType.get(unitType);
    if (!found) {
      throw new ExecutionUnitRegistryError(
        `Execution unit type is not registered: ${unitType}`,
      );
    }
    return found;
  }
}

export function createCanonicalExecutionUnitRegistry(): ExecutionUnitRegistry {
  return new ExecutionUnitRegistry(CANONICAL_EXECUTION_UNIT_TYPES);
}

/**
 * Constructive boundary for new unit types (V3.1 §22.2):
 * registration requires schema + policy tags + tests evidence flag.
 */
export function assertUnitTypeRegistrationComplete(input: {
  definition: ExecutionUnitTypeDefinition;
  hasSchema: boolean;
  hasPolicy: boolean;
  hasTest: boolean;
}): void {
  if (!input.hasSchema) {
    throw new ExecutionUnitRegistryError(
      `Unit type ${input.definition.unitType} missing input schema.`,
    );
  }
  if (!input.hasPolicy || input.definition.policyTags.length === 0) {
    throw new ExecutionUnitRegistryError(
      `Unit type ${input.definition.unitType} missing policy tags.`,
    );
  }
  if (!input.hasTest) {
    throw new ExecutionUnitRegistryError(
      `Unit type ${input.definition.unitType} missing registration test.`,
    );
  }
  // Re-validate A18 for the candidate definition.
  if (
    input.definition.mayAppearInConditional &&
    input.definition.sideEffectClass !== 'none' &&
    input.definition.sideEffectClass !== 'read'
  ) {
    throw new ExecutionUnitRegistryError(
      `Unit type ${input.definition.unitType} violates A18 (conditional side effects).`,
    );
  }
}

/** Workspace-isolated cache key; always includes harnessReleaseId (MAJOR-07). */
export function buildExecutionUnitCacheKey(input: {
  workspaceId: string;
  unitType: string;
  inputHash: string;
  harnessReleaseId: string;
}): string {
  if (!input.workspaceId.trim()) {
    throw new ExecutionUnitRegistryError('cache key requires workspaceId');
  }
  if (!input.harnessReleaseId.trim()) {
    throw new ExecutionUnitRegistryError('cache key requires harnessReleaseId');
  }
  return [
    'ws',
    input.workspaceId,
    'unit',
    input.unitType,
    'in',
    input.inputHash,
    'rel',
    input.harnessReleaseId,
  ].join(':');
}
