/**
 * MarketingGoal product surface service (V31-24 / V3.1 §11).
 *
 * Paths:
 * - propose create / attach / status → pending proposal (no durable goal write)
 * - confirm → land goal / transition / attach evidence (revision OCC)
 *
 * No Goal management CRUD page. Thread.activeGoalIds mounted on attach confirm.
 */

import { randomUUID } from 'node:crypto';

import {
  MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION,
  marketingGoalProposalSchema,
  type MarketingGoal,
  type MarketingGoalCreateDraft,
  type MarketingGoalProposal,
  type MarketingGoalProgress,
  type MarketingGoalStatus,
  type AgentEvidenceRef,
} from '@meiye/contracts';

import type { AgentSessionStore } from '../agent-session/agent-session-store.js';
import {
  projectGoalProgress,
  selectPrimaryGoal,
  type DeliveredWorkFact,
  type OutcomeEvidenceFact,
} from './goal-progress.js';
import {
  MarketingGoalStoreError,
  type MarketingGoalStore,
} from './goal-store.js';

export type GoalProposalStore = {
  save(proposal: MarketingGoalProposal): Promise<MarketingGoalProposal>;
  get(input: {
    resourceId: string;
    proposalId: string;
  }): Promise<MarketingGoalProposal | null>;
};

export class MemoryGoalProposalStore implements GoalProposalStore {
  private readonly rows = new Map<string, MarketingGoalProposal>();

  async save(proposal: MarketingGoalProposal): Promise<MarketingGoalProposal> {
    const parsed = marketingGoalProposalSchema.parse(proposal);
    this.rows.set(`${parsed.resourceId}::${parsed.proposalId}`, parsed);
    return structuredClone(parsed);
  }

  async get(input: {
    resourceId: string;
    proposalId: string;
  }): Promise<MarketingGoalProposal | null> {
    const row = this.rows.get(`${input.resourceId}::${input.proposalId}`);
    return row ? structuredClone(row) : null;
  }
}

export type GoalProgressPorts = {
  listDeliveredWorks(input: {
    resourceId: string;
  }): Promise<readonly DeliveredWorkFact[]> | readonly DeliveredWorkFact[];
  listOutcomeEvidence(input: {
    resourceId: string;
  }): Promise<readonly OutcomeEvidenceFact[]> | readonly OutcomeEvidenceFact[];
};

export type GoalServiceDeps = {
  goals: MarketingGoalStore;
  proposals?: GoalProposalStore;
  /**
   * Optional Thread mount for attach confirm. Production wires AgentSessionStore.
   * When absent, attach still records evidenceRefs on the goal.
   */
  threads?: Pick<AgentSessionStore, 'getThread' | 'createThread'> & {
    setActiveGoalIds?(input: {
      resourceId: string;
      threadId: string;
      activeGoalIds: readonly string[];
      now: string;
    }): Promise<unknown>;
  };
  progress?: GoalProgressPorts;
};

export class GoalService {
  private readonly proposals: GoalProposalStore;

  constructor(private readonly deps: GoalServiceDeps) {
    this.proposals = deps.proposals ?? new MemoryGoalProposalStore();
  }

  async proposeCreate(input: {
    resourceId: string;
    draft: MarketingGoalCreateDraft;
    proposalId?: string;
    why?: string;
    now: string;
  }): Promise<MarketingGoalProposal> {
    return this.proposals.save(
      marketingGoalProposalSchema.parse({
        schemaVersion: MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION,
        proposalId: input.proposalId ?? `gprop:${randomUUID()}`,
        resourceId: input.resourceId,
        kind: 'create',
        create: input.draft,
        ...(input.why ? { why: input.why } : {}),
        createdAt: input.now,
      }),
    );
  }

  async proposeAttachWorks(input: {
    resourceId: string;
    goalId: string;
    workRefs: readonly string[];
    proposalId?: string;
    expectedRevision?: number;
    why?: string;
    now: string;
  }): Promise<MarketingGoalProposal> {
    return this.proposals.save(
      marketingGoalProposalSchema.parse({
        schemaVersion: MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION,
        proposalId: input.proposalId ?? `gprop:${randomUUID()}`,
        resourceId: input.resourceId,
        kind: 'attach_works',
        goalId: input.goalId,
        workRefs: [...input.workRefs],
        ...(input.expectedRevision !== undefined
          ? { expectedRevision: input.expectedRevision }
          : {}),
        ...(input.why ? { why: input.why } : {}),
        createdAt: input.now,
      }),
    );
  }

  async proposeStatusTransition(input: {
    resourceId: string;
    goalId: string;
    nextStatus: MarketingGoalStatus;
    expectedRevision: number;
    proposalId?: string;
    why?: string;
    now: string;
  }): Promise<MarketingGoalProposal> {
    return this.proposals.save(
      marketingGoalProposalSchema.parse({
        schemaVersion: MARKETING_GOAL_PROPOSAL_SCHEMA_VERSION,
        proposalId: input.proposalId ?? `gprop:${randomUUID()}`,
        resourceId: input.resourceId,
        kind: 'status_transition',
        goalId: input.goalId,
        nextStatus: input.nextStatus,
        expectedRevision: input.expectedRevision,
        ...(input.why ? { why: input.why } : {}),
        createdAt: input.now,
      }),
    );
  }

