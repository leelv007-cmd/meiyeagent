import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import {
  buildCutoverDifferenceReport,
  createInFlightDecisions,
  type StoredMigrationFact,
} from './execution-service.js';
import { mapLegacyProductState } from './legacy-mapper.js';

function evidenceState() {
  return {
    workspaceId: 'workspace-evidence',
    assets: [
      {
        id: 'asset-one',
        objectKey: 'assets/one.jpg',
        authorizationStatus: 'authorized',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    contents: [
      {
        id: 'content-one',
        status: 'draft',
        createdAt: '2026-07-01T00:00:00.000Z',
        variants: [
          {
            id: 'variant-one',
            platform: 'douyin',
            versions: [
              { id: 'version-one', createdAt: '2026-07-01T00:00:00.000Z' },
              { id: 'version-two', createdAt: '2026-07-02T00:00:00.000Z' },
            ],
          },
        ],
      },
    ],
    storyboards: [],
    videoJobs: [
      {
        id: 'video-drain',
        storyboardId: 'story-one',
        status: 'queued',
        createdAt: '2026-07-01T00:00:00.000Z',
        leaseOwner: 'legacy-worker-7',
      },
      {
        id: 'video-recover',
        storyboardId: 'story-one',
        status: 'running',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'video-manual',
        storyboardId: 'story-one',
        status: 'needs_action',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    videoRenderEvidence: [
      {
        id: 'render-one',
        jobId: 'video-recover',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    videoArtifactShells: [
      {
        id: 'shell-orphan',
        jobId: 'missing-job',
        storyboardId: 'story-one',
        status: 'running',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    videoArtifacts: [],
    handoffPackages: [],
    leads: [],
    usageEvents: [
      {
        id: 'usage-one',
        resource: 'content',
        status: 'reserved',
        amount: 1,
        reservationId: 'reservation-one',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    auditEvents: [],
    complianceResults: [],
    agentRuns: [
      {
        id: 'copy-run-one',
        workflow: 'content.generate_copy',
        status: 'running',
        startedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    toolCalls: [],
    updatedAt: '2026-07-10T00:00:00.000Z',
  } as unknown as ProductState;
}

test('difference report separates object, status, version, usage and asset evidence', () => {
  const { facts } = mapLegacyProductState(
    evidenceState(),
    '2026-07-11T00:00:00.000Z'
  );
  const actual = facts.map(
    (fact): StoredMigrationFact => ({
      ...structuredClone(fact),
      workspaceId: 'workspace-evidence',
    })
  );
  const content = actual.find((fact) => fact.kind === 'content');
  assert.ok(content);
  content.data.status = 'published';
  const version = actual.find((fact) => fact.id.endsWith('version-two'));
  assert.ok(version);
  version.sequence = 0;
  const usage = actual.find((fact) => fact.kind === 'usage_event');
  assert.ok(usage);
  usage.data.amount = 9;
  const asset = actual.find((fact) => fact.kind === 'asset_rights');
  assert.ok(asset);
  asset.data.objectKey = 'assets/wrong.jpg';
  actual.splice(
    actual.findIndex((fact) => fact.kind === 'platform_variant'),
    1
  );

  const report = buildCutoverDifferenceReport(facts, actual);

  assert.ok(report.differenceCount > 0);
  assert.deepEqual(report.objectDifferences.missingFactIds, [
    'legacy:platform_variant:variant-one',
  ]);
  assert.deepEqual(report.statusDifferences, [
    {
      actual: 'published',
      expected: 'draft',
      factId: 'legacy:content:content-one',
    },
  ]);
  assert.equal(report.versionOrderDifferences.length, 1);
  assert.deepEqual(report.usageDifferences.mismatchedEventIds, [
    'legacy:usage_event:usage-one',
  ]);
  assert.deepEqual(report.assetDifferences.mismatchedReceiptIds, [
    'legacy:asset_rights:asset-one',
  ]);
});

test('difference report blocks a requested platform that was historically stored on another variant', () => {
  const state = evidenceState();
  state.contents[0]!.variants[0]!.platform = 'xiaohongshu';
  state.auditEvents.push({
    action: 'content.generated',
    correlationId: 'corr-platform-mismatch',
    createdAt: '2026-07-01T00:00:00.000Z',
    details: {
      candidateIds: ['content-one'],
      requestedPlatform: 'douyin',
    },
    entityId: 'content-one',
    entityType: 'content_batch',
    id: 'audit-platform-mismatch',
    userId: 'owner-evidence',
  });
  const { facts } = mapLegacyProductState(
    state,
    '2026-07-11T00:00:00.000Z'
  );
  const actual = facts.map(
    (fact): StoredMigrationFact => ({
      ...structuredClone(fact),
      workspaceId: state.workspaceId,
    })
  );

  const report = buildCutoverDifferenceReport(facts, actual);

  assert.equal(report.differenceCount, 1);
  assert.deepEqual(report.platformDifferences, [
    {
      auditFactId: 'legacy:audit:audit:audit-platform-mismatch',
      contentFactId: 'legacy:content:content-one',
      historicalPlatform: 'xiaohongshu',
      requestedPlatform: 'douyin',
      variantFactId: 'legacy:platform_variant:variant-one',
    },
  ]);
});

test('every in-flight job receives an explicit owner without regeneration', () => {
  const state = evidenceState();
  const decisions = createInFlightDecisions(state, 'cutover-operator');

  assert.deepEqual(
    decisions.map(({ jobId, decision, owner }) => ({ jobId, decision, owner })),
    [
      {
        jobId: 'agent-run:copy-run-one',
        decision: 'legacy_drain',
        owner: 'legacy-application-runtime',
      },
      {
        jobId: 'artifact-shell:shell-orphan',
        decision: 'manual',
        owner: 'cutover-operator',
      },
      {
        jobId: 'video-drain',
        decision: 'legacy_drain',
        owner: 'legacy-worker-7',
      },
      {
        jobId: 'video-manual',
        decision: 'manual',
        owner: 'cutover-operator',
      },
      {
        jobId: 'video-recover',
        decision: 'new_owner_recovery',
        owner: 'p1-job-worker',
      },
    ]
  );
  assert.ok(decisions.every((decision) => decision.preserveOriginalTaskRef));
  assert.ok(decisions.every((decision) => !decision.allowRegeneration));
  assert.deepEqual(
    mapLegacyProductState(state, '2026-07-11T00:00:00.000Z').manifest
      .inFlightJobIds,
    decisions.map((decision) => decision.jobId)
  );
});

test('difference report blocks duplicate terminal decisions from the legacy source', () => {
  const { facts } = mapLegacyProductState(
    evidenceState(),
    '2026-07-11T00:00:00.000Z'
  );
  const reserved = facts.find((fact) => fact.kind === 'usage_event');
  assert.ok(reserved);
  reserved.data.status = 'committed';
  const duplicateTerminal = structuredClone(reserved);
  duplicateTerminal.id = 'legacy:usage_event:duplicate-terminal';
  duplicateTerminal.data.status = 'refunded';
  const expected = [...facts, duplicateTerminal];
  const actual = expected.map(
    (fact): StoredMigrationFact => ({
      ...structuredClone(fact),
      workspaceId: 'workspace-evidence',
    })
  );

  const report = buildCutoverDifferenceReport(expected, actual);

  assert.deepEqual(report.usageDifferences.terminalReservationConflicts, [
    'reservation-one',
  ]);
  assert.equal(report.differenceCount, 1);
});
