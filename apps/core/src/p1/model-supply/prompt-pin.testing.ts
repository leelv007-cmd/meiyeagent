/**
 * Test double for the production prompt pin.
 *
 * Production always wires a prompt resolver (core-assembly), so every language
 * model submission reaches prepareSubmission with an exact pin. Test doubles
 * that omitted one were exercising a state production cannot reach, which is
 * what kept the unpinned pass-through looking green.
 */

import { createHash } from 'node:crypto';

import {
  LANGUAGE_MODEL_PROMPT_NAME_BY_OPERATION,
  type ModelSupplyPromptResolver,
} from './route-contracts.js';

export const pinnedPromptResolver: ModelSupplyPromptResolver = {
  async resolve({ operation }) {
    const content = `frozen:${operation}`;
    return {
      name: LANGUAGE_MODEL_PROMPT_NAME_BY_OPERATION[operation],
      version: '1',
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      label: 'production',
      source: 'langfuse',
      isFallback: false,
    };
  },
};
