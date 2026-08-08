/**
 * Proactive opportunity service (V31-24 / V3.1 §25 exit gate).
 *
 * Accept creates exactly one Thread turn (durability=exit) and never paid
 * side effects. Dismiss / accept decisions are append-only and survive
 * refresh/replay via OpportunityDecisionStore.
 */

import { randomUUID } from 'node:crypto';

import type {
  OpportunityCandidate,
  OpportunityDecision,
  ProactiveSignal,
} from '@meiye/contracts';

import type { AgentSessionStore } from '../agent-session/agent-session-store.js';
import {
  decideProactiveGate,
  resolveProactiveGateConfig,
  type AdminConfigHeadReader,
  type EvidenceCoverageObservation,
  type ProactiveGateConfig,
  type ProactiveGateDecision,
} from './evidence-gate.js';
import type { OpportunityDecisionStore } from './opportunity-decision-store.js';
import {
  projectAllOpportunityStates,
  projectOpportunities,
  type DetectedCandidate,
  type ProactiveRankingPort,
  type ProjectOpportunitiesInput,
} from './proactive-pipeline.js';

/** Ports used only for observation / gate denominator — never write billing. */
export type ProactiveEvidenceCoveragePort = {
  countDelivered(input: { resourceId: string }): Promise<number> | number;
  countWithEvidence(input: { resourceId: string }): Promise<number> | number;
};

export type ProactiveSignalSource = {
  listSignals(input: {
    resourceId: string;
    now: string;
  }): Promise<readonly ProactiveSignal[]> | readonly ProactiveSignal[];
};

export type ProactiveServiceDeps = {
  decisions: OpportunityDecisionStore;
  threads: Pick<AgentSessionStore, 'createThread' | 'startWriteTurn' | 'getThread'>;
  /**
   * Optional admin-config reader for flag / kill switch / threshold.
   * When omitted, config is injected via listSuggestions input.
   */
  configReader?: AdminConfigHeadReader;
  coverage?: ProactiveEvidenceCoveragePort;
  signals?: ProactiveSignalSource;
  ranker?: ProactiveRankingPort;
  /**
   * Constructive seam for zero-paid-side-effect tests: any billing touch must
   * go through this port. Production leaves it undefined (unused on accept).
   */
  billingSideEffectPort?: {
    reserveCredits(input: unknown): Promise<unknown> | unknown;
  };
  defaultHarnessReleaseId?: string;
};

export type IdleProactiveProjection = {
  gate: ProactiveGateDecision;
  suggestions: OpportunityCandidate[];
  /** All known candidate states (including dismissed/accepted) for replay checks. */
  history: OpportunityCandidate[];
};

export class ProactiveService {
  constructor(private readonly deps: ProactiveServiceDeps) {}

  async resolveGate(input: {
    resourceId: string;
    config?: ProactiveGateConfig;
  }): Promise<ProactiveGateDecision> {
    const config =
      input.config ??
      (this.deps.configReader
        ? await resolveProactiveGateConfig(
            this.deps.configReader,
            input.resourceId,
          )
        : {
            disableProactiveAgent: false,
            proactiveFeatureOn: true,
            workspaceAllowlisted: false,
            coverageThreshold: null,
          });

    const denominator = this.deps.coverage
      ? await this.deps.coverage.countDelivered({
          resourceId: input.resourceId,
        })
      : 0;
    const numerator = this.deps.coverage
      ? await this.deps.coverage.countWithEvidence({
          resourceId: input.resourceId,
        })
      : 0;

    return decideProactiveGate({
      resourceId: input.resourceId,
      config,
      denominator,
      numerator,
    });
  }

  async listSuggestions(input: {
    resourceId: string;
    now: string;
    config?: ProactiveGateConfig;
    signals?: readonly ProactiveSignal[];
    maxCandidates?: number;
  }): Promise<IdleProactiveProjection> {
    const gate = await this.resolveGate({
      resourceId: input.resourceId,
      config: input.config,
    });
    const signals =
      input.signals ??
      (this.deps.signals
        ? await this.deps.signals.listSignals({
            resourceId: input.resourceId,
            now: input.now,
          })
        : []);

    const base: ProjectOpportunitiesInput = {
      resourceId: input.resourceId,
      signals,
      now: input.now,
      gateOpen: gate.open,
      decisionStore: this.deps.decisions,
      ranker: this.deps.ranker,
      maxCandidates: input.maxCandidates,
    };

    const suggestions = await projectOpportunities(base);
    const history = await projectAllOpportunityStates(base);
    return { gate, suggestions, history };
  }

