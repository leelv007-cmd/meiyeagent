import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_PACKAGE_COMMAND_SCHEMAS } from '@meiye/contracts';

import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import { buildContentPackage } from '../operations/content-package.js';
import { OperationsFoundationModule } from '../operations/foundation-module.js';
import type { OperationsApplicationService } from '../operations/application-service.js';
import type { ContentPackageDeliveryService } from '../operations/content-package-delivery.js';
import {
  defineWiringNegativeCorpus,
  WIRING_NEGATIVE_CASE_IDS,
} from '../testing/wiring-negative-corpus.js';

const deliveryAction = 'deliver_content_package';
const wiringContext = {
  correlationId: 'wiring-negative',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};
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

const negativeCorpus = defineWiringNegativeCorpus({
  async 'available-but-unbound'() {
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
        context: wiringContext,
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
            return productionContentPackage('package-a');
          },
        } as unknown as ContentPackageDeliveryService,
      },
    );
    await bound.execute({
      context: wiringContext,
      input: { action: deliveryAction, payload: validDeliveryPayload },
    });
    assert.equal(deliveryCalls, 1);
  },
  async 'dynamic-not-in-inventory'() {
    const dynamicAction = 'deliver_content_package_dynamic';
    assert.equal(inventoryKeys.includes(dynamicAction), false);
    await assert.rejects(
      new OperationsFoundationModule(
        {} as OperationsApplicationService,
      ).execute({
        context: wiringContext,
        input: {
          action: dynamicAction,
          payload: validDeliveryPayload,
        },
      }),
      /Unknown operations command/u,
    );
  },
  'inventory-blind-to-closure'() {
    const blindSnapshot = inventoryKeys.filter(
      (key) => key !== deliveryAction,
    );
    assert.throws(
      () =>
        assert.ok(
          blindSnapshot.includes(deliveryAction),
          'public delivery closure is missing from the inventory snapshot',
        ),
      /public delivery closure is missing/u,
    );
  },
  async 'invalid-shape-silently-inert'() {
    let deliveryCalls = 0;
    const module = new OperationsFoundationModule(
      {} as OperationsApplicationService,
      {
        delivery: {
          async deliver() {
            deliveryCalls += 1;
            return productionContentPackage('unreachable');
          },
        } as unknown as ContentPackageDeliveryService,
      },
    );
    await assert.rejects(
      module.execute({
        context: wiringContext,
        input: { action: deliveryAction, payload: {} },
      }),
    );
    assert.equal(deliveryCalls, 0);
  },
  'duplicate-authority-key'() {
    const first = new OperationsFoundationModule(
      {} as OperationsApplicationService,
    );
    const duplicate = new OperationsFoundationModule(
      {} as OperationsApplicationService,
    );
    assert.throws(
      () =>
        new P1ApplicationService(new MemoryFoundationRepository(), {
          operations: [first, duplicate],
        }),
      /Operation operations is already registered/u,
    );
  },
});

for (const caseId of WIRING_NEGATIVE_CASE_IDS) {
  test(`production wiring negative corpus detects ${caseId}`, async () => {
    await negativeCorpus[caseId]();
  });
}

function productionContentPackage(id: string) {
  return buildContentPackage({
    id,
    kind: 'image_text',
    source: { assetIds: [] },
    timestamp: '2026-07-29T08:00:00.000Z',
    workspaceId: wiringContext.workspaceId,
  });
}
