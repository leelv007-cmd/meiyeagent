import type {
  TracerExternalEffect,
  TracerExternalRequest,
} from './tracer-worker.js';

function completed(request: TracerExternalRequest) {
  return {
    acceptance: 'accepted' as const,
    delivery: 'completed' as const,
    output: {
      handledKind: request.kind,
      jobId: request.jobId,
      payloadKeys: Object.keys(request.payload).sort(),
      workspaceId: request.workspaceId,
    },
    taskRef: `recorded:${request.workspaceId}:${request.jobId}`,
  };
}

/** Recorded product tracer used by local/P1 functional acceptance. */
export class RecordedProductTracerEffect implements TracerExternalEffect {
  async execute(request: TracerExternalRequest) {
    return completed(request);
  }

  async reconcile(request: TracerExternalRequest) {
    return completed(request);
  }
}
