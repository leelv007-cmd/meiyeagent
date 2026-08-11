import type { ObservabilityEventAuditPort } from '../creation-experience/observability-events.js';
import {
  AskMerchantPrimitiveHandler,
  type MerchantQuestionRequestPort,
} from './ask-merchant-handler.js';
import {
  CheckPrimitiveHandler,
  type CheckTargetResolverPort,
  type CheckViolationAuditPort,
} from './check-handler.js';
import {
  createGenerateHandler,
  createReadContextHandler,
  createRecordHandler,
  createReviseHandler,
  type GeneratePort,
  type ReadContextPort,
  type RecordProposalPort,
  type RevisePort,
  type ReviseTargetResolverPort,
} from './core-handlers.js';
import { AgentPrimitiveDurableTracePort } from './durable-trace-port.js';
import { AgentPrimitiveFoundationModule } from './foundation-module.js';
import { createCanonicalAgentPrimitiveRegistry } from './registry.js';
import {
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
} from './runtime.js';

export interface ProductionAgentPrimitiveAssemblyPorts {
  audit: ObservabilityEventAuditPort;
  askMerchant: MerchantQuestionRequestPort;
  checkTarget: CheckTargetResolverPort;
  checkViolationAudit: CheckViolationAuditPort;
  generate: GeneratePort;
  readContext: ReadContextPort;
  recordProposal: RecordProposalPort;
  revise: RevisePort;
  reviseTarget: ReviseTargetResolverPort;
}

export interface ProductionAgentPrimitiveAssembly {
  foundationModule: AgentPrimitiveFoundationModule;
  runtime: AgentPrimitiveRuntime;
}

function requireMethod(
  owner: unknown,
  method: string,
  label: keyof ProductionAgentPrimitiveAssemblyPorts,
) {
  if (
    !owner ||
    typeof owner !== 'object' ||
    typeof (owner as Record<string, unknown>)[method] !== 'function'
  ) {
    throw new Error(
      `Production agent primitive assembly requires ${label}.${method}.`,
    );
  }
}

export function createProductionAgentPrimitiveAssembly(
  ports: ProductionAgentPrimitiveAssemblyPorts,
): ProductionAgentPrimitiveAssembly {
  requireMethod(ports?.audit, 'append', 'audit');
  requireMethod(ports?.askMerchant, 'request', 'askMerchant');
  requireMethod(ports?.checkTarget, 'resolve', 'checkTarget');
  requireMethod(
    ports?.checkViolationAudit,
    'append',
    'checkViolationAudit',
  );
  requireMethod(ports?.generate, 'generate', 'generate');
  requireMethod(ports?.readContext, 'read', 'readContext');
  requireMethod(ports?.recordProposal, 'propose', 'recordProposal');
  requireMethod(ports?.revise, 'revise', 'revise');
  requireMethod(ports?.reviseTarget, 'resolve', 'reviseTarget');

  const check = new CheckPrimitiveHandler({
    resolver: ports.checkTarget,
    violationAudit: ports.checkViolationAudit,
  });
  const askMerchant = new AskMerchantPrimitiveHandler(ports.askMerchant);
  const bindings: AgentPrimitiveBindings = {
    read_context: createReadContextHandler(ports.readContext),
    generate: createGenerateHandler(ports.generate),
    revise: createReviseHandler({
      resolver: ports.reviseTarget,
      writer: ports.revise,
    }),
    record: createRecordHandler(ports.recordProposal),
    check: (args) => check.execute(args),
    ask_merchant: (args) => askMerchant.execute(args),
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort: new AgentPrimitiveDurableTracePort(ports.audit),
  });
  return {
    foundationModule: new AgentPrimitiveFoundationModule(runtime),
    runtime,
  };
}
