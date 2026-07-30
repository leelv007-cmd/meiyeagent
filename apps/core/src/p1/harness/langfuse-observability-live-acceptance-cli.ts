import { randomUUID } from 'node:crypto';

import {
  assertLangfuseObservabilityLiveConfig,
  runLangfuseObservabilityLiveAcceptance,
} from './langfuse-observability-live-acceptance.js';

const config = assertLangfuseObservabilityLiveConfig();
const result = await runLangfuseObservabilityLiveAcceptance({
  ...config,
  runId: randomUUID(),
});

console.log(JSON.stringify(result));
