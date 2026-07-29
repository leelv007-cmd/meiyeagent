import type {
  AgentPrimitiveLifecycleInput,
  ObservabilityEventAuditPort,
} from '../creation-experience/index.js';
import { AgentPrimitiveObservabilityAdapter } from '../creation-experience/index.js';
import type {
  AgentPrimitiveTraceEvent,
  AgentPrimitiveTracePort,
} from './runtime.js';

export class AgentPrimitiveDurableTracePort
  implements AgentPrimitiveTracePort
{
  constructor(private readonly audit: ObservabilityEventAuditPort) {}

  append(event: AgentPrimitiveTraceEvent): Promise<void> {
    const taskId = event.serverContext.taskId?.trim();
    if (!taskId) {
      throw new Error(
        'Durable agent primitive tracing requires a server-owned task identity.',
      );
    }
    const billing = event.serverContext.billing
      ? {
          kind: 'product_usage' as const,
          productUsageTaskId:
            event.serverContext.billing.productUsageTaskId,
          quoteId: event.serverContext.billing.quoteId,
        }
      : { kind: 'not_billed' as const };
    const adapter = new AgentPrimitiveObservabilityAdapter(this.audit, {
      resolve: () => billing,
    });
    const input = {
      axes: event.serverContext.observability,
      baseIdempotencyKey: event.serverContext.idempotencyKey,
      context: {
        actor: 'worker' as const,
        correlationId: event.serverContext.correlationId,
        userId: event.serverContext.actorId,
        workspaceId: event.serverContext.workspaceId,
      },
      primitiveId: event.primitiveId,
      taskId,
    };
    const lifecycle: AgentPrimitiveLifecycleInput =
      event.phase === 'rejected'
        ? {
            ...input,
            phase: event.phase,
            rejectionClass: event.rejectionClass,
          }
        : {
            ...input,
            phase: event.phase,
          };
    return adapter.append(lifecycle).then(() => undefined);
  }
}
