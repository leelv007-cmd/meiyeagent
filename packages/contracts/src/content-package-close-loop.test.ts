import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageDeliveryEventSchema,
  recordContentPackageManualResultCommandSchema,
  recordContentPackageResultSignalCommandSchema,
} from './content-package.js';

test('close-loop commands retain merchant-safe publication facts and canonical outcome kinds', () => {
  const manual = recordContentPackageManualResultCommandSchema.parse({
    accountDisplayLabel: '花间美甲抖音',
    expectedRevision: 3,
    packageId: 'package-a',
    platform: 'douyin',
    publishedAt: '2026-07-23T09:30:00.000Z',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });

  assert.equal(manual.accountDisplayLabel, '花间美甲抖音');
  assert.equal(manual.publishedAt, '2026-07-23T09:30:00.000Z');

  const event = contentPackageDeliveryEventSchema.parse({
    accountDisplayLabel: manual.accountDisplayLabel,
    actorId: 'owner-a',
    id: 'event-a',
    occurredAt: manual.publishedAt,
    platform: manual.platform,
    source: 'native',
    status: manual.status,
    type: 'manual_publish_result',
    variantVersionId: manual.variantVersionId,
  });

  assert.equal(event.type, 'manual_publish_result');
  assert.equal(event.accountDisplayLabel, '花间美甲抖音');
  assert.equal(event.occurredAt, '2026-07-23T09:30:00.000Z');

  assert.equal(
    recordContentPackageResultSignalCommandSchema.safeParse({
      expectedRevision: 4,
      kind: 'attention',
      packageId: 'package-a',
    }).success,
    true
  );

  // V31-19: no_activity is a first-class signal; correct requires supersedes.
  assert.equal(
    recordContentPackageResultSignalCommandSchema.safeParse({
      expectedRevision: 4,
      kind: 'no_activity',
      packageId: 'package-a',
      sourceRef: 'chip:no_activity',
    }).success,
    true,
  );
  assert.equal(
    recordContentPackageResultSignalCommandSchema.safeParse({
      action: 'correct',
      expectedRevision: 4,
      kind: 'store_visit',
      packageId: 'package-a',
    }).success,
    false,
  );
  assert.equal(
    recordContentPackageResultSignalCommandSchema.safeParse({
      action: 'withdraw',
      expectedRevision: 4,
      kind: 'store_visit',
      packageId: 'package-a',
      supersedesSignalId: 'signal-prior',
    }).success,
    true,
  );
});
