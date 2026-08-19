/**
 * UI adapters for DEL-02 / R-P1-03. Workbench, Pending Inbox, and Result
 * Center only stamp an entry tag; Core DeliveryApplication owns state.
 */

export const DELIVERY_ENTRIES = [
  'workbench',
  'pending_inbox',
  'result_center',
] as const;

export type DeliveryEntry = (typeof DELIVERY_ENTRIES)[number];

export type DeliveryCommandTransport = {
  command(
    module: 'operations' | 'result-delivery',
    action: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<unknown>;
  query(
    module: 'operations' | 'result-delivery',
    action: string,
    payload: Record<string, unknown>
  ): Promise<unknown>;
};

export function createDeliveryUiAdapter(
  entry: DeliveryEntry,
  transport: DeliveryCommandTransport
) {
  return {
    entry,
    consume(input: {
      approvalReceiptId: string;
      packageId: string;
      idempotencyKey: string;
    }) {
      return transport.command(
        'result-delivery',
        'delivery_consume',
        {
          approvalReceiptId: input.approvalReceiptId,
          entry,
          packageId: input.packageId,
        },
        input.idempotencyKey
      );
    },
    prepareCanonicalHandoff(input: {
      expectedRevision: number;
      idempotencyKey: string;
      packageId: string;
      platform: string;
      variantVersionId: string;
      workId?: string;
    }) {
      if (entry === 'workbench') {
        return transport.command(
          'operations',
          'prepare_mobile_publish_handoff',
          {
            expectedRevision: input.expectedRevision,
            packageId: input.packageId,
            platform: input.platform,
            variantVersionId: input.variantVersionId,
            ...(input.workId ? { workId: input.workId } : {}),
          },
          input.idempotencyKey
        );
      }
      return transport.command(
        'result-delivery',
        'delivery_prepare_canonical_handoff',
        {
          entry,
          expectedRevision: input.expectedRevision,
          packageId: input.packageId,
          platform: input.platform,
          variantVersionId: input.variantVersionId,
          ...(input.workId ? { workId: input.workId } : {}),
        },
        input.idempotencyKey
      );
    },
    projectState(input: { approvalReceiptId: string; packageId: string }) {
      return transport.query('result-delivery', 'delivery_project_state', {
        approvalReceiptId: input.approvalReceiptId,
        entry,
        packageId: input.packageId,
      });
    },
    recordOutcome(input: {
      expectedRevision: number;
      idempotencyKey: string;
      packageId: string;
      platform: string;
      variantVersionId: string;
      workId?: string;
    }) {
      return transport.command(
        'result-delivery',
        'delivery_record_outcome',
        {
          entry,
          expectedRevision: input.expectedRevision,
          packageId: input.packageId,
          platform: input.platform,
          variantVersionId: input.variantVersionId,
          ...(input.workId ? { workId: input.workId } : {}),
        },
        input.idempotencyKey
      );
    },
  };
}

export type DeliveryUiAdapter = ReturnType<typeof createDeliveryUiAdapter>;
