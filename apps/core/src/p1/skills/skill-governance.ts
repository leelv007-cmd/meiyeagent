import { resolveSkillSchema } from '@meiye/contracts';
import { z } from 'zod';

import type { SkillGovernanceSidecar } from './types.js';

const skillGovernanceSchema = z
  .object({
    inputSchemaRef: z.string().trim().min(1),
    outputSchemaRef: z.string().trim().min(1),
    contextScopes: z.array(z.string()),
    allowedTools: z.array(z.string()),
    sideEffectClass: z.enum(['none', 'read', 'bounded_write']),
    requiredModelCapabilities: z.array(z.string()),
    executionMode: z.enum([
      'provider_native',
      'harness_native',
      'prompt_materialized',
    ]),
    budget: z
      .object({
        maxChildEffects: z.number().int().nonnegative(),
        maxCostCents: z.number().nonnegative(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    workflowRevisionRefs: z.array(z.string()),
    fallback: z.enum(['skip', 'fail_closed']),
  })
  .strict();

export function parseSkillGovernance(
  value: unknown,
): SkillGovernanceSidecar {
  const governance = skillGovernanceSchema.parse(value);
  if (!governance.inputSchemaRef.startsWith('skill-input.')) {
    throw new Error(
      'Skill governance inputSchemaRef must reference a skill-input schema.',
    );
  }
  if (!governance.outputSchemaRef.startsWith('skill-output.')) {
    throw new Error(
      'Skill governance outputSchemaRef must reference a skill-output schema.',
    );
  }
  resolveSkillSchema(governance.inputSchemaRef);
  resolveSkillSchema(governance.outputSchemaRef);
  return governance;
}
