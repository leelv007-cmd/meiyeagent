import { z } from 'zod';

import type { RecordProposalPort } from '../agent-primitives/core-handlers.js';
import type { HarnessCheckTargetScope } from '../agent-primitives/harness-check-target-scope.js';
import type { HarnessMemorySedimentationPort } from '../harness/production-stage-ports.js';
import type { StructuredNodeRunner } from '../harness/structured-nodes.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import type { ReuseMemoryRepository } from './reuse-memory-service.js';
import { MemorySedimentationPipeline } from './memory-sedimentation-pipeline.js';

const extractionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            itemId: z.string().trim().min(1),
            decision: z.unknown(),
            candidate: z.unknown(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const decisionSchema = z
  .object({
    state: z.enum([
      'allow',
      'rewrite',
      'discard',
      'to_pending_confirmation',
    ]),
    reason: z.string().trim().min(1),
  })
  .strict();

type AssemblyInput = Parameters<
  NonNullable<HarnessMemorySedimentationPort['complete']>
>[0];

export class ProductionMemorySedimentationCoordinator
  implements HarnessMemorySedimentationPort
{
  constructor(
    private readonly repository: ReuseMemoryRepository,
    private readonly runners: {
      create(input: {
        workspaceId: string;
        actorId: string;
        billingTaskId?: string;
        billingQuoteRevision?: string;
      }): StructuredNodeRunner;
    },
    private readonly proposals: (input: {
      request: HarnessWorkflowInput;
      proposal: Parameters<RecordProposalPort['propose']>[0];
    }) => Promise<Awaited<ReturnType<RecordProposalPort['propose']>>>,
    private readonly targetScope: HarnessCheckTargetScope,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async summarize(input: AssemblyInput) {
    const snapshot = input.request.executionSnapshot;
    const assembly = input.request.executionAssembly;
    if (!snapshot || !assembly) return [];
    const extracted = await this.extract(input);
    return extracted.output.items.map((item) => ({
      itemId: item.itemId,
      decision: item.decision,
      candidate:
        item.candidate &&
        typeof item.candidate === 'object' &&
        !Array.isArray(item.candidate)
          ? {
              ...(item.candidate as Record<string, unknown>),
              defaultScope: {
                storeId:
                  input.request.factScope?.storeId ??
                  input.request.workspaceId,
                ...(input.request.intent.context.scene
                  ? { scene: input.request.intent.context.scene }
                  : {}),
                ...(snapshot.platform.id
                  ? { platform: snapshot.platform.id }
                  : {}),
              },
              decisionEventId: `memory:${input.workflowId}:${item.itemId}`,
              taskId: input.workflowId,
            }
          : item.candidate,
    }));
  }

  async complete(input: AssemblyInput) {
    const snapshot = input.request.executionSnapshot;
    const assembly = input.request.executionAssembly;
    if (!snapshot || !assembly) return;
    const stableTime = snapshot.createdAt ?? this.now();
    try {
      await this.run(input, stableTime);
    } catch (error) {
      await this.repository.appendMemorySedimentationAudit({
        auditId: `${input.workflowId}:pipeline`,
        workspaceId: input.request.workspaceId,
        conversationId: `${snapshot.work.id}:${input.workflowId}`,
        itemId: 'pipeline',
        outcome: 'failed',
        decision: 'item_failed',
        reason: error instanceof Error ? error.message : 'unknown',
        occurredAt: stableTime,
      });
    }
  }

  private async run(input: AssemblyInput, stableTime: string) {
    const snapshot = input.request.executionSnapshot!;
    const summarized = await this.summarize(input);
    const candidates = summarized.map(({ itemId, candidate }) => ({
      itemId,
      candidate,
    }));
    const decisions = new Map(
      summarized.map((item) => [item.itemId, item.decision]),
    );
    const assistantText = winnerText(input);
    const pipeline = new MemorySedimentationPipeline(
      this.repository,
      { async extract() { return candidates; } },
      {
        async decide({ itemId, candidate }) {
          const decision = decisionSchema.parse(decisions.get(itemId));
          if (
            candidate.messageRange.start !== 0 ||
            candidate.messageRange.end !== 0
          ) {
            return {
              state: 'discard' as const,
              reason: 'non_merchant_provenance',
            };
          }
          if (decision.state === 'discard') {
            return { state: 'discard' as const, reason: decision.reason };
          }
          return { state: decision.state, candidate };
        },
      },
      { async check() { return { allowed: true as const }; } },
      {
        propose: (proposal) =>
          this.proposals({ request: input.request, proposal }),
      },
      () => stableTime,
    );
    await this.targetScope.withTarget(
      {
        targetRef: input.selection.winner.candidateId,
        taskId: input.workflowId,
        policyInput: {
          phase: 'execution',
          bundle: {
            workspaceId: input.request.workspaceId,
            revision: input.context.bundle.revision,
          },
          brief: structuredClone(input.brief),
          candidate: {
            candidateId: input.selection.winner.candidateId,
            workspaceId: input.request.workspaceId,
            intendedUse: 'internal_draft',
            factClaims: [],
            assetRefs: [...input.brief.assetRefs],
            visibleText: [
              { field: 'winner.title', text: input.selection.winner.title },
              { field: 'winner.body', text: input.selection.winner.body },
              {
                field: 'winner.cta',
                text: input.selection.winner.conversionHook,
              },
            ],
          },
          ...input.context.policyReferences,
        },
      },
      () =>
        pipeline.complete({
          workspaceId: input.request.workspaceId,
          conversationId: `${snapshot.work.id}:${input.workflowId}`,
          turnId: input.workflowId,
          observedAt: stableTime,
          messages: [
            { index: 0, text: input.request.rawInput },
            { index: 1, text: assistantText },
          ],
        }),
    );
  }

  private async extract(input: AssemblyInput) {
    const snapshot = input.request.executionSnapshot!;
    const runner = this.runners.create({
      workspaceId: input.request.workspaceId,
      actorId: input.request.actorId,
      billingTaskId: snapshot.task.id,
      billingQuoteRevision: snapshot.quote.revision,
    });
    const assistantText = winnerText(input);
    const extracted = await runner.run({
      effectIdempotencyKey: `wf:${input.workflowId}:memory-extract`,
      schemaName: 'memory_sedimentation_candidates_v1',
      schemaRevision: 'memory-sedimentation-v1',
      instructions:
        'Extract only durable merchant preferences explicitly requested for future work. Return raw items shaped as {itemId, decision:{state,reason}, candidate:{semanticKey,proposedValue,messageRange}} so one invalid item can be rejected without losing its siblings. Classify every item as allow, rewrite, discard, or to_pending_confirmation. Use rewrite when the durable preference must be narrowed or stripped of temporary facts, discard for transient or sensitive material, allow only for an unambiguous long-term instruction, and pending when merchant confirmation is still needed. Never retain prices, offers, customer data, generated copy, or unsupported claims. Provenance may point only to merchant message index 0; never use assistant index 1.',
      prompt: JSON.stringify({
        messages: [
          { index: 0, role: 'merchant', text: input.request.rawInput },
          { index: 1, role: 'assistant', text: assistantText },
        ],
      }),
      schema: extractionSchema,
    });
    return extracted;
  }
}

function winnerText(input: AssemblyInput) {
  return [
    input.selection.winner.title,
    input.selection.winner.body,
    input.selection.winner.conversionHook,
  ].join('\n');
}
