import { createHash } from 'node:crypto';

import {
  reusableAssetScopeSchema,
  sourcedPreferenceCandidateSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import type { RecordProposalPort } from '../agent-primitives/core-handlers.js';
import type { ReuseMemoryService } from './reuse-memory-service.js';
import type { CanonicalMemoryProposalRedline } from './canonical-memory-redline.js';

const preferenceProposalPayloadSchema = z
  .object({
    semanticKey: z.string().trim().min(1),
    proposedValue: z.json(),
    defaultScope: reusableAssetScopeSchema,
  })
  .strict();

const recordProvenanceSchema = z
  .object({
    sourceConversationId: z.string().trim().min(1),
    sourceTurnId: z.string().trim().min(1),
    messageRange: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine(({ start, end }) => start <= end, {
        message: 'Message range start must not exceed its end.',
      }),
  })
  .strict();

function proposalId(workspaceId: string, idempotencyKey: string) {
  const digest = createHash('sha256')
    .update(JSON.stringify([workspaceId, idempotencyKey]))
    .digest('hex')
    .slice(0, 24);
  return `preference-candidate-${digest}`;
}

export class ReuseMemoryRecordProposalPort implements RecordProposalPort {
  constructor(
    private readonly service: ReuseMemoryService,
    private readonly redline: Pick<CanonicalMemoryProposalRedline, 'check'>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async propose(input: Parameters<RecordProposalPort['propose']>[0]) {
    if (input.kind !== 'propose_preference') {
      throw new Error(`Unsupported reuse-memory proposal kind: ${input.kind}`);
    }
    const payload = preferenceProposalPayloadSchema.parse(input.payload);
    const provenance = recordProvenanceSchema.parse(input.provenance);
    const candidateId = proposalId(input.workspaceId, input.idempotencyKey);
    const redline = await this.redline.check({
      candidateId,
      workspaceId: input.workspaceId,
      proposedValue: payload.proposedValue,
    });
    if (!redline.allowed) {
      throw new Error(
        `Memory proposal blocked by canonical redlines: ${redline.failures
          .map(({ gateId }) => gateId)
          .join(',')}`,
      );
    }
    await this.service.proposePreference(sourcedPreferenceCandidateSchema.parse({
      candidateId,
      workspaceId: input.workspaceId,
      semanticKey: payload.semanticKey,
      proposedValue: payload.proposedValue,
      defaultScope: payload.defaultScope,
      evidenceDecisionIds: [input.execution.correlationId],
      evidenceTaskIds: [input.execution.taskId],
      trigger: 'explicit_long_term_intent',
      status: 'pending',
      proposedAt: this.now(),
      source: {
        conversationId: provenance.sourceConversationId,
        sourceTurnId: provenance.sourceTurnId,
        messageRange: provenance.messageRange,
      },
    }));
    return { proposalRef: candidateId, status: 'proposed' };
  }
}