  async confirmProposal(input: {
    resourceId: string;
    proposalId: string;
    /** Optional goalId override for create confirm. */
    goalId?: string;
    /** Thread to mount activeGoalIds on attach/create confirm. */
    threadId?: string;
    now: string;
  }): Promise<{
    proposal: MarketingGoalProposal;
    goal: MarketingGoal;
  }> {
    const proposal = await this.proposals.get({
      resourceId: input.resourceId,
      proposalId: input.proposalId,
    });
    if (!proposal) {
      throw new MarketingGoalStoreError(
        'GOAL_NOT_FOUND',
        `Goal proposal ${input.proposalId} was not found.`,
        { proposalId: input.proposalId },
      );
    }

    if (proposal.kind === 'create') {
      const draft = proposal.create!;
      const goal = await this.deps.goals.create({
        goalId: input.goalId ?? `goal:${randomUUID()}`,
        resourceId: input.resourceId,
        objective: draft.objective,
        statement: draft.statement,
        priority: draft.priority,
        horizon: draft.horizon,
        evidenceRefs: draft.evidenceRefs,
        now: input.now,
      });
      if (input.threadId) {
        await this.mountGoalOnThread({
          resourceId: input.resourceId,
          threadId: input.threadId,
          goalId: goal.goalId,
          now: input.now,
        });
      }
      return { proposal, goal };
    }

    if (proposal.kind === 'status_transition') {
      const expected =
        proposal.expectedRevision ??
        (
          await this.requireGoal(input.resourceId, proposal.goalId!)
        ).revision;
      const goal = await this.deps.goals.transitionStatus({
        resourceId: input.resourceId,
        goalId: proposal.goalId!,
        expectedRevision: expected,
        nextStatus: proposal.nextStatus!,
        now: input.now,
      });
      return { proposal, goal };
    }

    // attach_works
    const current = await this.requireGoal(input.resourceId, proposal.goalId!);
    const expected = proposal.expectedRevision ?? current.revision;
    const evidenceRefs: AgentEvidenceRef[] = (proposal.workRefs ?? []).map(
      (workId) => ({ kind: 'attached_work', ref: workId }),
    );
    const goal = await this.deps.goals.appendEvidence({
      resourceId: input.resourceId,
      goalId: proposal.goalId!,
      expectedRevision: expected,
      evidenceRefs,
      now: input.now,
    });
    if (input.threadId) {
      await this.mountGoalOnThread({
        resourceId: input.resourceId,
        threadId: input.threadId,
        goalId: goal.goalId,
        now: input.now,
      });
    }
    return { proposal, goal };
  }

  async getGoal(input: {
    resourceId: string;
    goalId: string;
  }): Promise<MarketingGoal | null> {
    return this.deps.goals.get(input);
  }

  async listGoals(input: {
    resourceId: string;
    status?: MarketingGoalStatus;
    limit?: number;
  }): Promise<MarketingGoal[]> {
    return this.deps.goals.list(input);
  }

  async projectProgress(input: {
    resourceId: string;
    goalId: string;
  }): Promise<MarketingGoalProgress | null> {
    const goal = await this.deps.goals.get(input);
    if (!goal) return null;
    const deliveredWorks = this.deps.progress
      ? await this.deps.progress.listDeliveredWorks({
          resourceId: input.resourceId,
        })
      : [];
    const evidence = this.deps.progress
      ? await this.deps.progress.listOutcomeEvidence({
          resourceId: input.resourceId,
        })
      : [];
    return projectGoalProgress({ goal, deliveredWorks, evidence });
  }

  async primaryGoal(input: {
    resourceId: string;
  }): Promise<MarketingGoal | null> {
    const goals = await this.deps.goals.list({
      resourceId: input.resourceId,
      status: 'active',
      limit: 20,
    });
    return selectPrimaryGoal(goals);
  }

  private async requireGoal(
    resourceId: string,
    goalId: string,
  ): Promise<MarketingGoal> {
    const goal = await this.deps.goals.get({ resourceId, goalId });
    if (!goal) {
      throw new MarketingGoalStoreError(
        'GOAL_NOT_FOUND',
        `Marketing goal ${goalId} was not found.`,
        { goalId },
      );
    }
    return goal;
  }

  private async mountGoalOnThread(input: {
    resourceId: string;
    threadId: string;
    goalId: string;
    now: string;
  }): Promise<void> {
    const threads = this.deps.threads;
    if (!threads?.setActiveGoalIds) return;
    const thread = await threads.getThread({
      resourceId: input.resourceId,
      threadId: input.threadId,
    });
    if (!thread) return;
    if ((thread.activeGoalIds as readonly string[]).includes(input.goalId)) {
      return;
    }
    await threads.setActiveGoalIds({
      resourceId: input.resourceId,
      threadId: input.threadId,
      activeGoalIds: [...thread.activeGoalIds, input.goalId].slice(0, 50),
      now: input.now,
    });
  }
}
