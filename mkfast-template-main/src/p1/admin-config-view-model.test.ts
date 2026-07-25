import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatAdminConfigValue,
  parseAdminConfigDraft,
  runtimeSnapshotStatus,
} from './admin-config-view-model.js';

describe('admin config form values', () => {
  it('validates values against the selected registered key', () => {
    assert.equal(
      parseAdminConfigDraft('model.execution.mode', '"direct"'),
      'direct'
    );
    assert.equal(
      parseAdminConfigDraft('compliance.watermark.default', 'true'),
      true
    );
    assert.equal(parseAdminConfigDraft('plan.trial.enabled', 'false'), false);
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.allowances.starter',
        JSON.stringify({
          allowance: { audio: 8, copy: 30, image: 10, video: 5 },
          concurrencyLimit: 1,
          queuePriority: 1,
          supportLabel: 'standard',
        })
      ),
      {
        allowance: { audio: 8, copy: 30, image: 10, video: 5 },
        concurrencyLimit: 1,
        queuePriority: 1,
        supportLabel: 'standard',
      }
    );
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.addons',
        JSON.stringify([
          {
            amountMicros: 100_000,
            currency: 'CNY',
            id: 'audio-100',
            quantity: 100,
            resource: 'audio',
          },
        ])
      ),
      [
        {
          amountMicros: 100_000,
          currency: 'CNY',
          id: 'audio-100',
          quantity: 100,
          resource: 'audio',
        },
      ]
    );
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.payment-mapping',
        JSON.stringify({
          mappings: [
            {
              paymentProductId: ' price_growth ',
              interval: 'month',
              tier: 'growth',
            },
          ],
        })
      ),
      {
        mappings: [
          {
            paymentProductId: 'price_growth',
            interval: 'month',
            tier: 'growth',
          },
        ],
      }
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.payment-mapping',
          JSON.stringify({
            mappings: [
              {
                paymentProductId: 'price_free',
                interval: 'any',
                tier: 'trial',
              },
            ],
          })
        ),
      /selected config key/i
    );
    assert.throws(
      () => parseAdminConfigDraft('model.execution.mode', '"unknown"'),
      /selected config key/i
    );
    assert.throws(
      () => parseAdminConfigDraft('douyin.adapter.assembly', '"live"'),
      /selected config key/i
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.allowances.starter',
          JSON.stringify({
            allowance: { audio: 0, copy: 1_000_001, image: 10, video: 5 },
            concurrencyLimit: 1,
            queuePriority: 1,
            supportLabel: 'standard',
          })
        ),
      /selected config key/i
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.addons',
          JSON.stringify(
            Array.from({ length: 101 }, (_, index) => ({
              amountMicros: 100_000,
              currency: 'CNY',
              id: `audio-${index}`,
              quantity: 100,
              resource: 'audio',
            }))
          )
        ),
      /selected config key/i
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.addons',
          JSON.stringify([
            {
              amountMicros: 100_000,
              currency: 'CNY',
              id: 'duplicate-audio',
              quantity: 100,
              resource: 'audio',
            },
            {
              amountMicros: 200_000,
              currency: 'CNY',
              id: 'duplicate-audio',
              quantity: 200,
              resource: 'audio',
            },
          ])
        ),
      /selected config key/i
    );
  });

  it('formats scalars and structured values as editable JSON', () => {
    assert.equal(formatAdminConfigValue('direct'), '"direct"');
    assert.equal(formatAdminConfigValue(true), 'true');
    assert.equal(
      formatAdminConfigValue({ enabled: true }),
      '{\n  "enabled": true\n}'
    );
  });

  it('reports each process snapshot as current or restart-pending', () => {
    assert.equal(runtimeSnapshotStatus('direct', 'direct'), 'current');
    assert.equal(
      runtimeSnapshotStatus('direct', 'recorded'),
      'restart_pending'
    );
  });
});
