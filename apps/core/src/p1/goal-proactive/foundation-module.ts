/**
 * Goal + Proactive P1 module (V31-24).
 *
 * Merchant-facing: propose/confirm goals, list primary goal + progress,
 * list proactive suggestions, accept/dismiss candidates.
 * No Goal management page actions.
 */

import { z } from 'zod';

import {
  marketingGoalCreateDraftSchema,
  marketingGoalStatusSchema,
} from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { MarketingGoalStoreError } from './goal-store.js';
import type { GoalService } from './goal-service.js';
import { OpportunityDecisionStoreError } from './opportunity-decision-store.js';
import type { ProactiveService } from './proactive-service.js';
import type { ProactiveGateConfig } from './evidence-gate.js';
import type { ProactiveSignal } from '@meiye/contracts';

/**
 * Fixture/test override: force signal resourceId to the caller workspace so
 * e2e payloads need not know the internal workspace id.
 */
function coerceSignalsForWorkspace(
  resourceId: string,
  signals: unknown[] | undefined,
): ProactiveSignal[] | undefined {
  if (!signals) return undefined;
  return signals.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      ...row,
      resourceId,
    } as ProactiveSignal;
  });
}

function actionName(input: Record<string, unknown>): string {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', 'A goal-proactive action is required.');
  }
  return input.action;
}

function payload(input: Record<string, unknown>): Record<string, unknown> {
  const value = input.payload;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A goal-proactive payload is required.',
    );
  }
  return value as Record<string, unknown>;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', parsed.error.message);
  }
  return parsed.data;
}

function mapError(error: unknown): never {
  if (error instanceof MarketingGoalStoreError) {
    if (error.code === 'GOAL_NOT_FOUND') {
      throw new P1DomainError('NOT_FOUND', error.message);
    }
    if (
      error.code === 'GOAL_REVISION_CONFLICT' ||
      error.code === 'GOAL_ID_TAKEN'
    ) {
      throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
    }
    throw new P1DomainError('INVALID_STATE', error.message);
  }
  if (error instanceof OpportunityDecisionStoreError) {
    throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
  }
  throw error;
}

