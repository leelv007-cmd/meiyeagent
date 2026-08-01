import type {
  SensitiveCheckBar,
  SensitiveScanResult,
  SensitiveWordRecord,
} from '@meiye/contracts';

import { buildSensitiveCheckBar } from './check-bar.js';
import { scanSensitiveText } from './scan.js';

export interface GenerationChainSensitiveCheckResult {
  schemaVersion: 'generation-chain-sensitive-check/v1';
  /** Same scanner identity as policy-gates (shared library). */
  scanner: 'scanSensitiveText';
  passed: boolean;
  scan: SensitiveScanResult;
  checkBar: SensitiveCheckBar;
}

/**
 * Generation-chain automatic sensitive-word step (spec §4.6 / §6.3).
 * Shares `scanSensitiveText` + lexicon with redline policy-gates.
 */
export function runGenerationChainSensitiveCheck(input: {
  text: string;
  lexicon: readonly SensitiveWordRecord[];
}): GenerationChainSensitiveCheckResult {
  const scan = scanSensitiveText(input.text, input.lexicon);
  const checkBar = buildSensitiveCheckBar({ text: input.text, scan });
  return {
    schemaVersion: 'generation-chain-sensitive-check/v1',
    scanner: 'scanSensitiveText',
    passed: scan.hitCount === 0,
    scan,
    checkBar,
  };
}
