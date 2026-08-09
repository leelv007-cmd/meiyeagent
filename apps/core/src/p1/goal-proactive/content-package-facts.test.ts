/**
 * ContentPackage coverage + signal projection contracts (V31-24 wiring fix).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContentPackageEvidenceCoveragePort,
  deriveContentPackageSignals,
  isDeliveredContentPackage,
  isPublishedContentPackage,
  packageHasActiveOutcomeEvidence,
  projectActiveOwnedResultSignals,
  projectEvidenceCoverageCounts,
  type OwnedContentPackageFact,
} from './content-package-facts.js';
import { decideProactiveGate } from './evidence-gate.js';
import { filterSignals as pipelineFilter } from './proactive-pipeline.js';
import { ProactiveService } from './proactive-service.js';
import { MemoryOpportunityDecisionStore } from './memory-opportunity-decision-store.js';
import { MemoryAgentSessionStore } from '../agent-session/memory-agent-session-store.js';
import { MemoryMarketingGoalStore } from './memory-goal-store.js';
import { OwnedDataProactiveSignalSource } from './owned-signal-source.js';

const TS = '2026-08-08T12:00:00.000Z';
const OLD = '2026-07-20T12:00:00.000Z';
/** Within 3-day unpublished threshold and 1-day post-publish grace. */
const RECENT = '2026-08-08T06:00:00.000Z';

function pkg(
  partial: Partial<OwnedContentPackageFact> &
    Pick<OwnedContentPackageFact, 'id' | 'status'>,
): OwnedContentPackageFact {
  return {
    workspaceId: 'ws-1',
    updatedAt: OLD,
    createdAt: OLD,
    ...partial,
  };
}

test('delivered = usable statuses only (review_ready | accepted)', () => {
  assert.equal(isDeliveredContentPackage('review_ready'), true);
  assert.equal(isDeliveredContentPackage('accepted'), true);
  assert.equal(isDeliveredContentPackage('generating'), false);
  assert.equal(isDeliveredContentPackage('draft'), false);
  assert.equal(isDeliveredContentPackage('cancelled'), false);
});

test('coverage projection: denominator delivered, numerator with active evidence', () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-1',
      status: 'review_ready',
      resultSignals: [
        {
          id: 'sig-1',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 2,
          status: 'active',
        },
      ],
    }),
    pkg({
      id: 'cp-2',
      status: 'accepted',
      // withdrawn only — does not count
      resultSignals: [
        {
          id: 'sig-w',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 2,
          status: 'withdrawn',
        },
      ],
    }),
    pkg({
      id: 'cp-3',
      status: 'generating', // not delivered
      resultSignals: [
        {
          id: 'sig-x',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 1,
          status: 'active',
        },
      ],
    }),
    pkg({
      id: 'cp-4',
      status: 'review_ready',
      resultSignals: [
        {
          id: 'sig-old',
          kind: 'inquiry',
          occurredAt: OLD,
          contentPackageRevision: 1,
          status: 'active',
        },
        {
          id: 'sig-new',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 2,
          status: 'active',
          supersedesSignalId: 'sig-old',
        },
      ],
    }),
  ];

  const counts = projectEvidenceCoverageCounts({
    resourceId: 'ws-1',
    packages,
  });
  // delivered: cp-1, cp-2, cp-4
  assert.equal(counts.denominator, 3);
  // with active evidence: cp-1 (active), cp-4 (active after supersede), not cp-2
  assert.equal(counts.numerator, 2);

  const active = projectActiveOwnedResultSignals(
    packages.find((row) => row.id === 'cp-4')!.resultSignals!,
  );
  assert.equal(active.length, 1);
  assert.equal(active[0]!.id, 'sig-new');
});