  /**
   * Accept a candidate: append decision (idempotent on candidateId) and open
   * one exit-durability Thread turn. Never calls billing / reservation.
   */
  async acceptCandidate(input: {
    resourceId: string;
    candidateId: string;
    actorId: string;
    now: string;
    reason: string;
    evidenceRefs: OpportunityCandidate['evidenceRefs'];
    goalId?: string;
    signalKinds?: readonly string[];
    /** When replaying accept, pass the same candidate createdAt. */
    candidateCreatedAt?: string;
    decisionId?: string;
    threadId?: string;
    runId?: string;
    harnessReleaseId?: string;
  }): Promise<{
    decision: OpportunityDecision;
    replayed: boolean;
    threadId: string;
    runId: string;
    /** Always false — constructive guarantee for exit-gate tests. */
    paidSideEffect: false;
  }> {
    // Constructive guard: accept path must never touch billing.
    if (this.deps.billingSideEffectPort) {
      // Intentionally do not call reserveCredits — presence is for negative tests.
    }

    const existing = await this.deps.decisions.latestForCandidate({
      resourceId: input.resourceId,
      candidateId: input.candidateId,
    });
    if (existing?.decision === 'accepted' && existing.threadId) {
      return {
        decision: existing,
        replayed: true,
        threadId: existing.threadId,
        runId: existing.runId ?? '',
        paidSideEffect: false,
      };
    }
    if (existing?.decision === 'dismissed') {
      throw new Error(
        `Candidate ${input.candidateId} was already dismissed and cannot be accepted.`,
      );
    }

    const threadId = input.threadId ?? `thread:proactive:${randomUUID()}`;
    const runId = input.runId ?? `run:proactive:${randomUUID()}`;
    const harnessReleaseId =
      input.harnessReleaseId ??
      this.deps.defaultHarnessReleaseId ??
      'harness-release:proactive-default';

    let thread = await this.deps.threads.getThread({
      resourceId: input.resourceId,
      threadId,
    });
    if (!thread) {
      thread = await this.deps.threads.createThread({
        resourceId: input.resourceId,
        threadId,
        title: input.reason.slice(0, 200) || '主动建议',
        now: input.now,
        activeGoalIds: input.goalId ? [input.goalId] : [],
      });
    }

    const turn = await this.deps.threads.startWriteTurn({
      resourceId: input.resourceId,
      threadId: thread.threadId,
      expectedSessionRevision: thread.sessionRevision,
      runId,
      trigger: 'proactive_signal',
      harnessReleaseId,
      now: input.now,
    });

    // durability must be exit — no paid execution link on accept.
    if (turn.run.durability !== 'exit') {
      throw new Error('Proactive accept must open an exit-durability turn.');
    }
    if (turn.run.executionLink) {
      throw new Error(
        'Proactive accept must not create executionLink (paid side effect).',
      );
    }

    const appended = await this.deps.decisions.append({
      decisionId: input.decisionId ?? `odec:${randomUUID()}`,
      candidateId: input.candidateId,
      resourceId: input.resourceId,
      actorId: input.actorId,
      decision: 'accepted',
      decidedAt: input.now,
      threadId: turn.thread.threadId,
      runId: turn.run.runId,
    });

    return {
      decision: appended.decision,
      replayed: appended.replayed,
      threadId: turn.thread.threadId,
      runId: turn.run.runId,
      paidSideEffect: false,
    };
  }

  async dismissCandidate(input: {
    resourceId: string;
    candidateId: string;
    actorId: string;
    now: string;
    decisionId?: string;
  }): Promise<{ decision: OpportunityDecision; replayed: boolean }> {
    const existing = await this.deps.decisions.latestForCandidate({
      resourceId: input.resourceId,
      candidateId: input.candidateId,
    });
    if (existing?.decision === 'accepted') {
      throw new Error(
        `Candidate ${input.candidateId} was already accepted and cannot be dismissed.`,
      );
    }
    if (existing?.decision === 'dismissed') {
      return { decision: existing, replayed: true };
    }
    return this.deps.decisions.append({
      decisionId: input.decisionId ?? `odec:${randomUUID()}`,
      candidateId: input.candidateId,
      resourceId: input.resourceId,
      actorId: input.actorId,
      decision: 'dismissed',
      decidedAt: input.now,
    });
  }
}

export type { DetectedCandidate, EvidenceCoverageObservation };
