import type { ModelExecutionRuntime } from '../model-supply/index.js';
import { FixtureAiStructuredObjectExecutor } from '../model-supply/index.js';
import {
  AiSdkStructuredObjectExecutor,
  type StructuredObjectExecutor,
} from '../model-supply/structured-node-runner.js';

export const HARNESS_FIXTURE_STRUCTURED_MODEL_WARNING =
  'Harness running with FIXTURE structured model (e2e only).';

const HARNESS_LIVE_MODEL_REQUIRED_ERROR =
  'Harness production runtime requires a live direct structured model.';

export function createHarnessStructuredModelExecutor(
  runtime: ModelExecutionRuntime,
  warn: (message: string) => void = console.warn,
): StructuredObjectExecutor {
  if (runtime.mode === 'fixture') {
    warn(HARNESS_FIXTURE_STRUCTURED_MODEL_WARNING);
    return new FixtureAiStructuredObjectExecutor();
  }
  if (runtime.activation !== 'live_verified' || !runtime.direct) {
    throw new Error(HARNESS_LIVE_MODEL_REQUIRED_ERROR);
  }
  return new AiSdkStructuredObjectExecutor(runtime.direct);
}
