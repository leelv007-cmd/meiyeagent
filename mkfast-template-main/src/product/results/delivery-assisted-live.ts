import type {
  AssistedReceipt,
  AssistedResponsibilityRole,
  DeliveryZipPlatform,
} from './delivery-b3-types';

type ActiveApproval = {
  binding: {
    accountId: string;
    actionScheduledAt: string;
    cost: { amount: number; currency: 'CNY' | 'USD' };
    packageId: string;
    platform: DeliveryZipPlatform;
    purpose: string;
    variantVersionId: string;
    workspaceId: string;
  };
  id: string;
  status: 'approved' | 'consumed' | 'invalidated';
};

type ExportedCanonicalPackage = {
  contentPackage: {
    approvalReceipts?: ActiveApproval[];
    id: string;
    revision: number;
    variants: Array<{
      currentVersionId: string;
      platform: DeliveryZipPlatform;
    }>;
    workspaceId: string;
  };
  downloadUrl: string;
  receiptId: string;
};

export type AssistedResponsibilityInput = {
  ownerId?: string;
  responsibilityRole: AssistedResponsibilityRole;
};

export async function createCanonicalAssistedHandoff(input: {
  exportPackage(): Promise<ExportedCanonicalPackage>;
  nowIso: string;
  packageId: string;
  platform: DeliveryZipPlatform;
  responsibility: AssistedResponsibilityInput;
  submit(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
}): Promise<{
  downloadUrl: string;
  handoffToken: string;
  receipt: AssistedReceipt;
  revision: number;
}> {
  const exported = await input.exportPackage();
  const contentPackage = exported.contentPackage;
  if (contentPackage.id !== input.packageId) {
    throw new Error('ASSISTED_CANONICAL_PACKAGE_MISMATCH');
  }
  const variant = contentPackage.variants.find(
    ({ platform }) => platform === input.platform,
  );
  if (!variant) throw new Error('ASSISTED_CANONICAL_VARIANT_MISSING');
  const approval = contentPackage.approvalReceipts?.find(
    (candidate) =>
      candidate.status === 'approved' &&
      candidate.binding.workspaceId === contentPackage.workspaceId &&
      candidate.binding.packageId === contentPackage.id &&
      candidate.binding.platform === input.platform &&
      candidate.binding.variantVersionId === variant.currentVersionId,
  );
  if (!approval) throw new Error('ASSISTED_CANONICAL_APPROVAL_MISSING');
  if (
    input.responsibility.responsibilityRole === 'external_owner' &&
    !input.responsibility.ownerId?.trim()
  ) {
    throw new Error('ASSISTED_EXTERNAL_OWNER_REQUIRED');
  }

  const receiptId = [
    'assisted',
    contentPackage.id,
    input.platform,
    variant.currentVersionId,
    exported.receiptId,
  ].join(':');
  const prepared = (await input.submit('assisted_prepare', {
    contentPackageRevision: contentPackage.revision,
    exportReceiptId: exported.receiptId,
    id: receiptId,
    occurredAt: input.nowIso,
    packageId: contentPackage.id,
    platform: input.platform,
    variantVersionId: variant.currentVersionId,
  })) as { receipt: AssistedReceipt; revision: number };

  const handed = (await input.submit('assisted_hand_over', {
    binding: {
      accountId: approval.binding.accountId,
      approvalReceiptId: approval.id,
      contentPackageRevision: contentPackage.revision,
      costRange: {
        currency: approval.binding.cost.currency,
        maxAmount: approval.binding.cost.amount,
        minAmount: 0,
      },
      ...(input.responsibility.responsibilityRole === 'external_owner'
        ? { ownerId: input.responsibility.ownerId!.trim() }
        : {}),
      packageId: contentPackage.id,
      platform: input.platform,
      purpose: approval.binding.purpose,
      responsibilityRole: input.responsibility.responsibilityRole,
      scheduledAt: approval.binding.actionScheduledAt,
      variantVersionId: variant.currentVersionId,
      workspaceId: contentPackage.workspaceId,
    },
    expectedRevision: prepared.revision,
    occurredAt: input.nowIso,
    receiptId,
  })) as { receipt: AssistedReceipt; revision: number };
  const handoffToken = handed.receipt.handoffLink?.token;
  if (!handoffToken) throw new Error('ASSISTED_HANDOFF_LINK_MISSING');
  return {
    downloadUrl: exported.downloadUrl,
    handoffToken,
    receipt: handed.receipt,
    revision: handed.revision,
  };
}
