/**
 * Proactive opportunity pipeline (V31-24 / V3.1 §25).
 *
 * Signals (owned data only) → cheap deterministic filter → Agent ranking
 * → OpportunityCandidate derived projection → merchant proposal.
 *
 * No background infinite LLM loop. Candidate body is never persisted as an
 * aggregate; decisions overlay via OpportunityDecisionStore.
 */

import { createHash } from 'node:crypto';

import {
  OPPORTUNITY_CANDIDATE_SCHEMA_VERSION,
  opportunityCandidateSchema,
  type OpportunityCandidate,
  type OpportunityDecision,
  type ProactiveSignal,
} from '@meiye/contracts';

import type { OpportunityDecisionStore } from './opportunity-decision-store.js';

export type DetectedCandidate = {
  candidateId: string;
  resourceId: string;
  goalId?: string;
  reason: string;
  evidenceRefs: OpportunityCandidate['evidenceRefs'];
  signalKinds: string[];
  expiresAt?: string;
  rankScore: number;
  createdAt: string;
};

export type ProactiveRankingPort = {
  /**
   * Optional Agent relevance sort. Default = deterministic by weight/score.
   * Must be pure ranking — no paid side effects.
   */
  rank(input: {
    resourceId: string;
    candidates: readonly DetectedCandidate[];
  }): Promise<DetectedCandidate[]> | DetectedCandidate[];
};

export class DeterministicProactiveRanker implements ProactiveRankingPort {
  async rank(input: {
    resourceId: string;
    candidates: readonly DetectedCandidate[];
  }): Promise<DetectedCandidate[]> {
    return [...input.candidates].sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }
      return left.candidateId.localeCompare(right.candidateId);
    });
  }
}

/** Cheap deterministic filters before ranking (no LLM). */
export function filterSignals(input: {
  signals: readonly ProactiveSignal[];
  now: string;
  /** Drop signals older than this many ms (default 30 days). */
  maxAgeMs?: number;
}): ProactiveSignal[] {
  const maxAgeMs = input.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
  const nowMs = Date.parse(input.now);
  return input.signals.filter((signal) => {
    if (signal.evidenceRefs.length === 0) return false;
    const age = nowMs - Date.parse(signal.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return false;
    return true;
  });
}

export function buildCandidateId(input: {
  resourceId: string;
  signalKinds: readonly string[];
  goalId?: string;
  reason: string;
}): string {
  const material = [
    input.resourceId,
    input.goalId ?? '',
    [...input.signalKinds].sort().join(','),
    input.reason,
  ].join('|');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 24);
  return `cand:${digest}`;
}

/**
 * Group filtered signals into candidate drafts. One candidate per
 * (resourceId, goalId?, primary signal kind cluster).
 */
