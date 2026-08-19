import type { ApprovalReceipt } from '@meiye/contracts';

import type {
  DeliveryActorContext,
  DeliveryApplication,
  DeliveryEntry,
} from './delivery-application.js';

export {
  DELIVERY_ENTRIES,
  type DeliveryEntry,
} from './delivery-application.js';

/**
 * Thin UI-entry adapters. They only stamp the entry tag; DeliveryApplication
 * owns prepare / handoff / consume / outcome / projection.
 */
export function createDeliveryEntryAdapter(
  application: DeliveryApplication,
  entry: DeliveryEntry,
) {
  return {
    entry,
    consume(
      context: DeliveryActorContext,
      input: { approvalReceiptId: string; packageId: string },
    ) {
      return application.consume(context, { ...input, entry });
    },
    prepareCanonicalHandoff(
      context: DeliveryActorContext,
      input: {
        expectedRevision: number;
        packageId: string;
        platform: string;
        variantVersionId: string;
        workId?: string;
      },
    ) {
      return application.prepareCanonicalHandoff(context, { ...input, entry });
    },
    preparePackage(
      context: DeliveryActorContext,
      input: {
        packageId: string;
        platform: ApprovalReceipt['binding']['platform'];
        variantVersionId: string;
      },
    ) {
      return application.preparePackage(context, { ...input, entry });
    },
    projectState(
      context: DeliveryActorContext,
      input: { approvalReceiptId: string; packageId: string },
    ) {
      return application.projectState(context, { ...input, entry });
    },
    recordOutcome(
      context: DeliveryActorContext,
      input: {
        expectedRevision: number;
        note?: string;
        packageId: string;
        platform: string;
        platformUrl?: string;
        variantVersionId: string;
        workId?: string;
      },
    ) {
      return application.recordOutcome(context, { ...input, entry });
    },
  };
}

export type DeliveryEntryAdapter = ReturnType<typeof createDeliveryEntryAdapter>;
