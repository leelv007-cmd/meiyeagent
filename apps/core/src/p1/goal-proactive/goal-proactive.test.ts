/**
 * V31-24 Goal product surface + Proactive pipeline unit tests (TDD).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProactiveSignal } from '@meiye/contracts';

import { MemoryAgentSessionStore } from '../agent-session/memory-agent-session-store.js';
import {
  decideProactiveGate,
  PROACTIVE_FEATURE_FLAGS,
  PROACTIVE_KILL_SWITCH_KEYS,
} from './evidence-gate.js';
import { GoalService } from './goal-service.js';
import { projectGoalProgress, selectPrimaryGoal } from './goal-progress.js';
import { MemoryMarketingGoalStore } from './memory-goal-store.js';
import { MemoryOpportunityDecisionStore } from './memory-opportunity-decision-store.js';
import { MarketingGoalStoreError } from './goal-store.js';
import {
  buildCandidateId,
  detectCandidates,
  filterSignals,
  projectOpportunities,
} from './proactive-pipeline.js';
import { ProactiveService } from './proactive-service.js';
import { projectCampaignWeeklySlots } from './campaign-weekly-schedule.js';
import { GoalProactiveFoundationModule } from './foundation-module.js';
import { P1DomainError } from '../foundation/domain.js';

const TS = '2026-08-08T12:00:00.000Z';
const TS2 = '2026-08-08T13:00:00.000Z';

function signal(partial: {
  kind: ProactiveSignal['kind'];
  summary: string;
  goalId?: string;
  weight?: number;
  evidenceRefs?: ProactiveSignal['evidenceRefs'];
  resourceId?: string;
  observedAt?: string;
}): ProactiveSignal {
  return {
    resourceId: partial.resourceId ?? 'ws-1',
    observedAt: partial.observedAt ?? TS,
    evidenceRefs: partial.evidenceRefs ?? [
      { kind: partial.kind, ref: 'ev-1' },
    ],
    weight: partial.weight ?? 1,
    kind: partial.kind,
    summary: partial.summary,
    ...(partial.goalId ? { goalId: partial.goalId } : {}),
  } as unknown as ProactiveSignal;
}

// ─── Goal propose → confirm OCC ─────────────────────────────────────────────

test('goal create only lands after confirm; proposal alone does not write goal', async () => {
  const goals = new MemoryMarketingGoalStore();
  const service = new GoalService({ goals });

  const proposal = await service.proposeCreate({
    resourceId: 'ws-1',
    draft: {
      objective: 'inquiry',
      statement: '8 月头皮护理新客',
      priority: 'high',
      evidenceRefs: [{ kind: 'merchant_said', ref: 'msg-1' }],
    },
    proposalId: 'prop-create-1',
    now: TS,
  });
  assert.equal(proposal.kind, 'create');
  assert.equal((await goals.list({ resourceId: 'ws-1' })).length, 0);

  const confirmed = await service.confirmProposal({
    resourceId: 'ws-1',
    proposalId: 'prop-create-1',
    goalId: 'goal-1',
    now: TS,
  });
  assert.equal(confirmed.goal.goalId, 'goal-1');
  assert.equal(confirmed.goal.status, 'active');
  assert.equal(confirmed.goal.revision, 0);
  assert.equal((await goals.list({ resourceId: 'ws-1' })).length, 1);
});

test('status transition uses propose→confirm with revision OCC', async () => {
  const goals = new MemoryMarketingGoalStore();
  const service = new GoalService({ goals });
  await service.confirmProposal({
    resourceId: 'ws-1',
    proposalId: (
      await service.proposeCreate({
        resourceId: 'ws-1',
        draft: {
          objective: 'exposure',
          statement: 'IP 曝光',
          priority: 'normal',
          evidenceRefs: [],
        },
        proposalId: 'p-create',
        now: TS,
      })
    ).proposalId,
    goalId: 'goal-status',
    now: TS,
  });

  await service.proposeStatusTransition({
    resourceId: 'ws-1',
    goalId: 'goal-status',
    nextStatus: 'paused',
    expectedRevision: 0,
    proposalId: 'p-pause',
    now: TS2,
  });
  const paused = await service.confirmProposal({
    resourceId: 'ws-1',
    proposalId: 'p-pause',
    now: TS2,
  });
  assert.equal(paused.goal.status, 'paused');
  assert.equal(paused.goal.revision, 1);

  await service.proposeStatusTransition({
    resourceId: 'ws-1',
    goalId: 'goal-status',
    nextStatus: 'active',
    expectedRevision: 0, // stale
    proposalId: 'p-stale',
    now: TS2,
  });
  await assert.rejects(
    () =>
      service.confirmProposal({
        resourceId: 'ws-1',
        proposalId: 'p-stale',
        now: TS2,
      }),
    (error: unknown) =>
      error instanceof MarketingGoalStoreError &&
      error.code === 'GOAL_REVISION_CONFLICT' &&
      error.details.currentRevision === 1,
  );
});

test('attach works only associates after confirm; progress projects delivered + evidence', async () => {
  const goals = new MemoryMarketingGoalStore();
  const threads = new MemoryAgentSessionStore();
  await threads.createThread({
    resourceId: 'ws-1',
    threadId: 'thread-1',
    title: '会话',
    now: TS,
  });
  const service = new GoalService({
    goals,
    threads,
    progress: {
      listDeliveredWorks: () => [
        { workId: 'work-1', goalId: 'goal-attach', deliveredAt: TS },
        { workId: 'work-2', goalId: 'goal-other', deliveredAt: TS },
      ],
      listOutcomeEvidence: () => [
        {
          evidenceId: 'ev-1',
          goalId: 'goal-attach',
          observedAt: TS2,
        },
      ],
    },
  });

  await service.confirmProposal({
    resourceId: 'ws-1',
    proposalId: (
      await service.proposeCreate({
        resourceId: 'ws-1',
        draft: {
          objective: 'booking',
          statement: '预约目标',
          priority: 'high',
          evidenceRefs: [],
        },
        proposalId: 'p-c',
        now: TS,
      })
    ).proposalId,
    goalId: 'goal-attach',
    now: TS,
  });

  await service.proposeAttachWorks({
    resourceId: 'ws-1',
    goalId: 'goal-attach',
    workRefs: ['work-1', 'work-3'],
    proposalId: 'p-attach',
    expectedRevision: 0,
    now: TS2,
  });
  // Not confirmed yet — no evidenceRefs on goal.
  assert.equal(
    (await goals.get({ resourceId: 'ws-1', goalId: 'goal-attach' }))!
      .evidenceRefs.length,
    0,
  );

  const attached = await service.confirmProposal({
    resourceId: 'ws-1',
    proposalId: 'p-attach',
    threadId: 'thread-1',
    now: TS2,
  });
  assert.equal(attached.goal.evidenceRefs.length, 2);
  assert.equal(attached.goal.revision, 1);

  const thread = await threads.getThread({
    resourceId: 'ws-1',
    threadId: 'thread-1',
  });
  assert.deepEqual(thread?.activeGoalIds, ['goal-attach']);

  const progress = await service.projectProgress({
    resourceId: 'ws-1',
    goalId: 'goal-attach',
  });
  assert.equal(progress?.deliveredWorkCount, 1);
  assert.equal(progress?.evidenceCount, 1);
});

test('primary goal prefers high priority active', () => {
  const primary = selectPrimaryGoal([
    {
      schemaVersion: 'marketing-goal/v1',
      goalId: 'g-low',
      resourceId: 'ws-1',
      objective: 'custom',
      statement: 'low',
      priority: 'low',
      status: 'active',
      evidenceRefs: [],
      revision: 0,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      schemaVersion: 'marketing-goal/v1',
      goalId: 'g-high',
      resourceId: 'ws-1',
      objective: 'inquiry',
      statement: 'high',
      priority: 'high',
      status: 'active',
      evidenceRefs: [],
      revision: 0,
      createdAt: TS,
      updatedAt: TS,
    },
    {
      schemaVersion: 'marketing-goal/v1',
      goalId: 'g-done',
      resourceId: 'ws-1',
      objective: 'inquiry',
      statement: 'done',
      priority: 'high',
      status: 'completed',
      evidenceRefs: [],
      revision: 1,
      createdAt: TS,
      updatedAt: TS2,
    },
  ] as never);
  assert.equal(primary?.goalId, 'g-high');
});

test('progress projection never invents counts beyond delivered/evidence facts', () => {
  const progress = projectGoalProgress({
    goal: {
      schemaVersion: 'marketing-goal/v1',
      goalId: 'g1',
      resourceId: 'ws-1',
      objective: 'inquiry',
      statement: 's',
      priority: 'normal',
      status: 'active',
      evidenceRefs: [],
      revision: 0,
      createdAt: TS,
      updatedAt: TS,
    } as never,
    deliveredWorks: [],
    evidence: [{ evidenceId: 'e1', goalId: 'other', observedAt: TS }],
  });
  assert.equal(progress.deliveredWorkCount, 0);
  assert.equal(progress.evidenceCount, 0);
});

// ─── Evidence gate U13 ──────────────────────────────────────────────────────

test('evidence gate: threshold unset closes; allowlist opens; kill switch wins', () => {
  const unset = decideProactiveGate({
    resourceId: 'ws-1',
    config: {
      disableProactiveAgent: false,
      proactiveFeatureOn: true,
      workspaceAllowlisted: false,
      coverageThreshold: null,
    },
    denominator: 10,
    numerator: 8,
  });
  assert.equal(unset.open, false);
  assert.equal(unset.reason, 'threshold_unset');
  assert.equal(unset.observation.coverage, 0.8);

  const allow = decideProactiveGate({
    resourceId: 'ws-1',
    config: {
      disableProactiveAgent: false,
      proactiveFeatureOn: true,
      workspaceAllowlisted: true,
      coverageThreshold: null,
    },
    denominator: 0,
    numerator: 0,
  });
  assert.equal(allow.open, true);
  assert.equal(allow.reason, 'workspace_allowlist');

  const killed = decideProactiveGate({
    resourceId: 'ws-1',
    config: {
      disableProactiveAgent: true,
      proactiveFeatureOn: true,
      workspaceAllowlisted: true,
      coverageThreshold: 0.5,
    },
    denominator: 10,
    numerator: 10,
  });
  assert.equal(killed.open, false);
  assert.equal(killed.reason, 'kill_switch');

  assert.equal(PROACTIVE_FEATURE_FLAGS.proactiveOpportunity, 'proactive_opportunity_v1');
  assert.equal(
    PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent,
    'disable_proactive_agent',
  );
});

// ─── Proactive pipeline ─────────────────────────────────────────────────────

test('pipeline filters signals without evidence and ranks candidates', async () => {
  const decisions = new MemoryOpportunityDecisionStore();
  const signals: ProactiveSignal[] = [
    signal({
      kind: 'goal_stalled',
      summary: '目标 14 天无交付',
      goalId: 'goal-1',
      weight: 3,
    }),
    signal({
      kind: 'asset_accumulation',
      summary: '素材积累 5 张',
      weight: 2,
      evidenceRefs: [{ kind: 'asset', ref: 'a1' }],
    }),
    {
      kind: 'project_added',
      resourceId: 'ws-1',
      observedAt: TS,
      summary: 'no evidence — drop',
      evidenceRefs: [],
      weight: 9,
    } as unknown as ProactiveSignal,
  ];

  const filtered = filterSignals({ signals, now: TS });
  assert.equal(filtered.length, 2);
  const detected = detectCandidates({ signals: filtered, now: TS });
  assert.ok(detected.length >= 2);
  for (const candidate of detected) {
    assert.ok(candidate.evidenceRefs.length >= 1);
    assert.ok(candidate.reason.length > 0);
  }

  const open = await projectOpportunities({
    resourceId: 'ws-1',
    signals,
    now: TS,
    gateOpen: true,
    decisionStore: decisions,
  });
  assert.ok(open.length >= 1);
  assert.ok(open.every((row) => row.evidenceRefs.length >= 1));
  assert.ok(open.every((row) => row.status === 'proposed'));

  const closed = await projectOpportunities({
    resourceId: 'ws-1',
    signals,
    now: TS,
    gateOpen: false,
    decisionStore: decisions,
  });
  assert.deepEqual(closed, []);
});

test('accept is idempotent on candidateId and never produces paid side effects', async () => {
  const threads = new MemoryAgentSessionStore();
  const decisions = new MemoryOpportunityDecisionStore();
  let billingTouched = false;
  const service = new ProactiveService({
    decisions,
    threads,
    billingSideEffectPort: {
      reserveCredits: () => {
        billingTouched = true;
        return { reserved: true };
      },
    },
    defaultHarnessReleaseId: 'release-test',
  });

  const candidateId = buildCandidateId({
    resourceId: 'ws-1',
    signalKinds: ['goal_stalled'],
    goalId: 'goal-1',
    reason: '目标两周未推进',
  });

  const first = await service.acceptCandidate({
    resourceId: 'ws-1',
    candidateId,
    actorId: 'merchant-1',
    now: TS,
    reason: '目标两周未推进',
    evidenceRefs: [{ kind: 'goal_stalled', ref: 'goal-1' }],
    goalId: 'goal-1',
    threadId: 'thread-accept-1',
    runId: 'run-accept-1',
  });
  assert.equal(first.replayed, false);
  assert.equal(first.paidSideEffect, false);
  assert.equal(billingTouched, false);
  assert.equal(first.threadId, 'thread-accept-1');

  const run = await threads.getRun({
    resourceId: 'ws-1',
    runId: 'run-accept-1',
  });
  assert.equal(run?.durability, 'exit');
  assert.equal(run?.trigger, 'proactive_signal');
  assert.equal(run?.executionLink, undefined);

  const second = await service.acceptCandidate({
    resourceId: 'ws-1',
    candidateId,
    actorId: 'merchant-1',
    now: TS2,
    reason: '目标两周未推进',
    evidenceRefs: [{ kind: 'goal_stalled', ref: 'goal-1' }],
    goalId: 'goal-1',
    // Different thread/run ids — must replay original, not create another turn.
    threadId: 'thread-should-not-create',
    runId: 'run-should-not-create',
  });
  assert.equal(second.replayed, true);
  assert.equal(second.threadId, 'thread-accept-1');
  assert.equal(second.runId, 'run-accept-1');
  assert.equal(billingTouched, false);

  const runs = await threads.listRuns({
    resourceId: 'ws-1',
    threadId: 'thread-accept-1',
  });
  assert.equal(runs.length, 1);
});

test('dismiss then listSuggestions remembers decision after refresh/replay', async () => {
  const threads = new MemoryAgentSessionStore();
  const decisions = new MemoryOpportunityDecisionStore();
  const service = new ProactiveService({ decisions, threads });

  const signals: ProactiveSignal[] = [
    signal({
      kind: 'goal_stalled',
      summary: '目标停滞',
      goalId: 'goal-1',
      weight: 2,
    }),
  ];
  const config = {
    disableProactiveAgent: false,
    proactiveFeatureOn: true,
    workspaceAllowlisted: true,
    coverageThreshold: null as number | null,
  };

  const before = await service.listSuggestions({
    resourceId: 'ws-1',
    now: TS,
    config,
    signals,
  });
  assert.equal(before.suggestions.length, 1);
  const candidateId = before.suggestions[0]!.candidateId;

  await service.dismissCandidate({
    resourceId: 'ws-1',
    candidateId,
    actorId: 'merchant-1',
    now: TS2,
  });

  // Fresh listSuggestions call = refresh/replay.
  const after = await service.listSuggestions({
    resourceId: 'ws-1',
    now: TS2,
    config,
    signals,
  });
  assert.equal(after.suggestions.length, 0);
  const dismissed = after.history.find((row) => row.candidateId === candidateId);
  assert.equal(dismissed?.status, 'dismissed');
});

test('kill switch closes suggestions even with allowlist and signals', async () => {
  const service = new ProactiveService({
    decisions: new MemoryOpportunityDecisionStore(),
    threads: new MemoryAgentSessionStore(),
  });
  const projection = await service.listSuggestions({
    resourceId: 'ws-1',
    now: TS,
    config: {
      disableProactiveAgent: true,
      proactiveFeatureOn: true,
      workspaceAllowlisted: true,
      coverageThreshold: 0.1,
    },
    signals: [
      signal({ kind: 'merchant_hot_topic', summary: '商家热点' }),
    ],
  });
  assert.equal(projection.gate.open, false);
  assert.equal(projection.gate.reason, 'kill_switch');
  assert.deepEqual(projection.suggestions, []);
});

test('campaign weekly slots use single_work confirmation scope (V31-11 contract)', () => {
  const slots = projectCampaignWeeklySlots({
    campaignPlanRef: { id: 'plan-campaign', revision: 2 },
    horizonFrom: '2026-08-01T00:00:00.000Z',
    horizonUntil: '2026-08-22T00:00:00.000Z',
  });
  assert.ok(slots.length >= 3);
  for (const slot of slots) {
    assert.equal(slot.approvalScope, 'single_work');
    assert.equal(slot.campaignPlanRef.id, 'plan-campaign');
    assert.ok(slot.workOrdinal >= 1);
  }
});

// ─── Foundation module surface ──────────────────────────────────────────────

function memoryAdminConfigReader(entries: Record<string, unknown>) {
  return {
    get: async (
      _scope: 'global' | 'workspace',
      _workspaceId: string,
      key: string,
    ) => ({ value: entries[key] ?? null }),
  };
}

test('foundation module get_idle_projection wires primary goal + suggestions', async () => {
  const goals = new MemoryMarketingGoalStore();
  const threads = new MemoryAgentSessionStore();
  const goalService = new GoalService({ goals, threads });
  await goalService.confirmProposal({
    resourceId: 'ws-1',
    proposalId: (
      await goalService.proposeCreate({
        resourceId: 'ws-1',
        draft: {
          objective: 'inquiry',
          statement: '本月新客',
          priority: 'high',
          evidenceRefs: [],
        },
        proposalId: 'p1',
        now: TS,
      })
    ).proposalId,
    goalId: 'goal-idle',
    now: TS,
  });

  const proactive = new ProactiveService({
    decisions: new MemoryOpportunityDecisionStore(),
    threads,
    configReader: memoryAdminConfigReader({
      [PROACTIVE_FEATURE_FLAGS.proactiveOpportunity]: true,
    }),
  });
  const module = new GoalProactiveFoundationModule(goalService, proactive);

  const idle = (await module.query({
    context: {
      workspaceId: 'ws-1',
      userId: 'u1',
      actor: 'owner',
      correlationId: 'c1',
    },
    input: {
      action: 'get_idle_projection',
      payload: {
        now: TS,
        signals: [
          signal({
            kind: 'goal_stalled',
            summary: '目标未推进',
            goalId: 'goal-idle',
          }),
        ],
      },
    },
  })) as {
    primaryGoal: { goalId: string } | null;
    suggestions: { reason: string; evidenceRefs: unknown[] }[];
  };

  assert.equal(idle.primaryGoal?.goalId, 'goal-idle');
  assert.ok(idle.suggestions.length >= 1);
  assert.ok(idle.suggestions[0]!.evidenceRefs.length >= 1);
  assert.ok(idle.suggestions[0]!.reason.includes('目标'));
});

test('query rejects client-supplied config; admin-config kill switch stays authoritative', async () => {
  const goals = new MemoryMarketingGoalStore();
  const threads = new MemoryAgentSessionStore();
  const goalService = new GoalService({ goals, threads });
  const proactive = new ProactiveService({
    decisions: new MemoryOpportunityDecisionStore(),
    threads,
    configReader: memoryAdminConfigReader({
      [PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent]: true,
    }),
  });
  const module = new GoalProactiveFoundationModule(goalService, proactive);

  const projection = (await module.query({
    context: {
      workspaceId: 'ws-1',
      userId: 'u1',
      actor: 'owner',
      correlationId: 'c1',
    },
    input: {
      action: 'get_idle_projection',
      payload: {
        now: TS,
        signals: [signal({ kind: 'goal_stalled', summary: '目标未推进' })],
      },
    },
  })) as { gate: { open: boolean; reason: string }; suggestions: unknown[] };

  assert.equal(projection.gate.open, false);
  assert.equal(projection.gate.reason, 'kill_switch');
  assert.deepEqual(projection.suggestions, []);
});

test('query rejects payload config: allowlist spoof is denied by schema', async () => {
  const goals = new MemoryMarketingGoalStore();
  const threads = new MemoryAgentSessionStore();
  const goalService = new GoalService({ goals, threads });
  const proactive = new ProactiveService({
    decisions: new MemoryOpportunityDecisionStore(),
    threads,
    configReader: memoryAdminConfigReader({}),
  });
  const module = new GoalProactiveFoundationModule(goalService, proactive);

  await assert.rejects(
    () =>
      module.query({
        context: {
          workspaceId: 'ws-1',
          userId: 'u1',
          actor: 'owner',
          correlationId: 'c1',
        },
        input: {
          action: 'get_idle_projection',
          payload: {
            now: TS,
            config: {
              disableProactiveAgent: false,
              proactiveFeatureOn: true,
              workspaceAllowlisted: true,
              coverageThreshold: null,
            },
            signals: [signal({ kind: 'goal_stalled', summary: '目标未推进' })],
          },
        },
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});
