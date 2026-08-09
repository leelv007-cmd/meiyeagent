/**
 * Test doubles for the frozen prompt pins a durable task carries.
 *
 * task-admission freezes a pin for every prompt site the task's packs claim, so
 * a request without prompts — or a structured-node call without one — is a state
 * production cannot reach. Test doubles that omitted them were what let the
 * silent builtin substitution look green.
 *
 * The bundle is derived from HARNESS_PROMPT_SITES rather than a hand-listed key
 * set, so a newly registered prompt site cannot silently fall out of it.
 */

import { createHash } from 'node:crypto';

import {
  HARNESS_PROMPT_SITES,
  type HarnessFrozenPrompt,
  type HarnessFrozenPrompts,
  type HarnessPromptKey,
} from './langfuse-prompts.js';

export function frozenHarnessPrompt(
  key: HarnessPromptKey,
): HarnessFrozenPrompt {
  const content = `frozen:${key}`;
  return {
    name: HARNESS_PROMPT_SITES[key].name,
    version: '1',
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    label: 'production',
    source: 'langfuse',
    isFallback: false,
  };
}

export function frozenHarnessPromptBundle(): HarnessFrozenPrompts {
  return Object.fromEntries(
    (Object.keys(HARNESS_PROMPT_SITES) as HarnessPromptKey[]).map((key) => [
      key,
      frozenHarnessPrompt(key),
    ]),
  ) as HarnessFrozenPrompts;
}