export function detectCandidates(input: {
  signals: readonly ProactiveSignal[];
  now: string;
  /** Default expiry: 7 days from now. */
  ttlMs?: number;
}): DetectedCandidate[] {
  const ttlMs = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.parse(input.now) + ttlMs).toISOString();
  const groups = new Map<string, ProactiveSignal[]>();

  for (const signal of input.signals) {
    const key = `${signal.resourceId}::${signal.goalId ?? ''}::${signal.kind}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(signal);
    groups.set(key, bucket);
  }

  const candidates: DetectedCandidate[] = [];
  for (const bucket of groups.values()) {
    const head = bucket[0]!;
    const evidenceRefs = dedupeEvidence(
      bucket.flatMap((item) => item.evidenceRefs),
    );
    if (evidenceRefs.length === 0) continue;
    const reason = bucket.map((item) => item.summary).join('；').slice(0, 2000);
    const signalKinds = [...new Set(bucket.map((item) => item.kind))];
    const rankScore = bucket.reduce((sum, item) => sum + item.weight, 0);
    const candidateId = buildCandidateId({
      resourceId: head.resourceId,
      signalKinds,
      goalId: head.goalId,
      reason,
    });
    candidates.push({
      candidateId,
      resourceId: head.resourceId,
      ...(head.goalId ? { goalId: head.goalId } : {}),
      reason,
      evidenceRefs,
      signalKinds,
      expiresAt,
      rankScore,
      createdAt: input.now,
    });
  }
  return candidates;
}

function dedupeEvidence(
  refs: OpportunityCandidate['evidenceRefs'],
): OpportunityCandidate['evidenceRefs'] {
  const seen = new Set<string>();
  const out: OpportunityCandidate['evidenceRefs'] = [];
  for (const ref of refs) {
    const key = `${ref.kind}::${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out.slice(0, 50);
}

export function projectCandidateStatus(input: {
  candidate: DetectedCandidate;
  decision: OpportunityDecision | null;
  now: string;
}): OpportunityCandidate['status'] {
  if (input.decision?.decision === 'accepted') return 'accepted';
  if (input.decision?.decision === 'dismissed') return 'dismissed';
  if (
    input.candidate.expiresAt &&
    Date.parse(input.candidate.expiresAt) <= Date.parse(input.now)
  ) {
    return 'expired';
  }
  return 'proposed';
}

export function toOpportunityCandidate(input: {
  candidate: DetectedCandidate;
  decision: OpportunityDecision | null;
  now: string;
}): OpportunityCandidate {
  return opportunityCandidateSchema.parse({
    schemaVersion: OPPORTUNITY_CANDIDATE_SCHEMA_VERSION,
    candidateId: input.candidate.candidateId,
    resourceId: input.candidate.resourceId,
    ...(input.candidate.goalId ? { goalId: input.candidate.goalId } : {}),
    reason: input.candidate.reason,
    evidenceRefs: input.candidate.evidenceRefs,
    signalKinds: input.candidate.signalKinds,
    ...(input.candidate.expiresAt
      ? { expiresAt: input.candidate.expiresAt }
      : {}),
    status: projectCandidateStatus(input),
    rankScore: input.candidate.rankScore,
    createdAt: input.candidate.createdAt,
  });
}

export type ProjectOpportunitiesInput = {
  resourceId: string;
  signals: readonly ProactiveSignal[];
  now: string;
  /** When false, return empty candidates (gate closed) but keep observation path. */
  gateOpen: boolean;
  decisionStore: OpportunityDecisionStore;
  ranker?: ProactiveRankingPort;
  maxCandidates?: number;
};

export async function projectOpportunities(
  input: ProjectOpportunitiesInput,
): Promise<OpportunityCandidate[]> {
  if (!input.gateOpen) return [];

  const filtered = filterSignals({
    signals: input.signals.filter(
      (signal) => signal.resourceId === input.resourceId,
    ),
    now: input.now,
  });
  const detected = detectCandidates({ signals: filtered, now: input.now });
  const ranker = input.ranker ?? new DeterministicProactiveRanker();
  const ranked = await ranker.rank({
    resourceId: input.resourceId,
    candidates: detected,
  });

  const projected: OpportunityCandidate[] = [];
  for (const candidate of ranked) {
    const decision = await input.decisionStore.latestForCandidate({
      resourceId: input.resourceId,
      candidateId: candidate.candidateId,
    });
    projected.push(
      toOpportunityCandidate({
        candidate,
        decision,
        now: input.now,
      }),
    );
  }

  // Merchant-facing list: proposed first (by rank), then others for history.
  const limit = input.maxCandidates ?? 10;
  const proposed = projected.filter((row) => row.status === 'proposed');
  return proposed.slice(0, limit);
}

/**
 * Full projection including accepted/dismissed/expired — for refresh/replay
 * memory tests (remembers ignore/accept after reload).
 */
export async function projectAllOpportunityStates(
  input: ProjectOpportunitiesInput,
): Promise<OpportunityCandidate[]> {
  if (!input.gateOpen) return [];
  const filtered = filterSignals({
    signals: input.signals.filter(
      (signal) => signal.resourceId === input.resourceId,
    ),
    now: input.now,
  });
  const detected = detectCandidates({ signals: filtered, now: input.now });
  const out: OpportunityCandidate[] = [];
  for (const candidate of detected) {
    const decision = await input.decisionStore.latestForCandidate({
      resourceId: input.resourceId,
      candidateId: candidate.candidateId,
    });
    out.push(toOpportunityCandidate({ candidate, decision, now: input.now }));
  }
  return out;
}
