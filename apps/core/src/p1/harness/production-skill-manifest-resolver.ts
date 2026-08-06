/**
 * Production Skill manifest resolver for Harness admission (Spec E / #379).
 *
 * Single wiring owner for the production `select` / `materialize` seam used by
 * `api-runtime` and admission regression tests. Must pass
 * `request.userSelectedSkillRefs` into the durable instruction resolver —
 * omitting that field leaves `user_selected` bindings permanently empty.
 */

import type { DurableSkillInstructionResolver } from '../skills/runtime.js';
import type { HarnessSkillManifestResolver } from './task-admission.js';

/**
 * Build the production admission skill-manifest port from the durable Skill
 * instruction resolver. Callers must not re-implement this adapter inline.
 */
export function createProductionSkillManifestResolver(
  instructionResolver: Pick<
    DurableSkillInstructionResolver,
    'selectManifests' | 'materializeManifests'
  >,
): HarnessSkillManifestResolver {
  return {
    async select({ request, stage }) {
      const recipe = request.executionSnapshot?.recipe;
      const industryCategory = request.decisionReferences?.find(
        (reference) => reference.field === 'industry_category',
      )?.value;
      const lensId = request.executionSnapshot?.lens;
      return instructionResolver.selectManifests({
        workspaceId: request.workspaceId,
        workflowId: request.executionSnapshot?.task.id ?? request.packageId,
        workflowRevision: request.workflowRevision,
        ...(recipe
          ? {
              recipeId: recipe.id,
              recipeRevisionId: recipe.revision,
            }
          : {}),
        stage,
        ...(industryCategory ? { industryCategory } : {}),
        ...(lensId ? { lensId } : {}),
        // #379: merchant selection must reach stage resolution; default [].
        userSelectedSkillRefs: [...(request.userSelectedSkillRefs ?? [])],
      });
    },
    async materialize({ manifests }) {
      return instructionResolver.materializeManifests(manifests);
    },
  };
}
