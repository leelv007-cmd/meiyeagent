import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  projectPublicationRecordPanel,
  publicationLifecycleFromDelivery,
  publicationRecordsFromDeliveryEvents,
  validateManualPublicationForm,
  type PublicationRecordFact,
} from './publication-record-model';

const baseRecord: PublicationRecordFact = {
  id: 'pub-1',
  contentPackageId: 'pkg-a',
  contentPackageRevision: 2,
  platform: 'douyin',
  accountDisplayLabel: '本店抖音',
  publishedAt: '2026-07-20T08:00:00.000Z',
  actorId: 'actor-a',
  sourceTier: 'manual_record',
  createdAt: '2026-07-20T08:05:00.000Z',
  status: 'published',
  platformUrl: 'https://www.douyin.com/video/1',
  variantVersionId: 'dy-v1',
};

describe('publication-record-model', () => {
  it('keeps shared/handed_off distinct from published', () => {
    assert.equal(
      publicationLifecycleFromDelivery({ deliveryKind: 'shared' }),
      'shared'
    );
    assert.equal(
      publicationLifecycleFromDelivery({ deliveryKind: 'handed_off' }),
      'handed_off'
    );
    assert.equal(
      publicationLifecycleFromDelivery({
        deliveryKind: 'handed_off',
        publicationStatus: 'published',
      }),
      'published'
    );
  });

  it('fails closed without package revision', () => {
    const view = projectPublicationRecordPanel({});
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'missing_package_revision');
    assert.equal(view.canRecordManual, false);
    assert.equal(view.automaticPublishAllowed, false);
  });

  it('allows manual only; automatic publisher stays archived even if count > 0', () => {
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      variantVersionId: 'dy-v1',
      automaticVerifiedPlatformCount: 1,
    });
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.canRecordManual, true);
    assert.equal(view.automaticPublishAllowed, false);
    assert.match(view.automaticPublishBlockedReason ?? '', /归档|人工补记/u);
  });

  it('fails closed when the exact platform variant is absent', () => {
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
    });
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'missing_variant');
    assert.equal(view.canRecordManual, false);
  });

  it('projects records with source tier and supersede trail', () => {
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 4,
      variantVersionId: 'dy-v1',
      records: [
        baseRecord,
        {
          ...baseRecord,
          id: 'pub-2',
          contentPackageRevision: 4,
          createdAt: '2026-07-21T08:00:00.000Z',
          publishedAt: '2026-07-21T07:00:00.000Z',
          supersedesRecordId: 'pub-1',
          platformUrl: 'https://www.douyin.com/video/2',
        },
      ],
    });
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.records.length, 2);
    assert.equal(view.records[0]?.isSuperseded, true);
    assert.ok(view.records[1]?.supersedesLabel);
    assert.match(view.editCreatesNewRevisionNotice, /新版本/);
    assert.equal(view.canRecordManual, true);
  });

  it('validates manual form and builds idempotency key', () => {
    const invalid = validateManualPublicationForm(
      {
        platform: '',
        accountDisplayLabel: '',
        publishedAt: 'not-a-date',
        status: 'published',
        platformUrl: 'ftp://bad',
      },
      {
        contentPackageId: 'pkg-a',
        contentPackageRevision: 2,
        variantVersionId: 'dy-v1',
      }
    );
    assert.equal(invalid.ok, false);

    const valid = validateManualPublicationForm(
      {
        platform: 'douyin',
        accountDisplayLabel: '本店抖音',
        publishedAt: '2026-07-20T08:00:00.000Z',
        status: 'published',
        platformUrl: 'https://www.douyin.com/video/1',
      },
      {
        contentPackageId: 'pkg-a',
        contentPackageRevision: 2,
        variantVersionId: 'dy-v1',
      }
    );
    assert.equal(valid.ok, true);
    if (!valid.ok) return;
    // Header-safe fingerprint (never embeds free-text URL/note).
    assert.match(
      valid.idempotencyKey,
      /^pub\.douyin\.2\.[0-9a-z]+\.[0-9a-f-]{36}$/u
    );
  });

  it('maps delivery events to publication records only for publish results', () => {
    const records = publicationRecordsFromDeliveryEvents({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 3,
      events: [
        {
          id: 'e1',
          type: 'assisted_handoff_prepared',
          platform: 'douyin',
          actorId: 'a',
          occurredAt: '2026-07-20T07:00:00.000Z',
        },
        {
          id: 'e2',
          type: 'manual_publish_result',
          status: 'published',
          platform: 'douyin',
          actorId: 'a',
          occurredAt: '2026-07-20T08:00:00.000Z',
          platformUrl: 'https://www.douyin.com/video/1',
          variantVersionId: 'dy-v1',
        },
        {
          id: 'e3',
          type: 'legacy_handoff_event',
          platform: 'douyin',
          actorId: 'a',
          occurredAt: '2026-07-20T09:00:00.000Z',
        },
        {
          id: 'e4',
          type: 'automatic_publish_result',
          status: 'published',
          platform: 'xiaohongshu',
          actorId: 'a',
          occurredAt: '2026-07-19T08:00:00.000Z',
          providerReceiptId: 'xhs-historic',
        },
      ],
    });
    assert.equal(records.length, 2);
    assert.equal(records[0]?.sourceTier, 'manual_record');
    assert.equal(records[1]?.sourceTier, 'verified_callback');
    assert.equal(records[0]?.contentPackageRevision, 3);
  });
});
