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
        'plan.credits.growth',
        JSON.stringify({
          concurrencyLimit: 4,
          credits: 1_300,
          currency: 'HKD',
          monthlyPriceMicros: 579_700_809,
          queuePriority: 5,
          storageMb: 5_120,
          supportLabel: 'priority',
        })
      ),
      {
        concurrencyLimit: 4,
        credits: 1_300,
        currency: 'HKD',
        monthlyPriceMicros: 579_700_809,
        queuePriority: 5,
        storageMb: 5_120,
        supportLabel: 'priority',
      }
    );
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.credits.cycle_coefficients',
        JSON.stringify({ monthly: 9_000, single_month: 10_000, yearly: 7_500 })
      ),
      { monthly: 9_000, single_month: 10_000, yearly: 7_500 }
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.credits.starter',
          JSON.stringify({
            concurrencyLimit: 1,
            credits: 500,
            currency: 'CNY',
            monthlyPriceMicros: 0,
            queuePriority: 1,
            storageMb: 1_024,
            supportLabel: 'standard',
          })
        ),
      /selected config key/i
    );
    assert.equal(
      (
        parseAdminConfigDraft(
          'plan.credits.trial',
          JSON.stringify({
            concurrencyLimit: 1,
            credits: 100,
            currency: 'HKD',
            monthlyPriceMicros: 0,
            queuePriority: 1,
            storageMb: 512,
            supportLabel: 'standard',
          })
        ) as { monthlyPriceMicros: number }
      ).monthlyPriceMicros,
      0
    );
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.credits.addons',
        JSON.stringify([
          {
            amountMicros: 57_000_000,
            credits: 100,
            currency: 'HKD',
            expireDays: 7,
            id: 'credits-100',
          },
        ])
      ),
      [
        {
          amountMicros: 57_000_000,
          credits: 100,
          currency: 'HKD',
          expireDays: 7,
          id: 'credits-100',
        },
      ]
    );
    assert.throws(
      () =>
        parseAdminConfigDraft(
          'plan.credits.addons',
          JSON.stringify([
            {
              amountMicros: 49_000_000,
              credits: 100,
              currency: 'CNY',
              expireDays: 7,
              id: 'credits-100',
            },
          ])
        ),
      /selected config key/i
    );
    assert.deepEqual(
      parseAdminConfigDraft(
        'plan.credits.starter',
        JSON.stringify({
          concurrencyLimit: 1,
          credits: 500,
          currency: 'HKD',
          monthlyPriceMicros: 231_000_000,
          queuePriority: 1,
          storageMb: 1024,
          supportLabel: 'standard',
        })
      ),
      {
        concurrencyLimit: 1,
        credits: 500,
        currency: 'HKD',
        monthlyPriceMicros: 231_000_000,
        queuePriority: 1,
        storageMb: 1024,
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
      () =>
        parseAdminConfigDraft(
          'plan.allowances.starter',
          JSON.stringify({
            allowance: { audio: 0, copy: 30, image: 10, video: 5 },
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
          'plan.credits.starter',
          JSON.stringify({
            concurrencyLimit: 1,
            credits: 10_000_001,
            currency: 'HKD',
            monthlyPriceMicros: 231_000_000,
            queuePriority: 1,
            storageMb: 1024,
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
