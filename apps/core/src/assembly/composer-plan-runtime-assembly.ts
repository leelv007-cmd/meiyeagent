import type { ProductQuoteAuthority } from '../p1/product-billing/server-quote-authority.js';
import type { ProductBillingApplicationPort } from '../p1/product-billing/durable-service.js';
import { ProductQuoteService } from '../p1/product-billing/quote-service.js';
import type { AgentSessionStore } from '../p1/agent-session/agent-session-store.js';
import type { MarketingPlanStore } from '../p1/agent-session/plan-store.js';
import {
  ComposerPlanSessionCoordinator,
  type ComposerPlanCompilerPort,
  type ComposerPlanSessionOptions,
} from '../p1/agent-session/composer-plan-session.js';
import { fingerprintValue } from '../p1/job-runtime/job-contracts.js';
import type { AgentSemanticEventProjector } from '../p1/agent-semantic-events/semantic-event-projector.js';
import type { AgentSemanticEventStore } from '../p1/agent-semantic-events/semantic-event-store.js';
import { ComposerSemanticClarificationInterrupts } from '../p1/agent-session/composer-clarification-interrupt.js';

export function assembleProductionComposerPlanSession(input: {
  sessions: AgentSessionStore;
  plans: MarketingPlanStore;
  sessionHarness?: ComposerPlanCompilerPort;
  quoteAuthority: Pick<ProductQuoteAuthority, 'resolve'>;
  quoteService: Pick<ProductBillingApplicationPort, 'getQuote'>;
  releaseResolver: {
    resolveForRun(input: { workspaceId: string }): Promise<{ releaseId: string }>;
  };
  semanticEvents: {
    store: AgentSemanticEventStore;
    projector: Pick<AgentSemanticEventProjector, 'project'>;
  };
  /** True only under the fixture kernel, which cannot propose a plan. */
  compileFromSubmissionWithoutProposal: boolean;
  /** V31-18 P0-1: memory degradation is advisory but never silent. */
  onMemoryDegraded?: ComposerPlanSessionOptions['onMemoryDegraded'];
  /** Canary/rollback-aware pin resolution; defaults to current production. */
  resolveHarnessReleaseId?: ComposerPlanSessionOptions['resolveHarnessReleaseId'];
}) {
  if (!input.sessionHarness) {
    throw new Error(
      'Production Composer requires Session runTurn assembly.',
    );
  }
  return new ComposerPlanSessionCoordinator(
    input.sessions,
    input.plans,
    input.sessionHarness,
    {
      requireSessionTurn: true,
      requireQuoteAuthority: true,
      compileFromSubmissionWithoutProposal:
        input.compileFromSubmissionWithoutProposal,
      clarificationInterrupts: new ComposerSemanticClarificationInterrupts(
        input.semanticEvents.store,
        input.semanticEvents.projector,
      ),
      quoteAuthority: {
        async resolveCurrent({ submission }) {
          const ref = submission.snapshot.quote;
          const quote = await input.quoteService.getQuote(
            ref.id,
            submission.snapshot.workspaceId,
          );
          if (!quote || quote.revision !== String(ref.revision) || !quote.expiresAt) {
            throw new Error(
              `ProductQuote ${ref.id}@${ref.revision} is missing, stale, or has no authority expiry.`,
            );
          }
          return {
            quoteRef: { id: quote.quoteId, revision: quote.revision },
            expiresAt: quote.expiresAt,
            summary: {
              source: 'product_quote',
              creditCost: quote.creditCost,
              outputCount: quote.outputCount,
            },
          };
        },
        async reprice({ submission, merchantInstruction, quantity }) {
          const quoteId = `plan-requote:${submission.task.id}:${fingerprintValue({
            merchantInstruction,
            quantity,
          }).slice(0, 16)}`;
          const build = await input.quoteAuthority.resolve({
            workspaceId: submission.snapshot.workspaceId,
            catalogModelId: submission.snapshot.catalogModel.id,
            operation: submission.snapshot.operation,
            quoteId,
            quantity,
          });
          const quote = new ProductQuoteService().buildQuote(build);
          if (!quote.expiresAt) {
            throw new Error(`Repriced ProductQuote ${quote.quoteId} has no expiry.`);
          }
          return {
            successorQuote: build,
            resolution: {
              quoteRef: { id: quote.quoteId, revision: quote.revision },
              expiresAt: quote.expiresAt,
              summary: {
                source: 'product_quote_reprice',
                creditCost: quote.creditCost,
                outputCount: quote.outputCount,
              },
            },
          };
        },
      },
      ...(input.onMemoryDegraded
        ? { onMemoryDegraded: input.onMemoryDegraded }
        : {}),
      resolveHarnessReleaseId:
        input.resolveHarnessReleaseId ??
        (async (submission) => {
          const resolved = await input.releaseResolver.resolveForRun({
            workspaceId: submission.snapshot.workspaceId,
          });
          return resolved.releaseId;
        }),
    },
  );
}