const proposeCreateSchema = z
  .object({
    draft: marketingGoalCreateDraftSchema,
    proposalId: z.string().trim().min(1).optional(),
    why: z.string().trim().min(1).max(2_000).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const proposeAttachSchema = z
  .object({
    goalId: z.string().trim().min(1),
    workRefs: z.array(z.string().trim().min(1)).min(1).max(50),
    proposalId: z.string().trim().min(1).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    why: z.string().trim().min(1).max(2_000).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const proposeStatusSchema = z
  .object({
    goalId: z.string().trim().min(1),
    nextStatus: marketingGoalStatusSchema,
    expectedRevision: z.number().int().nonnegative(),
    proposalId: z.string().trim().min(1).optional(),
    why: z.string().trim().min(1).max(2_000).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const confirmProposalSchema = z
  .object({
    proposalId: z.string().trim().min(1),
    goalId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const acceptCandidateSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(2_000),
    evidenceRefs: z
      .array(
        z
          .object({
            kind: z.string().trim().min(1).max(100),
            ref: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    goalId: z.string().trim().min(1).optional(),
    signalKinds: z.array(z.string().trim().min(1)).max(20).optional(),
    decisionId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1).optional(),
    harnessReleaseId: z.string().trim().min(1).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const dismissCandidateSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    decisionId: z.string().trim().min(1).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const listSuggestionsSchema = z
  .object({
    now: z.iso.datetime().optional(),
    maxCandidates: z.number().int().positive().max(20).optional(),
    /** Test/fixture override for gate config. */
    config: z
      .object({
        disableProactiveAgent: z.boolean(),
        proactiveFeatureOn: z.boolean(),
        workspaceAllowlisted: z.boolean(),
        coverageThreshold: z.number().finite().nullable(),
      })
      .strict()
      .optional(),
    signals: z.array(z.unknown()).optional(),
  })
  .strict();

export class GoalProactiveFoundationModule implements P1OperationModule {
  readonly name = 'goal-proactive';

  constructor(
    private readonly goals: GoalService,
    private readonly proactive: ProactiveService,
  ) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<unknown> {
    const action = actionName(args.input);
    const value = payload(args.input);
    const resourceId = args.context.workspaceId;
    const actorId = args.context.userId;

    try {
      switch (action) {
        case 'propose_create_goal': {
          const input = parse(proposeCreateSchema, value);
          const proposal = await this.goals.proposeCreate({
            resourceId,
            draft: input.draft,
            proposalId: input.proposalId,
            why: input.why,
            now: input.now ?? new Date().toISOString(),
          });
          return { proposal };
        }
        case 'propose_attach_works': {
          const input = parse(proposeAttachSchema, value);
          const proposal = await this.goals.proposeAttachWorks({
            resourceId,
            goalId: input.goalId,
            workRefs: input.workRefs,
            proposalId: input.proposalId,
            expectedRevision: input.expectedRevision,
            why: input.why,
            now: input.now ?? new Date().toISOString(),
          });
          return { proposal };
        }
        case 'propose_status_transition': {
          const input = parse(proposeStatusSchema, value);
          const proposal = await this.goals.proposeStatusTransition({
            resourceId,
            goalId: input.goalId,
            nextStatus: input.nextStatus,
            expectedRevision: input.expectedRevision,
            proposalId: input.proposalId,
            why: input.why,
            now: input.now ?? new Date().toISOString(),
          });
          return { proposal };
        }
        case 'confirm_goal_proposal': {
          const input = parse(confirmProposalSchema, value);
          return await this.goals.confirmProposal({
            resourceId,
            proposalId: input.proposalId,
            goalId: input.goalId,
            threadId: input.threadId,
            now: input.now ?? new Date().toISOString(),
          });
        }
        case 'accept_opportunity': {
          const input = parse(acceptCandidateSchema, value);
          return await this.proactive.acceptCandidate({
            resourceId,
            candidateId: input.candidateId,
            actorId,
            reason: input.reason,
            evidenceRefs: input.evidenceRefs,
            goalId: input.goalId,
            signalKinds: input.signalKinds,
            decisionId: input.decisionId,
            threadId: input.threadId,
            runId: input.runId,
            harnessReleaseId: input.harnessReleaseId,
            now: input.now ?? new Date().toISOString(),
          });
        }
        case 'dismiss_opportunity': {
          const input = parse(dismissCandidateSchema, value);
          return await this.proactive.dismissCandidate({
            resourceId,
            candidateId: input.candidateId,
            actorId,
            decisionId: input.decisionId,
            now: input.now ?? new Date().toISOString(),
          });
        }
        default:
          throw new P1DomainError(
            'INVALID_STATE',
            `Unknown goal-proactive command ${action}.`,
          );
      }
    } catch (error) {
      mapError(error);
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = actionName(args.input);
    const value = payload(args.input);
    const resourceId = args.context.workspaceId;

    try {
      switch (action) {
        case 'list_goals': {
          const goals = await this.goals.listGoals({
            resourceId,
            status:
              typeof value.status === 'string'
                ? marketingGoalStatusSchema.parse(value.status)
                : undefined,
            limit:
              typeof value.limit === 'number' ? value.limit : undefined,
          });
          return { goals };
        }
        case 'get_primary_goal': {
          const goal = await this.goals.primaryGoal({ resourceId });
          const progress = goal
            ? await this.goals.projectProgress({
                resourceId,
                goalId: goal.goalId,
              })
            : null;
          return { goal, progress };
        }
        case 'get_goal_progress': {
          const goalId =
            typeof value.goalId === 'string' ? value.goalId.trim() : '';
          if (!goalId) {
            throw new P1DomainError('INVALID_STATE', 'goalId is required.');
          }
          const progress = await this.goals.projectProgress({
            resourceId,
            goalId,
          });
          if (!progress) {
            throw new P1DomainError(
              'NOT_FOUND',
              `Marketing goal ${goalId} was not found.`,
            );
          }
          return { progress };
        }
        case 'list_proactive_suggestions': {
          const input = parse(listSuggestionsSchema, value);
          const projection = await this.proactive.listSuggestions({
            resourceId,
            now: input.now ?? new Date().toISOString(),
            maxCandidates: input.maxCandidates,
            config: input.config as ProactiveGateConfig | undefined,
            signals: coerceSignalsForWorkspace(resourceId, input.signals),
          });
          return {
            gate: projection.gate,
            suggestions: projection.suggestions,
            history: projection.history,
          };
        }
        case 'get_idle_projection': {
          const input = parse(listSuggestionsSchema, value);
          const primary = await this.goals.primaryGoal({ resourceId });
          const progress = primary
            ? await this.goals.projectProgress({
                resourceId,
                goalId: primary.goalId,
              })
            : null;
          const projection = await this.proactive.listSuggestions({
            resourceId,
            now: input.now ?? new Date().toISOString(),
            maxCandidates: input.maxCandidates,
            config: input.config as ProactiveGateConfig | undefined,
            signals: coerceSignalsForWorkspace(resourceId, input.signals),
          });
          return {
            primaryGoal: primary,
            progress,
            gate: projection.gate,
            suggestions: projection.suggestions,
          };
        }
        default:
          throw new P1DomainError(
            'INVALID_STATE',
            `Unknown goal-proactive query ${action}.`,
          );
      }
    } catch (error) {
      mapError(error);
    }
  }
}
