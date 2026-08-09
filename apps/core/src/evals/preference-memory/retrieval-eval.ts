import { z } from 'zod';

import { AgentMemoryPlatform } from '../../p1/operations/agent-memory-platform.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from '../../p1/operations/reuse-memory-service.js';

const scopeSchema = z
  .object({
    storeId: z.string(),
    personaId: z.string().optional(),
    scene: z.string().optional(),
    platform: z.string().optional(),
  })
  .strict();

const retrievalDatasetSchema = z.object({
  schemaVersion: z.literal('memory-retrieval-dataset/v1'),
  datasetId: z.string().min(1),
  replayCount: z.number().int().min(2).max(20),
  cases: z.array(
    z.object({
      caseId: z.string().min(1),
      query: z.object({
        workspaceId: z.string().min(1),
        scope: scopeSchema,
        limit: z.number().int().positive(),
        similarityByMemoryId: z.record(z.string(), z.number()).optional(),
      }),
      memories: z.array(
        z.object({
          workspaceId: z.string().min(1),
          preferenceId: z.string().min(1),
          kind: z.enum(['preference', 'correction', 'procedure']),
          semanticKey: z.string().min(1),
          statement: z.string().min(1),
          scope: scopeSchema,
          confidence: z.number().min(0).max(1),
          revoked: z.boolean().optional(),
          expectWriteRejected: z.boolean().optional(),
        }),
      ),
      relevantIds: z.array(z.string()),
      expectedRetrievedIds: z.array(z.string()),
      minimumPrecision: z.number().min(0).max(1),
      minimumRecall: z.number().min(0).max(1),
    }),
  ),
});

export type MemoryRetrievalDataset = z.infer<typeof retrievalDatasetSchema>;

export async function runMemoryRetrievalEval(input: unknown) {
  const dataset = retrievalDatasetSchema.parse(input);
  const cases = [];
  for (const fixture of dataset.cases) {
    const repository = new MemoryReuseMemoryRepository();
    const reuse = new ReuseMemoryService(repository, {
      verifyCandidate: async () => {},
      verifyRevision: async () => {},
    });
    const platform = new AgentMemoryPlatform(reuse);

    for (const [index, memory] of fixture.memories.entries()) {
      let extracted: Awaited<ReturnType<AgentMemoryPlatform['onExtracted']>> = [];
      try {
        extracted = await platform.onExtracted({
          workspaceId: memory.workspaceId,
          idempotencyPrefix: `${fixture.caseId}:${index}`,
          items: [
            {
              itemId: memory.preferenceId,
              kind: memory.kind,
              semanticKey: memory.semanticKey,
              proposedValue: memory.statement,
              defaultScope: memory.scope,
              decisionEventId: `decision:${fixture.caseId}:${index}`,
              taskId: `task:${fixture.caseId}:${index}`,
              statement: memory.statement,
              confidence: memory.confidence,
              source: {
                conversationId: `conversation:${fixture.caseId}`,
                sourceTurnId: `turn:${index}`,
                messageRange: { start: 0, end: 0 },
              },
            },
          ],
        });
      } catch (error) {
        if (memory.expectWriteRejected) continue;
        throw error;
      }
      if (memory.expectWriteRejected) {
        throw new Error(`Expected memory ${memory.preferenceId} to be rejected.`);
      }
      const candidate = extracted[0]!;
      await platform.confirmMemoryCandidate(
        { workspaceId: memory.workspaceId, userId: 'eval-owner' },
        {
          candidateId: candidate.candidateId,
          preferenceId: memory.preferenceId,
          idempotencyKey: `confirm:${fixture.caseId}:${index}`,
        },
      );
      if (memory.revoked) {
        await platform.revokeMemory(
          { workspaceId: memory.workspaceId, userId: 'eval-owner' },
          {
            preferenceId: memory.preferenceId,
            expectedRevision: 1,
            idempotencyKey: `revoke:${fixture.caseId}:${index}`,
          },
        );
      }
    }

    const replays: string[][] = [];
    for (let replay = 0; replay < dataset.replayCount; replay += 1) {
      replays.push((await platform.retrieveForInjection(fixture.query)).map((entry) => entry.memoryId));
    }
    const retrievedIds = replays[0] ?? [];
    const replayDistribution = Object.fromEntries(
      retrievedIds.map((id) => [id, replays.filter((result) => result.includes(id)).length]),
    );
    const relevant = new Set(fixture.relevantIds);
    const hits = retrievedIds.filter((id) => relevant.has(id)).length;
    const precision = retrievedIds.length === 0 ? 0 : hits / retrievedIds.length;
    const recall = relevant.size === 0 ? 1 : hits / relevant.size;
    const passed =
      JSON.stringify(retrievedIds) ===
        JSON.stringify(fixture.expectedRetrievedIds) &&
      replays.every((result) => JSON.stringify(result) === JSON.stringify(retrievedIds)) &&
      precision >= fixture.minimumPrecision &&
      recall >= fixture.minimumRecall;
    cases.push({
      caseId: fixture.caseId,
      retrievedIds,
      precision,
      recall,
      replayDistribution,
      passed,
    });
  }

  return {
    schemaVersion: 'memory-retrieval-baseline/v1',
    datasetId: dataset.datasetId,
    passed: cases.every((fixture) => fixture.passed),
    macroPrecision:
      cases.reduce((sum, fixture) => sum + fixture.precision, 0) / cases.length,
    macroRecall:
      cases.reduce((sum, fixture) => sum + fixture.recall, 0) / cases.length,
    cases,
  };
}