test('V31-19: quarantined `unknown` revision rows are not provable evidence', () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-legacy',
      status: 'accepted',
      // Backfilled by the V31-19 migration: the exact consumed revision could
      // not be proven, so this row must not answer "has outcome evidence".
      resultSignals: [
        {
          id: 'sig-legacy',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 'unknown',
          status: 'active',
        },
      ],
    }),
    pkg({
      id: 'cp-exact',
      status: 'accepted',
      resultSignals: [
        {
          id: 'sig-exact',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 4,
          status: 'active',
        },
      ],
    }),
  ];

  assert.deepEqual(
    projectActiveOwnedResultSignals(
      packages[0]!.resultSignals!,
    ).map((row) => row.id),
    [],
  );
  assert.equal(packageHasActiveOutcomeEvidence(packages[0]!), false);
  assert.equal(packageHasActiveOutcomeEvidence(packages[1]!), true);
  assert.deepEqual(
    projectEvidenceCoverageCounts({ resourceId: 'ws-1', packages }),
    { denominator: 2, numerator: 1 },
  );
});

test('coverage port reads through ContentPackageFactsReader', async () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-a',
      status: 'accepted',
      resultSignals: [
        {
          id: 's1',
          kind: 'appointment',
          occurredAt: TS,
          contentPackageRevision: 1,
          status: 'active',
        },
      ],
    }),
    pkg({ id: 'cp-b', status: 'review_ready' }),
  ];
  const port = new ContentPackageEvidenceCoveragePort({
    listPackages: () => packages,
  });
  assert.equal(await port.countDelivered({ resourceId: 'ws-1' }), 2);
  assert.equal(await port.countWithEvidence({ resourceId: 'ws-1' }), 1);
});

test('unpublished_duration signal only for aged delivered without publish mark', () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-old-unpub',
      status: 'review_ready',
      updatedAt: OLD,
    }),
    pkg({
      id: 'cp-fresh-unpub',
      status: 'review_ready',
      updatedAt: RECENT,
    }),
    pkg({
      id: 'cp-published',
      status: 'accepted',
      updatedAt: OLD,
      deliveryEvents: [
        {
          type: 'manual_publish_result',
          status: 'published',
          occurredAt: OLD,
        },
      ],
      resultSignals: [
        {
          id: 's',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 1,
          status: 'active',
        },
      ],
    }),
  ];

  const signals = deriveContentPackageSignals({
    resourceId: 'ws-1',
    packages,
    now: TS,
    options: { unpublishedDays: 3, postPublishEvidenceGraceDays: 1 },
  });
  const unpublished = signals.filter((s) => s.kind === 'unpublished_duration');
  assert.equal(unpublished.length, 1);
  assert.equal(unpublished[0]!.evidenceRefs[0]!.ref, 'cp-old-unpub');
  assert.ok(unpublished[0]!.evidenceRefs.length >= 1);

  // Deterministic filter keeps evidence-bearing signals.
  const filtered = pipelineFilter({ signals, now: TS });
  assert.ok(filtered.some((s) => s.kind === 'unpublished_duration'));
});

test('historical_performance signal for published package without outcome evidence', () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-pub-no-ev',
      status: 'accepted',
      updatedAt: OLD,
      deliveryEvents: [
        {
          type: 'automatic_publish_result',
          status: 'published',
          occurredAt: OLD,
        },
      ],
    }),
    pkg({
      id: 'cp-pub-with-ev',
      status: 'accepted',
      updatedAt: OLD,
      deliveryEvents: [
        {
          type: 'manual_publish_result',
          status: 'published',
          occurredAt: OLD,
        },
      ],
      resultSignals: [
        {
          id: 's',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 1,
          status: 'active',
        },
      ],
    }),
    pkg({
      id: 'cp-pub-fresh',
      status: 'review_ready',
      updatedAt: RECENT,
      deliveryEvents: [
        {
          type: 'manual_publish_result',
          status: 'published',
          occurredAt: RECENT,
        },
      ],
    }),
  ];

  const signals = deriveContentPackageSignals({
    resourceId: 'ws-1',
    packages,
    now: TS,
    options: { unpublishedDays: 3, postPublishEvidenceGraceDays: 1 },
  });
  const perf = signals.filter((s) => s.kind === 'historical_performance');
  assert.equal(perf.length, 1);
  assert.equal(perf[0]!.evidenceRefs.some((r) => r.ref === 'cp-pub-no-ev'), true);
  assert.ok(isPublishedContentPackage(packages[0]!));
  assert.equal(packageHasActiveOutcomeEvidence(packages[0]!), false);
});

