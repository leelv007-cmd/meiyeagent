import { z } from 'zod';

import type { RecordProposalPort } from '../agent-primitives/core-handlers.js';
import type {
  MemorySedimentationAudit,
  MemoryWorkLog,
  ReuseMemoryRepository,
} from './reuse-memory-service.js';

const candidateSchema = z
  .object({
    semanticKey: z.string().trim().min(1),
    proposedValue: z.json(),
    defaultScope: z
      .object({
        storeId: z.string().trim().min(1),
        personaId: z.string().trim().min(1).optional(),
        scene: z.string().trim().min(1).optional(),
        platform: z.string().trim().min(1).optional(),
      })
      .strict(),
    decisionEventId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    messageRange: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine(({ start, end }) => start <= end),
  })
  .strict();

type Candidate = z.infer<typeof candidateSchema>;

export interface MemoryCandidateExtractor {
  extract(turn: MemoryWorkLog): Promise<
    Array<{ itemId: string; candidate: unknown }>
  >;
}

export type MemoryPersistenceDecision =
  | { state: 'allow'; candidate: Candidate }
  | { state: 'rewrite'; candidate: Candidate }
  | { state: 'discard'; reason: string }
  | { state: 'to_pending_confirmation'; candidate: Candidate };

export interface MemoryPersistenceInterceptor {
  decide(input: {
    itemId: string;
    candidate: Candidate;
  }): Promise<MemoryPersistenceDecision>;
}

export interface MemoryCandidateRedline {
  check(
    candidate: Candidate,
  ): Promise<{ allowed: true } | { allowed: false; reason: string }>;
}

export class MemorySedimentationPipeline {
  constructor(
    private readonly repository: ReuseMemoryRepository,
    private readonly extractor: MemoryCandidateExtractor,
    private readonly interceptor: MemoryPersistenceInterceptor,
    private readonly redline: MemoryCandidateRedline,
    private readonly proposals: RecordProposalPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  summarize(turn: MemoryWorkLog) {
    return this.extractor.extract(structuredClone(turn));
  }

  async complete(turn: MemoryWorkLog) {
    const items = await this.summarize(turn);
    await this.repository.saveMemorySourceConversation(turn);
    await this.repository.saveMemoryWorkLog(turn);
    for (const item of items) {
      try {
        const parsed = candidateSchema.safeParse(item.candidate);
        if (!parsed.success) {
          await this.audit(turn, item.itemId, 'failed', 'parse_failed', 'invalid');
          continue;
        }
        const decision = await this.interceptor.decide({
          itemId: item.itemId,
          candidate: parsed.data,
        });
        if (decision.state === 'discard') {
          await this.audit(
            turn,
            item.itemId,
            'aborted',
            'discard',
            decision.reason,
          );
          continue;
        }
        const redline = await this.redline.check(decision.candidate);
        if (!redline.allowed) {
          await this.audit(
            turn,
            item.itemId,
            'aborted',
            'redline_aborted',
            redline.reason,
          );
          continue;
        }
        await this.proposals.propose({
          kind: 'propose_preference',
          payload: {
            semanticKey: decision.candidate.semanticKey,
            proposedValue: decision.candidate.proposedValue,
            defaultScope: decision.candidate.defaultScope,
          },
          provenance: {
            sourceConversationId: turn.conversationId,
            sourceTurnId: turn.turnId,
            messageRange: decision.candidate.messageRange,
          },
          workspaceId: turn.workspaceId,
          idempotencyKey: `memory:${turn.turnId}:${item.itemId}`,
          execution: {
            actorId: 'memory-sedimentation-worker',
            correlationId: decision.candidate.decisionEventId,
            taskId: decision.candidate.taskId,
          },
        });
        await this.audit(
          turn,
          item.itemId,
          'persisted',
          decision.state,
          'proposed',
        );
      } catch (error) {
        await this.audit(
          turn,
          item.itemId,
          'failed',
          'item_failed',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
  }

  private async audit(
    turn: MemoryWorkLog,
    itemId: string,
    outcome: MemorySedimentationAudit['outcome'],
    decision: MemorySedimentationAudit['decision'],
    reason: string,
  ) {
    await this.repository.appendMemorySedimentationAudit({
      auditId: `${turn.turnId}:${itemId}`,
      workspaceId: turn.workspaceId,
      conversationId: turn.conversationId,
      itemId,
      outcome,
      decision,
      reason,
      occurredAt: this.now(),
    });
  }
}
