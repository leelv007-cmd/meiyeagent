/**
 * destinationMapping prompt pin resolution (V31-21 / U10).
 *
 * Composer destination mapping is a workspace-scoped model call, so it must
 * resolve its release with the workspace. A workspace-less resolveForRun({})
 * returns bare production: it never matches the canary allowlist, so a canary
 * workspace would map destinations on the production prompt while its own task
 * runs use the canary pin, and the two would be indistinguishable in eval
 * attribution. workspaceId is therefore required here, not optional.
 *
 * The candidate trial is deliberately not consumed. A trial is one-shot per
 * workspace and locks to the first runId that consumes it, so consuming it for
 * a destination-map call would take it away from the creation run it was
 * granted for. Destination mapping is a pre-task clarification, not a run.
 */

import type { HarnessReleaseService } from './harness-release.js';
import {
  requireHarnessFrozenPrompt,
  resolveHarnessPromptKeys,
  type HarnessFrozenPrompt,
  type HarnessFrozenPrompts,
  type HarnessPromptKey,
  type HarnessPromptResolver,
} from './langfuse-prompts.js';

const DESTINATION_MAPPING_KEY: HarnessPromptKey = 'destinationMapping';

export async function resolveDestinationMappingPrompt(input: {
  releases: Pick<HarnessReleaseService, 'resolveForRun'>;
  prompts: HarnessPromptResolver;
  workspaceId: string;
}): Promise<HarnessFrozenPrompt> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error(
      'destinationMapping prompt resolution requires a workspaceId; resolving without one silently returns bare production and skips the canary allowlist.',
    );
  }
  const release = await input.releases.resolveForRun({ workspaceId });
  const binding = release.artifact.promptBindings[DESTINATION_MAPPING_KEY];
  if (
    !binding ||
    binding.key !== DESTINATION_MAPPING_KEY ||
    !binding.version.trim()
  ) {
    throw new Error(
      `HarnessRelease ${release.releaseId} is missing exact prompt pin ${DESTINATION_MAPPING_KEY}.`,
    );
  }
  return requireHarnessFrozenPrompt(
    (await resolveHarnessPromptKeys(
      input.prompts,
      [DESTINATION_MAPPING_KEY],
      { [DESTINATION_MAPPING_KEY]: binding.version },
    )) as HarnessFrozenPrompts,
    DESTINATION_MAPPING_KEY,
  );
}
