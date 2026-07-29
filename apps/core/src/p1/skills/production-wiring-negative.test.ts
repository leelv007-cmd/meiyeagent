import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE_COMMAND_SCHEMAS } from '@meiye/contracts';

import { buildContentPackage } from '../operations/content-package.js';
import { OperationsFoundationModule } from '../operations/foundation-module.js';
import type { OperationsApplicationService } from '../operations/application-service.js';
import type { ContentPackageDeliveryService } from '../operations/content-package-delivery.js';
import {
  defineWiringNegativeCorpus,
  detectWiringEvidenceFailures,
  type WiringEvidenceProbe,
} from '../testing/wiring-negative-corpus.js';

const deliveryAction = 'deliver_content_package';
const validDeliveryPayload = {
  accountId: 'douyin-account-a',
  actionKind: 'publish' as const,
  actionScheduledAt: '2026-07-29T08:00:00.000Z',
  cost: { amount: 0, currency: 'CNY' as const },
  expectedRevision: 2,
  packageId: 'package-a',
  platform: 'douyin' as const,
  purpose: 'publish_current_variant',
  receiptId: 'approval-receipt-a',
  variantVersionId: 'douyin-v2',
};
const inventoryKeys = Object.keys(CONTENT_PACKAGE_COMMAND_SCHEMAS);

function healthyProbe(): WiringEvidenceProbe {
  return {
    authorityKeys: inventoryKeys,
    availableKeys: inventoryKeys,
    boundKeys: inventoryKeys,
    closureRequiredKeys: [deliveryAction],
    dynamicKeys: [],
    inventoryKeys,
    invalidShapeKeys: [],
  };
}

const negativeCorpus = defineWiringNegativeCorpus({
  'available-but-unbound': {
    probe: {
      ...healthyProbe(),
      boundKeys: inventoryKeys.filter((key) => key !== deliveryAction),
    },
  },
  'dynamic-not-in-inventory': {
    probe: {
      ...healthyProbe(),
      dynamicKeys: ['deliver_content_package_dynamic'],
    },
  },
  'inventory-blind-to-closure': {
    probe: {
      ...healthyProbe(),
      inventoryKeys: inventoryKeys.filter((key) => key !== deliveryAction),
    },
  },
  'invalid-shape-silently-inert': {
    probe: {
      ...healthyProbe(),
      invalidShapeKeys: [
        CONTENT_PACKAGE_COMMAND_SCHEMAS.deliver_content_package.safeParse({})
          .success
          ? ''
          : deliveryAction,
      ].filter(Boolean),
    },
  },
  'duplicate-authority-key': {
    probe: {
      ...healthyProbe(),
      authorityKeys: [...inventoryKeys, deliveryAction],
    },
  },
});

test('shared corpus baseline adds no synthetic defect to the production command inventory', () => {
  assert.deepEqual(detectWiringEvidenceFailures(healthyProbe()), []);
});

for (const negative of negativeCorpus) {
  test(`production wiring negative corpus detects ${negative.caseId}`, () => {
    assert.deepEqual(detectWiringEvidenceFailures(negative.value.probe), [
      negative.caseId,
    ]);
  });
}

test('delivery schema inventory is bound to the public Operations module only when the production dependency exists', async () => {
  assert.equal(
    CONTENT_PACKAGE_COMMAND_SCHEMAS.deliver_content_package.safeParse(
      validDeliveryPayload,
    ).success,
    true,
  );

  const unbound = new OperationsFoundationModule(
    {} as OperationsApplicationService,
  );
  await assert.rejects(
    unbound.execute({
      context: {
        correlationId: 'wiring-negative-unbound',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      input: { action: deliveryAction, payload: validDeliveryPayload },
    }),
    /ContentPackage delivery is unavailable/u,
  );

  let deliveryCalls = 0;
  const bound = new OperationsFoundationModule(
    {} as OperationsApplicationService,
    {
      delivery: {
        async deliver() {
          deliveryCalls += 1;
          return buildContentPackage({
            id: 'package-a',
            kind: 'image_text',
            source: { assetIds: [] },
            timestamp: '2026-07-29T08:00:00.000Z',
            workspaceId: 'workspace-a',
          });
        },
      } as unknown as ContentPackageDeliveryService,
    },
  );
  await bound.execute({
    context: {
      correlationId: 'wiring-negative-bound',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    input: { action: deliveryAction, payload: validDeliveryPayload },
  });
  assert.equal(deliveryCalls, 1);
});

test('invalid and unregistered delivery inputs fail before the production dependency is invoked', async () => {
  let deliveryCalls = 0;
  const module = new OperationsFoundationModule(
    {} as OperationsApplicationService,
    {
      delivery: {
        async deliver() {
          deliveryCalls += 1;
          return { id: 'package-a' };
        },
      } as unknown as ContentPackageDeliveryService,
    },
  );
  const context = {
    correlationId: 'wiring-negative-input',
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  };

  await assert.rejects(
    module.execute({
      context,
      input: { action: deliveryAction, payload: {} },
    }),
  );
  await assert.rejects(
    module.execute({
      context,
      input: {
        action: 'deliver_content_package_dynamic',
        payload: validDeliveryPayload,
      },
    }),
    /Unknown operations command/u,
  );
  assert.equal(deliveryCalls, 0);
});
