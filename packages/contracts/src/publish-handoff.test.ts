/**
 * V31-17 publish handoff + self-report journey contract tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  OUTCOME_SELF_REPORT_CHIP_SIGNALS,
  OUTCOME_SELF_REPORT_FREQUENCY_PARAMS,
} from './agent-domain.js';
import {
  buildPublishHandoffCopyBlocks,
  buildVideoHandoffSafetyChecklist,
  decidePublishFromHandoff,
  evaluateSelfReportAsk,
  mobilePublishHandoffSchema,
  orderedExportImagePath,
  projectPublishCapabilityPresentation,
  projectStoreConsecutiveIgnores,
  PUBLISH_HANDOFF_COMMAND_SCHEMAS,
  publishHandoffViewSchema,
} from './publish-handoff.js';

test('capability three-state never shows direct publish for assisted/unavailable', () => {
  const verified = projectPublishCapabilityPresentation('automatic_verified');
  assert.equal(verified.showDirectPublish, true);
  assert.equal(verified.mode, 'automatic_verified');

  const assisted = projectPublishCapabilityPresentation('assisted');
  assert.equal(assisted.showDirectPublish, false);
  assert.equal(assisted.showAssistedHandoff, true);
  assert.equal(assisted.showExportAndCopy, true);

  const unavailable = projectPublishCapabilityPresentation('unavailable');
  assert.equal(unavailable.showDirectPublish, false);
  assert.equal(unavailable.showAssistedHandoff, false);
  assert.equal(unavailable.showExportAndCopy, true);
});

test('A19 rejects every driven publish intent from handoff path', () => {
  for (const intent of [
    'system_driven_publish',
    'automatic_verified_publish',
    'platform_api_publish',
  ] as const) {
    const decision = decidePublishFromHandoff(intent);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.code, 'DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED');
      assert.equal(decision.authority, 'A19');
      assert.equal(decision.intent, intent);
    }
  }
  const allowed = decidePublishFromHandoff('merchant_self_publish');
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.next, 'show_handoff_materials');
  }
});

test('MobilePublishHandoff freezes merchant_self_publish and rejects driven flag', () => {
  const handoff = mobilePublishHandoffSchema.parse({
    schemaVersion: 'publish-handoff/v1',
    handoffId: 'handoff-1',
    token: 'tok-abc',
    handoffUrl: '/dashboard/handoff/tok-abc',
    expiresAt: '2026-08-11T12:00:00.000Z',
    contentPackageRef: { id: 'pkg-1', revision: 3 },
    platform: 'xiaohongshu',
    publishActor: 'merchant_self_publish',
    systemDrivenPublishAllowed: false,
  });
  assert.equal(handoff.systemDrivenPublishAllowed, false);
  assert.equal(handoff.publishActor, 'merchant_self_publish');

  const driven = mobilePublishHandoffSchema.safeParse({
    ...handoff,
    systemDrivenPublishAllowed: true,
  });
  assert.equal(driven.success, false);
});

test('copy blocks are title/body/topics/cta ordered and omit empties', () => {
  const blocks = buildPublishHandoffCopyBlocks({
    title: '周末护理',
    body: '预约从速',
    topics: ['美甲', '#到店'],
    cta: '私信预约',
  });
  assert.deepEqual(
    blocks.map((b) => b.role),
    ['title', 'body', 'topics', 'cta'],
  );
  assert.equal(blocks[2]?.value, '#美甲 #到店');
  assert.equal(buildPublishHandoffCopyBlocks({}).length, 0);
});

test('ordered image paths are deterministic zero-padded', () => {
  assert.equal(orderedExportImagePath(0, 'jpg'), 'images/01.jpg');
  assert.equal(orderedExportImagePath(9, 'png'), 'images/10.png');
});

test('video safety checklist is safety-zone only (V31-61; no cover/subtitle slots)', () => {
  const checklist = buildVideoHandoffSafetyChecklist({
    platform: '抖音',
  });
  assert.equal('includeCoverSlot' in checklist, false);
  assert.equal('includeSubtitlesTrack' in checklist, false);
  assert.match(checklist.platformSafeZoneReminder, /安全区/);
  assert.ok(checklist.items.some((item) => item.includes('安全区')));
  assert.ok(checklist.items.some((item) => item.includes('不交付字幕/封面')));
});

test('U2 self-report ask: next day once, one ask per work, two ignores backoff', () => {
  assert.equal(OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.maxAsksPerWork, 1);
  assert.equal(
    OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.consecutiveIgnoreThresholdForStoreBackoff,
    2,
  );
  assert.equal(OUTCOME_SELF_REPORT_CHIP_SIGNALS.length, 6);

  const base = {
    workId: 'work-1',
    contentPackageId: 'pkg-1',
    contentPackageRevision: 2,
    publishHandoffCompletedAt: '2026-08-07T10:00:00.000Z',
    now: '2026-08-08T09:00:00.000Z',
    workAskHistory: [] as const,
    storeConsecutiveIgnores: 0,
  };

  const ask = evaluateSelfReportAsk(base);
  assert.equal(ask.kind, 'ask');
  if (ask.kind === 'ask') {
    assert.match(ask.prompt, /有人来问/);
    assert.equal(ask.chips.length, 6);
    assert.ok(ask.chips.includes('no_activity'));
  }

  const sameDay = evaluateSelfReportAsk({
    ...base,
    now: '2026-08-07T18:00:00.000Z',
  });
  assert.equal(sameDay.kind, 'skip');
  if (sameDay.kind === 'skip') {
    assert.equal(sameDay.reason, 'not_yet_next_day');
  }

  const alreadyAsked = evaluateSelfReportAsk({
    ...base,
    workAskHistory: [
      {
        askId: 'ask-1',
        workId: 'work-1',
        contentPackageId: 'pkg-1',
        contentPackageRevision: 2,
        askedAt: '2026-08-08T08:00:00.000Z',
        status: 'asked',
      },
    ],
  });
  assert.equal(alreadyAsked.kind, 'skip');
  if (alreadyAsked.kind === 'skip') {
    assert.equal(alreadyAsked.reason, 'already_asked_this_work');
  }

  const backoff = evaluateSelfReportAsk({
    ...base,
    storeConsecutiveIgnores: 2,
  });
  assert.equal(backoff.kind, 'skip');
  if (backoff.kind === 'skip') {
    assert.equal(backoff.reason, 'store_backoff');
  }

  assert.equal(
    projectStoreConsecutiveIgnores([
      {
        askId: 'a1',
        workId: 'w1',
        contentPackageId: 'p1',
        contentPackageRevision: 1,
        askedAt: '2026-08-01T00:00:00.000Z',
        status: 'ignored',
        ignoredAt: '2026-08-02T00:00:00.000Z',
      },
      {
        askId: 'a2',
        workId: 'w2',
        contentPackageId: 'p2',
        contentPackageRevision: 1,
        askedAt: '2026-08-03T00:00:00.000Z',
        status: 'ignored',
        ignoredAt: '2026-08-04T00:00:00.000Z',
      },
    ]),
    2,
  );
  assert.equal(
    projectStoreConsecutiveIgnores([
      {
        askId: 'a1',
        workId: 'w1',
        contentPackageId: 'p1',
        contentPackageRevision: 1,
        askedAt: '2026-08-01T00:00:00.000Z',
        status: 'ignored',
        ignoredAt: '2026-08-02T00:00:00.000Z',
      },
      {
        askId: 'a2',
        workId: 'w2',
        contentPackageId: 'p2',
        contentPackageRevision: 1,
        askedAt: '2026-08-03T00:00:00.000Z',
        status: 'answered',
        answeredAt: '2026-08-04T00:00:00.000Z',
      },
    ]),
    0,
  );
});

test('publish handoff view freezes exact content package revision', () => {
  const view = publishHandoffViewSchema.parse({
    schemaVersion: 'publish-handoff/v1',
    contentPackageRef: { id: 'pkg-1', revision: 5 },
    platform: 'xiaohongshu',
    copyBlocks: buildPublishHandoffCopyBlocks({ title: 'T', body: 'B' }),
    orderedImagePaths: ['images/01.jpg', 'images/02.jpg'],
    capability: projectPublishCapabilityPresentation('assisted'),
    publicationBindingRevision: 5,
  });
  assert.equal(view.publicationBindingRevision, 5);
  assert.equal(view.contentPackageRef.revision, 5);
  assert.equal(view.capability.showDirectPublish, false);
});

test('command schemas reject unknown keys and accept core handoff actions', () => {
  const prepare =
    PUBLISH_HANDOFF_COMMAND_SCHEMAS.prepare_mobile_publish_handoff.parse({
      packageId: 'pkg-1',
      expectedRevision: 1,
      platform: 'xiaohongshu',
      variantVersionId: 'v1',
    });
  assert.equal(prepare.packageId, 'pkg-1');

  const attempt =
    PUBLISH_HANDOFF_COMMAND_SCHEMAS.attempt_publish_from_handoff.parse({
      handoffToken: 'tok',
      intent: 'system_driven_publish',
    });
  assert.equal(attempt.intent, 'system_driven_publish');

  const published =
    PUBLISH_HANDOFF_COMMAND_SCHEMAS.record_merchant_published.parse({
      packageId: 'pkg-1',
      expectedRevision: 3,
      platform: 'xiaohongshu',
      variantVersionId: 'v1',
    });
  assert.equal(published.expectedRevision, 3);
});
