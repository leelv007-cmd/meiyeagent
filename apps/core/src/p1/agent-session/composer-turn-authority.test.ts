import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCreationExecutionSnapshot,
  type CreationSubmissionCommand,
} from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { projectComposerTurnAuthority } from './composer-turn-authority.js';

const TS = '2026-08-09T08:00:00.000Z';

test('turn authority is read off the submission, not declared', () => {
  const paidWithAssets = projectComposerTurnAuthority(
    record({
      credits: 12,
      sources: {
        assets: [{ id: 'asset-case-1', revision: 'asset-r1', role: 'source' }],
      },
      briefContextRevision: 3,
      // P2-09 strips a persona override in customized mode, so the snapshot
      // only carries a voice in free mode — which is exactly why the projection
      // must read it instead of assuming it.
      creationMode: 'free',
      beautyVoiceRole: 'beautician',
      allowedFactRefs: ['store_fact:service-main:1'],
    }),
  );
  const freeWithoutAssets = projectComposerTurnAuthority(
    record({ sources: { assets: [] }, briefContextRevision: 0 }),
  );

  // Assets present ⇒ a real rights resolution stands behind the turn.
  assert.equal(paidWithAssets.knownFields.includes('rights'), true);
  assert.equal(freeWithoutAssets.knownFields.includes('rights'), false);
  // A confirmed brief context is what makes store facts a system fact.
  assert.equal(paidWithAssets.knownFields.includes('store_facts'), true);
  assert.equal(freeWithoutAssets.knownFields.includes('store_facts'), false);
  // An optional snapshot fact only counts when the snapshot carries it.
  assert.equal(paidWithAssets.knownFields.includes('voice'), true);
  assert.equal(freeWithoutAssets.knownFields.includes('voice'), false);

  // Fees are authoritative only where credits were actually reserved.
  assert.deepEqual([...paidWithAssets.authoritativeKeys].sort(), [
    'assets',
    'fees',
    'price',
    'rights',
    'store_facts',
  ]);
  assert.deepEqual([...freeWithoutAssets.authoritativeKeys], []);
});

test('publish stays high risk and never authoritative', () => {
  const projection = projectComposerTurnAuthority(
    record({
      credits: 12,
      sources: {
        assets: [{ id: 'asset-case-1', revision: 'asset-r1', role: 'source' }],
      },
      briefContextRevision: 3,
    }),
  );

  assert.equal(projection.impactByKey.get('publish'), 'external_action');
  assert.equal(projection.authoritativeKeys.has('publish'), false);
});

test('free creation only treats explicitly granted store facts as authoritative', () => {
  const implicit = record({
    sources: { assets: [] },
    briefContextRevision: 3,
    creationMode: 'free',
  });
  const explicit = structuredClone(implicit);
  explicit.snapshot.allowedFactRefs = ['store_fact:service-main:1'];

  const implicitProjection = projectComposerTurnAuthority(implicit);
  const explicitProjection = projectComposerTurnAuthority(explicit);

  assert.equal(implicitProjection.knownFields.includes('store_facts'), false);
  assert.equal(implicitProjection.authoritativeKeys.has('store_facts'), false);
  assert.equal(explicitProjection.knownFields.includes('store_facts'), true);
  assert.equal(explicitProjection.authoritativeKeys.has('store_facts'), true);
});

function record(input: {
  credits?: number;
  sources: CreationSubmissionCommand['sources'];
  briefContextRevision: number;
  creationMode?: 'customized' | 'free';
  beautyVoiceRole?: 'beautician';
  allowedFactRefs?: string[];
}): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submission-authority',
      taskId: 'task-authority',
      workId: 'work-authority',
      contentPackageId: 'package-authority',
      expectedContentPackageRevision: 0,
      creationMode: input.creationMode ?? 'customized',
      intent: '为夏日护理做图文',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'image_text_note',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      deliverable: {
        kind: 'image_set',
        quantity: 3,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      deliverables: [
        {
          id: 'note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 3,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      ],
      sources: input.sources,
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      ...(input.beautyVoiceRole ? { beautyVoiceRole: input.beautyVoiceRole } : {}),
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-authority', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: {
        id: 'context-authority',
        revision: input.briefContextRevision,
      },
      allowedFactRefs: input.allowedFactRefs ?? [],
      contentModules: ['social_cover'],
    },
    TS,
  );
  return {
    snapshot,
    task: { id: 'task-authority' },
    work: { id: 'work-authority' },
    contentPackage: { id: 'package-authority', expectedRevision: 0 },
    usageReservation: {
      id: 'usage-authority',
      ...(input.credits === undefined ? {} : { credits: input.credits }),
      units: [{ resource: 'image', quantity: 3 }],
    },
  };
}
