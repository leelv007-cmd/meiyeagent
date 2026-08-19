/**
 * V31-10: PlanCompiler emits plan.created / plan.revised into Projector,
 * payload projects through Workstream Living Plan UI (five sections).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { agentSemanticEventToWire } from '@meiye/contracts';

import {
  AgentSemanticEventProjector,
  MemoryAgentSemanticEventStore,
} from '../agent-semantic-events/index.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import {
  PlanCompiler,
  createFixturePlanCompilerPorts,
} from './plan-compiler.js';
import {
  buildPlanLivingPlanEventPayload,
  planEventTypeForRevision,
  planSemanticEventId,
} from './plan-semantic-event.js';
import type { PlanProposal } from './turn-contracts.js';

const TS = '2026-08-08T12:00:00.000Z';

function baseProposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    goalNarrative: '填补明天下午空档，推奶油风美甲',
    whyNow: '明天下午还有两个空档',
    recommendedDeliverables: [
      {
        carrier: 'note',
        platform: 'xiaohongshu',
        quantity: 6,
        purpose: '案例图文',
      },
      {
        carrier: 'copy',
        platform: 'wechat_moments',
        quantity: 1,
        purpose: '短文案',
      },
    ],
    expressionStrategy: {
      voice: '专业温和',
      cta: '预约 CTA',
      promotionIntensity: 'soft',
    },
    factIntentions: ['门店项目'],
    authorityIntentions: ['identity:identity-1@1', 'brief:brief-1@1'],
    assetIntentions: ['authorized_case'],
    assumptions: [{ key: 'tone', statement: '少一点硬广', risk: 'low' }],
    ...overrides,
  };
}

async function loadLivingPlanUiModel(): Promise<{
  parseLivingPlanEventPayload: (payload: unknown) => {
    planId: string;
    revision: number;
  } | null;
  projectLivingPlanView: (facts: {
    planId: string;
    revision: number;
    goal: { summary: string };
    deliverables: unknown[];
    expression: Record<string, unknown>;
    factsAssets: Record<string, unknown>;
    costDuration: Record<string, unknown>;
  }) => { sections: Array<{ key: string; body: string }> };
  LIVING_PLAN_SECTION_KEYS: readonly string[];
}> {
  const uiPath = fileURLToPath(
    new URL(
      '../../../../../mkfast-template-main/src/product/agent-workbench/plan/living-plan-model.ts',
      import.meta.url,
    ),
  );
  return import(pathToFileURL(uiPath).href) as Promise<{
    parseLivingPlanEventPayload: (payload: unknown) => {
      planId: string;
      revision: number;
    } | null;
    projectLivingPlanView: (facts: {
      planId: string;
      revision: number;
      goal: { summary: string };
      deliverables: unknown[];
      expression: Record<string, unknown>;
      factsAssets: Record<string, unknown>;
      costDuration: Record<string, unknown>;
    }) => { sections: Array<{ key: string; body: string }> };
    LIVING_PLAN_SECTION_KEYS: readonly string[];
  }>;
}

test('planEventTypeForRevision: r1 created, r>1 revised', () => {
  assert.equal(planEventTypeForRevision(1), 'plan.created');
  assert.equal(planEventTypeForRevision(2), 'plan.revised');
});

test('compilePlan projects plan.created; adjust projects plan.revised (idempotent eventId)', async () => {
  const store = new MemoryMarketingPlanStore();
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: projector,
  });

  const compiled = await compiler.compile({
    workspaceId: 'ws-1',
    resourceId: 'ws-1',
    threadId: 'thread-1',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    planId: 'plan-emit-1',
    livingPlanBilling: {
      creditCost: 38,
      balanceCredits: 126,
      failureRefundsCredits: true,
      durationLabel: '约 8–12 分钟',
    },
  });

  assert.equal(compiled.revision.revision, 1);
  const created = await eventStore.listByThread({
    resourceId: 'ws-1',
    threadId: 'thread-1',
  });
  assert.equal(created.length, 1);
  assert.equal(created[0]?.eventType, 'plan.created');
  assert.deepEqual(
    (created[0]?.payload as { factsAssets: Record<string, unknown> })
      .factsAssets,
    {
      factsSummary: '已绑定 1 项事实用法',
      authoritySummary: '已绑定 2 项执行权威',
      assetsSummary: '已绑定 1 项素材用法',
    },
  );
  assert.equal(
    created[0]?.eventId,
    planSemanticEventId('plan-emit-1', 1),
  );

  const adjusted = await compiler.adjust({
    workspaceId: 'ws-1',
    resourceId: 'ws-1',
    threadId: 'thread-1',
    existingPlanId: 'plan-emit-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 4,
          purpose: '案例图文',
        },
      ],
    }),
    patch: {
      summary: '只做小红书，减到 4 页',
      instructions: 'quantity 4, drop moments',
    },
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    livingPlanBilling: {
      creditCost: 24,
      balanceCredits: 126,
      failureRefundsCredits: true,
    },
  });
  assert.equal(adjusted.revision.revision, 2);

  const all = await eventStore.listByThread({
    resourceId: 'ws-1',
    threadId: 'thread-1',
  });
  assert.equal(all.length, 2);
  assert.equal(all[1]?.eventType, 'plan.revised');
  const payload = all[1]?.payload as Record<string, unknown>;
  assert.equal(payload.adjustmentSummary, '只做小红书，减到 4 页');

  // Idempotent re-project of same eventId does not invent a third row.
  const replay = await projector.project({
    eventId: planSemanticEventId('plan-emit-1', 2),
    threadId: 'thread-1',
    resourceId: 'ws-1',
    contextRole: 'included',
    sourceDomain: 'marketing_plan_revision',
    sourceEntityId: 'plan-emit-1',
    sourceRevision: '2',
    correlationId: 'thread-1',
    eventType: 'plan.revised',
    payload: all[1]!.payload,
    occurredAt: TS,
  });
  assert.equal(replay.replayed, true);
  assert.equal(
    (
      await eventStore.listByThread({
        resourceId: 'ws-1',
        threadId: 'thread-1',
      })
    ).length,
    2,
  );
});

test('contract: Core-emitted payload → UI living-plan-model → five sections ready', async () => {
  const store = new MemoryMarketingPlanStore();
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: projector,
  });

  await compiler.compile({
    workspaceId: 'ws-ui',
    threadId: 'thread-ui',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    planId: 'plan-ui-1',
    livingPlanBilling: {
      creditCost: 38,
      balanceCredits: 126,
      failureRefundsCredits: true,
      durationLabel: '约 8–12 分钟',
    },
  });

  const events = await eventStore.listByThread({
    resourceId: 'ws-ui',
    threadId: 'thread-ui',
  });
  assert.equal(events.length, 1);
  const wire = agentSemanticEventToWire(events[0]!);

  const ui = await loadLivingPlanUiModel();
  const facts = ui.parseLivingPlanEventPayload(wire.payload);
  assert.ok(facts, 'UI parseLivingPlanEventPayload must accept Core payload');
  assert.equal(facts.planId, 'plan-ui-1');
  assert.equal(facts.revision, 1);

  const view = ui.projectLivingPlanView(facts as never);
  assert.deepEqual(
    view.sections.map((section) => section.key),
    [...ui.LIVING_PLAN_SECTION_KEYS],
  );
  assert.equal(view.sections.length, 5);
  assert.match(view.sections[0]!.body, /奶油风美甲|空档/);
  assert.match(view.sections[1]!.body, /6|图文|xiaohongshu|小红书|note/i);
  assert.ok(view.sections[2]);
  assert.ok(view.sections[3]);
  assert.match(view.sections[4]!.body, /38|报价|积分|分/);
});

test('buildPlanLivingPlanEventPayload never invents creditCost without billing overlay', () => {
  const store = new MemoryMarketingPlanStore();
  // Use a minimal in-memory compile path via builder only after a real revision.
  // Fixture ports produce quoteRef without amounts.
  return (async () => {
    const compiler = new PlanCompiler({
      store,
      ports: createFixturePlanCompilerPorts(),
    });
    const result = await compiler.compile({
      workspaceId: 'ws-2',
      threadId: 'thread-2',
      proposal: baseProposal(),
      intentRevision: 1,
      contextBundleId: 'b',
      contextRevision: '1',
      harnessReleaseId: 'r',
      now: TS,
      planId: 'plan-no-bill',
    });
    const payload = buildPlanLivingPlanEventPayload({
      revision: result.revision,
      readiness: result.readiness,
    });
    const cost = payload.costDuration as Record<string, unknown>;
    assert.equal(cost.creditCost, undefined);
    assert.ok(typeof cost.durationLabel === 'string');
  })();
});

test('production assembly source binds planCompiler to semantic projector', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const source = readFileSync(
    resolve(process.cwd(), 'src/assembly/api-runtime.ts'),
    'utf8',
  );
  assert.match(source, /planCompiler\.bindSemanticEventProjector/u);
  assert.match(source, /AgentSemanticEventProjector/u);
  assert.match(source, /planCompiler,/u);
  // V31-40: outbox consumer wired on the same recovery poll path family.
  assert.match(source, /PlanEventOutboxDispatcher/u);
  assert.match(source, /PlanEventOutboxLoop/u);
  assert.match(source, /planEventOutboxLoop\.start/u);
});
