import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resultDeliveryAttemptState } from './result-live-projection';

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
