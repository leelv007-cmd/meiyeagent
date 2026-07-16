import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import {
  mapLegacyProductState,
  mapLegacyUsageLedgerSeeds,
} from './legacy-mapper.js';

test('legacy mapper preserves platform, versions, rights and unknown evidence without invention', () => {
  const state = {
    workspaceId: 'workspace-a',
    store: {
      confirmedAt: '2026-07-01T00:00:00.000Z',
      projects: [{ id: 'project-a', confirmed: true }],
    },
    assets: [
      {
        id: 'asset-a',
        authorizationStatus: 'authorized',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ],
    contents: [
      {
        id: 'content-a',
        createdAt: '2026-07-03T00:00:00.000Z',
        variants: [
          {
            id: 'variant-a',
            platform: 'douyin',
            versions: [
              {
                id: 'version-a',
                createdAt: '2026-07-03T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
    storyboards: [],
    videoJobs: [
      {
        id: 'video-a',
        storyboardId: 'story-a',
        status: 'running',
        createdAt: '2026-07-04T00:00:00.000Z',
      },
    ],
    videoRenderEvidence: [],
    videoArtifacts: [],
    handoffPackages: [
      {
        id: 'handoff-a',
        contentId: 'content-a',
        status: 'ready',
        token: 'publish-secret',
        createdAt: '2026-07-05T00:00:00.000Z',
      },
    ],
    leads: [],
    usageEvents: [
      {
        id: 'usage-a',
        status: 'reserved',
        createdAt: '2026-07-04T00:00:00.000Z',
      },
    ],
    auditEvents: [
      {
        id: 'audit-a',
        createdAt: '2026-07-05T00:00:00.000Z',
        details: {
          accessToken: 'audit-secret',
          authorizationStatus: 'authorized',
        },
      },
    ],
    complianceResults: [],
    agentRuns: [
      {
        id: 'agent-a',
        status: 'completed',
        workflow: 'content.generate_copy',
        startedAt: '2026-07-05T00:00:00.000Z',
      },
    ],
    toolCalls: [
      {
        id: 'tool-a',
        agentRunId: 'agent-a',
        createdAt: '2026-07-05T00:00:00.000Z',
      },
    ],
  } as unknown as ProductState;

  const { facts, manifest } = mapLegacyProductState(
    state,
    '2026-07-11T00:00:00.000Z'
  );
  const variant = facts.find((fact) => fact.kind === 'platform_variant');
  assert.equal(variant?.data.platform, 'douyin');
  assert.equal(
    facts.filter((fact) => fact.kind === 'content_version').length,
    1
  );
  assert.equal(
    facts.find((fact) => fact.kind === 'asset_rights')?.data
      .authorizationStatus,
    'authorized'
  );
  assert.equal(
    facts.find((fact) => fact.kind === 'usage_event')?.data.status,
    'reserved'
  );
  assert.equal(
    facts.find((fact) => fact.kind === 'publish_package')?.data.token,
    '[REDACTED]'
  );
  const audit = facts.find((fact) => fact.id === 'legacy:audit:audit:audit-a');
  assert.deepEqual(audit?.data.details, {
    accessToken: '[REDACTED]',
    authorizationStatus: 'authorized',
  });
  assert.deepEqual(manifest.inFlightJobIds, ['video-a']);
  assert.ok(manifest.unknownEvidence.length > 0);
  assert.match(manifest.sourceRevision, /^[a-f0-9]{64}$/);
});

test('legacy mapper produces an idempotent manifest and preserves explicit version order', () => {
  const state = {
    workspaceId: 'workspace-order',
    assets: [],
    contents: [
      {
        id: 'content-order',
        createdAt: '2026-07-03T00:00:00.000Z',
        variants: [
          {
            id: 'variant-order',
            platform: 'xiaohongshu',
            versions: [
              {
                id: 'version-second-by-time',
                createdAt: '2026-07-03T02:00:00.000Z',
              },
              {
                id: 'version-first-by-time',
                createdAt: '2026-07-03T01:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
    storyboards: [],
    videoJobs: [],
    videoRenderEvidence: [],
    videoArtifacts: [],
    handoffPackages: [],
    leads: [],
    usageEvents: [],
    auditEvents: [],
    complianceResults: [],
    agentRuns: [],
    toolCalls: [],
    updatedAt: '2026-07-10T00:00:00.000Z',
  } as unknown as ProductState;

  const generatedAt = '2026-07-11T00:00:00.000Z';
  const first = mapLegacyProductState(state, generatedAt);
  const second = mapLegacyProductState(structuredClone(state), generatedAt);

  assert.deepEqual(second, first);
  assert.match(first.manifest.factsHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    first.facts
      .filter((fact) => fact.kind === 'content_version')
      .map((fact) => ({ id: fact.id, sequence: fact.sequence })),
    [
      { id: 'legacy:content_version:version-first-by-time', sequence: 1 },
      { id: 'legacy:content_version:version-second-by-time', sequence: 0 },
    ]
  );
  assert.deepEqual(first.manifest.versionSequences, {
    'legacy:platform_variant:variant-order': [
      'legacy:content_version:version-second-by-time',
      'legacy:content_version:version-first-by-time',
    ],
  });
});

test('legacy usage migration seeds copy, image and video without rewriting historical terminal facts', () => {
  const state = {
    workspaceId: 'workspace-usage-seed',
    entitlement: {
      content: { allowance: 30, remaining: 29 },
      image: { allowance: 10, remaining: 9 },
      video: { allowance: 5, remaining: 5 },
    },
    usageEvents: [
      {
        id: 'legacy-image-reserve',
        resource: 'image',
        amount: 1,
        status: 'reserved',
        reservationId: 'legacy-image-reservation',
        reason: 'legacy image generation',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'legacy-image-refund',
        resource: 'image',
        amount: 1,
        status: 'refunded',
        reservationId: 'legacy-image-reservation',
        reason: 'legacy image provider failure',
        createdAt: '2026-07-10T00:01:00.000Z',
      },
      {
        id: 'legacy-image-no-charge',
        resource: 'image',
        amount: 1,
        status: 'failed_no_charge',
        reason: 'legacy validation failure',
        createdAt: '2026-07-10T00:02:00.000Z',
      },
      {
        id: 'foundation:p1-copy-reserve',
        resource: 'content',
        amount: 1,
        status: 'reserved',
        reservationId: 'p1-copy-reservation',
        reason: 'P1 usage handed to the rollback projection',
        createdAt: '2026-07-10T00:03:00.000Z',
      },
    ],
    updatedAt: '2026-07-11T00:00:00.000Z',
  } as unknown as ProductState;

  const seeds = mapLegacyUsageLedgerSeeds(state);

  assert.deepEqual(
    seeds.map((seed) => [
      seed.id.replace(/:[0-9a-f]{16}$/, ':<revision>'),
      seed.resource,
      seed.action,
    ]),
    [
      ['legacy:usage:opening:copy:<revision>', 'copy', 'adjust'],
      ['legacy:usage:opening:image:<revision>', 'image', 'adjust'],
      ['legacy:usage:opening:video:<revision>', 'video', 'adjust'],
      ['legacy:usage:legacy-image-reserve', 'image', 'reserve'],
      ['legacy:usage:legacy-image-refund', 'image', 'refund'],
      ['p1-copy-reserve', 'copy', 'reserve'],
    ]
  );
  assert.ok(
    seeds
      .filter((seed) => seed.id.startsWith('legacy:usage:opening:'))
      .every((seed) => seed.reason.includes('plan_allowance='))
  );
});
