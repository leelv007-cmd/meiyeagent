#!/usr/bin/env node
/**
 * Constructive coverage gate for the HarnessRelease seed (V31-38 / R-P0-07).
 *
 * Every prompt key in the registry and every registered platform skill must be
 * bound by exact, non-builtin references in the release manifest the runtime
 * will actually publish. A deploy whose release ledger cannot reproduce exact
 * pins fails closed here, before the release manifest is minted.
 *
 * Run: pnpm --filter @meiye/core exec tsx scripts/ci/assert-harness-release-coverage.mts
 */
import { pathToFileURL } from 'node:url';

import {
  REGISTERED_PLATFORM_SKILL_IDS,
  validateReleasePromptPublish,
  validateReleaseSkillPublish,
} from '../../apps/core/src/p1/harness/prompt-packs.js';
import { seedHarnessReleaseManifest } from '../../apps/core/src/p1/harness/seed-harness-release.js';

export function assertHarnessReleaseConstructiveCoverage() {
  const seed = seedHarnessReleaseManifest();
  const failures = [];

  const promptGate = validateReleasePromptPublish({
    promptPackBindings: seed.promptPackBindings,
    promptBindings: seed.promptBindings,
  });
  if (!promptGate.ok) {
    failures.push(
      ...promptGate.failures.map((failure) => `prompt: ${failure.message}`),
    );
  }

  const skillGate = validateReleaseSkillPublish({
    skillBindings: seed.skillBindings,
  });
  if (!skillGate.ok) {
    failures.push(
      ...skillGate.failures.map((failure) => `skill: ${failure.message}`),
    );
  }

  if (failures.length > 0) {
    const detail = failures.join('\n  - ');
    throw new Error(
      `HarnessRelease seed constructive coverage failed:\n  - ${detail}`,
    );
  }
  return {
    promptKeys: Object.keys(seed.promptBindings).length,
    requiredSkillIds: [...REGISTERED_PLATFORM_SKILL_IDS],
    boundSkillIds: Object.keys(seed.skillBindings),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = assertHarnessReleaseConstructiveCoverage();
    console.log(JSON.stringify({ status: 'covered', ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
