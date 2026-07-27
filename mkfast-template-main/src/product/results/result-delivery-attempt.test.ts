import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resultDeliveryAttemptState,
  resultDeriveSessionId,
} from './result-live-projection';

type Facts = Parameters<typeof resultDeliveryAttemptState>[0];

function facts(overrides: Partial<NonNullable<Facts>> = {}): Facts {
  return {
    approvalRequests: [],
    deliveryEvents: [],
    exportReceipts: [],
    status: 'accepted',
    ...overrides,
  } as NonNullable<Facts>;
}

describe('delivery attempt projection', () => {
  it('is none for a package that has attempted nothing', () => {
    assert.equal(resultDeliveryAttemptState(undefined), 'none');
    assert.equal(resultDeliveryAttemptState(facts()), 'none');
  });

  it('is delivered once a publish result says published', () => {
    assert.equal(
      resultDeliveryAttemptState(
        facts({
          deliveryEvents: [
            {
              actorId: 'user-a',
              id: 'evt-1',
              occurredAt: '2026-07-20T08:00:00.000Z',
              platform: 'xiaohongshu',
              source: 'native',
              status: 'published',
              type: 'manual_publish_result',
              variantVersionId: 'v1',
            },
          ],
        } as Partial<NonNullable<Facts>>)
      ),
      'delivered'
    );
  });

  it('is failed when the export receipt failed', () => {
    assert.equal(
      resultDeliveryAttemptState(
        facts({
          exportReceipts: [
            {
              createdAt: '2026-07-20T08:00:00.000Z',
              failureCategory: 'render_failed',
              id: 'exp-1',
              platform: 'xiaohongshu',
              status: 'failed',
              variantVersionId: 'v1',
            },
          ],
        } as Partial<NonNullable<Facts>>)
      ),
      'failed'
    );
  });

  it('is awaiting_approval while an approval request is still pending', () => {
    assert.equal(
      resultDeliveryAttemptState(
        facts({
          approvalRequests: [{ id: 'req-1', status: 'pending' }],
        } as Partial<NonNullable<Facts>>)
      ),
      'awaiting_approval'
    );
  });

  it('is partial when materials went out and nothing came back', () => {
    assert.equal(
      resultDeliveryAttemptState(
        facts({
          deliveryEvents: [
            {
              actorId: 'user-a',
              id: 'evt-1',
              occurredAt: '2026-07-20T08:00:00.000Z',
              platform: 'xiaohongshu',
              source: 'native',
              type: 'assisted_handoff_prepared',
              variantVersionId: 'v1',
            },
          ],
        } as Partial<NonNullable<Facts>>)
      ),
      'partial'
    );
  });

  it('answers for the platform the page is standing on, not for the package', () => {
    const mixed = facts({
      deliveryEvents: [
        {
          actorId: 'user-a',
          id: 'evt-xhs',
          occurredAt: '2026-07-20T08:00:00.000Z',
          platform: 'xiaohongshu',
          source: 'native',
          status: 'published',
          type: 'manual_publish_result',
          variantVersionId: 'xhs-v1',
        },
        {
          actorId: 'user-a',
          id: 'evt-dy',
          occurredAt: '2026-07-20T09:00:00.000Z',
          platform: 'douyin',
          source: 'native',
          status: 'failed',
          type: 'manual_publish_result',
          variantVersionId: 'dy-v1',
        },
      ],
    } as Partial<NonNullable<Facts>>);

    assert.equal(
      resultDeliveryAttemptState(mixed, {
        platform: 'xiaohongshu',
        variantVersionId: 'xhs-v1',
      }),
      'delivered'
    );
    assert.equal(
      resultDeliveryAttemptState(mixed, {
        platform: 'douyin',
        variantVersionId: 'dy-v1',
      }),
      'failed'
    );
    // 视频号 has been neither published nor attempted on this package.
    assert.equal(
      resultDeliveryAttemptState(mixed, { platform: 'video_account' }),
      'none'
    );
    // Unscoped keeps the whole-package reading — 朋友圈 has no platform.
    assert.equal(resultDeliveryAttemptState(mixed), 'delivered');
    assert.equal(
      resultDeliveryAttemptState(mixed, { platform: null }),
      'delivered'
    );
  });

  it('does not carry another platform failure onto the current one', () => {
    const exported = facts({
      exportReceipts: [
        {
          createdAt: '2026-07-20T08:00:00.000Z',
          failureCategory: 'render_failed',
          id: 'exp-dy',
          platform: 'douyin',
          status: 'failed',
          variantVersionId: 'dy-v1',
        },
      ],
      status: 'export_failed',
    } as Partial<NonNullable<Facts>>);

    assert.equal(
      resultDeliveryAttemptState(exported, { platform: 'douyin' }),
      'failed'
    );
    assert.equal(
      resultDeliveryAttemptState(exported, { platform: 'xiaohongshu' }),
      'none'
    );
    // A pending approval is bound to one platform version too.
    const pending = facts({
      approvalRequests: [
        {
          id: 'req-1',
          platform: 'douyin',
          status: 'pending',
          variantVersionId: 'dy-v1',
        },
      ],
    } as Partial<NonNullable<Facts>>);
    assert.equal(
      resultDeliveryAttemptState(pending, { platform: 'douyin' }),
      'awaiting_approval'
    );
    assert.equal(
      resultDeliveryAttemptState(pending, { platform: 'xiaohongshu' }),
      'none'
    );
  });

  it('lets a published result win over an earlier handoff', () => {
    assert.equal(
      resultDeliveryAttemptState(
        facts({
          deliveryEvents: [
            {
              actorId: 'user-a',
              id: 'evt-1',
              occurredAt: '2026-07-20T08:00:00.000Z',
              platform: 'xiaohongshu',
              source: 'native',
              type: 'assisted_handoff_prepared',
              variantVersionId: 'v1',
            },
            {
              actorId: 'user-a',
              id: 'evt-2',
              occurredAt: '2026-07-20T09:00:00.000Z',
              platform: 'xiaohongshu',
              source: 'native',
              status: 'published',
              type: 'manual_publish_result',
              variantVersionId: 'v1',
            },
          ],
        } as Partial<NonNullable<Facts>>)
      ),
      'delivered'
    );
  });
});

describe('derive session id', () => {
  it('never forwards a Composer session id core would refuse', () => {
    // What the submission coordinator actually writes onto a Composer Work.
    assert.equal(
      resultDeriveSessionId({
        id: 'work-9d1f',
        sessionId: 'composer:surface.home.launch:surface.home.launch@1',
      }),
      'result-derive:work-9d1f'
    );
    assert.match(
      resultDeriveSessionId({ id: 'work-9d1f' }),
      /^[A-Za-z0-9._:-]{1,160}$/u
    );
    // A session id already in the charset is kept — the derive stays in session.
    assert.equal(
      resultDeriveSessionId({
        id: 'work-9d1f',
        sessionId: 'weekly:cta:work-1',
      }),
      'weekly:cta:work-1'
    );
  });
});
