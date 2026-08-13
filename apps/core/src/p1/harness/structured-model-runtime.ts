import type { ModelExecutionRuntime } from '../model-supply/index.js';
import { FixtureAiStructuredObjectExecutor } from '../model-supply/index.js';
import {
  AiSdkStructuredObjectExecutor,
  type StructuredObjectExecutor,
} from '../model-supply/structured-node-runner.js';

export const HARNESS_FIXTURE_STRUCTURED_MODEL_WARNING =
  'Harness running with FIXTURE structured model (e2e only).';

export const HARNESS_LIVE_MODEL_REQUIRED_ERROR =
  'Harness production runtime requires a live direct structured model. ' +
  'Missing: live-verified activation evidence for the configured direct structured model ' +
  '(admin-config global/__global__/model.activation.evidence.<deploymentId> matching the current non-secret fingerprint) ' +
  'and a direct runtime binding. ' +
  'Fix: (1) use the credential-free pair APP_ENV=e2e MODEL_EXECUTION_MODE=fixture (see .env.example), ' +
  '(2) complete a live activation probe so runtime.activation becomes live_verified, ' +
  'or (3) do not boot APP_ENV=development MODEL_EXECUTION_MODE=direct without that evidence — ' +
  'scripts/dev/start-stack.mjs refuses that pair before the stack starts.';

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