test('gate unset still observes coverage from real package counts; allowlist opens', async () => {
  const packages: OwnedContentPackageFact[] = [
    pkg({
      id: 'cp-1',
      status: 'review_ready',
      resultSignals: [
        {
          id: 's1',
          kind: 'inquiry',
          occurredAt: TS,
          contentPackageRevision: 1,
          status: 'active',
        },
      ],
    }),
    pkg({ id: 'cp-2', status: 'accepted' }),
  ];
  const coverage = new ContentPackageEvidenceCoveragePort({
    listPackages: () => packages,
  });
  const service = new ProactiveService({
    decisions: new MemoryOpportunityDecisionStore(),
    threads: new MemoryAgentSessionStore(),
    coverage,
    signals: new OwnedDataProactiveSignalSource({
      goals: new MemoryMarketingGoalStore(),
      contentPackages: { listPackages: () => packages },
      contentPackageSignalOptions: {
        unpublishedDays: 3,
        postPublishEvidenceGraceDays: 1,
      },
    }),
  });

  const unset = await service.listSuggestions({
    resourceId: 'ws-1',
    now: TS,
    config: {
      disableProactiveAgent: false,
      proactiveFeatureOn: true,
      workspaceAllowlisted: false,
      coverageThreshold: null,
    },
  });
  assert.equal(unset.gate.open, false);
  assert.equal(unset.gate.reason, 'threshold_unset');
  // Coverage is observational even when gate closed.
  assert.equal(unset.gate.observation.denominator, 2);
  assert.equal(unset.gate.observation.numerator, 1);
  assert.equal(unset.gate.observation.coverage, 0.5);
  assert.deepEqual(unset.suggestions, []);

  const allow = await service.listSuggestions({
    resourceId: 'ws-1',
    now: TS,
    config: {
      disableProactiveAgent: false,
      proactiveFeatureOn: true,
      workspaceAllowlisted: true,
      coverageThreshold: null,
    },
  });
  assert.equal(allow.gate.open, true);
  assert.equal(allow.gate.reason, 'workspace_allowlist');
  assert.ok(
    allow.suggestions.some(
      (row) =>
        row.signalKinds.includes('unpublished_duration') ||
        row.reason.includes('未记录发布'),
    ),
  );

  // Threshold met path uses real coverage numbers.
  const met = decideProactiveGate({
    resourceId: 'ws-1',
    config: {
      disableProactiveAgent: false,
      proactiveFeatureOn: true,
      workspaceAllowlisted: false,
      coverageThreshold: 0.4,
    },
    denominator: unset.gate.observation.denominator,
    numerator: unset.gate.observation.numerator,
  });
  assert.equal(met.open, true);
  assert.equal(met.reason, 'coverage_met');
});

test('owned signal source merges goal_stalled with package-derived signals', async () => {
  const goals = new MemoryMarketingGoalStore();
  await goals.create({
    goalId: 'goal-old',
    resourceId: 'ws-1',
    objective: 'inquiry',
    statement: '老目标',
    priority: 'high',
    now: OLD,
  });
  const source = new OwnedDataProactiveSignalSource({
    goals,
    contentPackages: {
      listPackages: () => [
        pkg({
          id: 'cp-unpub',
          status: 'review_ready',
          updatedAt: OLD,
        }),
        pkg({
          id: 'cp-pub-silent',
          status: 'accepted',
          updatedAt: OLD,
          deliveryEvents: [
            {
              type: 'manual_publish_result',
              status: 'published',
              occurredAt: OLD,
            },
          ],
        }),
      ],
    },
    stallDays: 14,
    contentPackageSignalOptions: {
      unpublishedDays: 3,
      postPublishEvidenceGraceDays: 1,
    },
  });
  const signals = await source.listSignals({ resourceId: 'ws-1', now: TS });
  const kinds = new Set(signals.map((s) => s.kind));
  assert.ok(kinds.has('goal_stalled'));
  assert.ok(kinds.has('unpublished_duration'));
  assert.ok(kinds.has('historical_performance'));
  for (const signal of signals) {
    assert.ok(signal.evidenceRefs.length >= 1);
  }
});
