import type {
  AssistedReceipt,
  AssistedReceiptBinding,
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
  submit(action: string, payload: Record<string, unknown>): Promise<unknown>;
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
    ({ platform }) => platform === input.platform
  );
  if (!variant) throw new Error('ASSISTED_CANONICAL_VARIANT_MISSING');
  const approval = contentPackage.approvalReceipts?.find((candidate) => {
    const bound =
      candidate.binding.workspaceId === contentPackage.workspaceId &&
      candidate.binding.packageId === contentPackage.id &&
      candidate.binding.platform === input.platform &&
      candidate.binding.variantVersionId === variant.currentVersionId;
    if (!bound) return false;
    if (input.responsibility.responsibilityRole === 'self_publish') {
      return candidate.status === 'approved' || candidate.status === 'consumed';
    }
    return candidate.status === 'approved';
  });
  if (!approval) throw new Error('ASSISTED_CANONICAL_APPROVAL_MISSING');
  if (
    input.responsibility.responsibilityRole === 'external_owner' &&
    !input.responsibility.ownerId?.trim()
  ) {
    throw new Error('ASSISTED_EXTERNAL_OWNER_REQUIRED');
  }

  if (input.responsibility.responsibilityRole === 'self_publish') {
    return handOverMerchantSelfAssisted({
      approvalId: approval.id,
      binding: {
        accountId: approval.binding.accountId,
        approvalReceiptId: approval.id,
        contentPackageRevision: contentPackage.revision,
        costRange: {
          currency: approval.binding.cost.currency,
          maxAmount: approval.binding.cost.amount,
          minAmount: 0,
        },
        packageId: contentPackage.id,
        platform: input.platform,
        purpose: approval.binding.purpose,
        responsibilityRole: 'self_publish',
        scheduledAt: approval.binding.actionScheduledAt,
        variantVersionId: variant.currentVersionId,
        workspaceId: contentPackage.workspaceId,
      },
      downloadUrl: exported.downloadUrl,
      exportReceiptId: exported.receiptId,
      nowIso: input.nowIso,
      packageId: contentPackage.id,
      packageRevision: contentPackage.revision,
      platform: input.platform,
      submit: input.submit,
      variantVersionId: variant.currentVersionId,
      workspaceId: contentPackage.workspaceId,
    });
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
      ownerId: input.responsibility.ownerId!.trim(),
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

function commandErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

async function handOverMerchantSelfAssisted(input: {
  approvalId: string;
  binding: AssistedReceiptBinding;
  downloadUrl: string;
  exportReceiptId: string;
  nowIso: string;
  packageId: string;
  packageRevision: number;
  platform: DeliveryZipPlatform;
  submit(action: string, payload: Record<string, unknown>): Promise<unknown>;
  variantVersionId: string;
  workspaceId: string;
}): Promise<{
  downloadUrl: string;
  handoffToken: string;
  receipt: AssistedReceipt;
  revision: number;
}> {
  let packageRevision = input.packageRevision;
  try {
    const consumed = (await input.submit('delivery_consume', {
      approvalReceiptId: input.approvalId,
      entry: 'result_center',
      packageId: input.packageId,
    })) as { package?: { revision?: number } };
    if (typeof consumed.package?.revision === 'number') {
      packageRevision = consumed.package.revision;
    }
  } catch (error) {
    if (commandErrorCode(error) !== 'APPROVAL_ALREADY_CONSUMED') throw error;
  }

  const preparedHandoff = (await input.submit(
    'delivery_prepare_canonical_handoff',
    {
      entry: 'result_center',
      expectedRevision: packageRevision,
      packageId: input.packageId,
      platform: input.platform,
      variantVersionId: input.variantVersionId,
    }
  )) as {
    contentPackageRef?: { revision?: number | string };
    mobileHandoff?: {
      expiresAt?: string;
      handoffId?: string;
      token?: string;
    };
  };
  const mobile = preparedHandoff.mobileHandoff;
  if (!mobile?.token || !mobile.handoffId || !mobile.expiresAt) {
    throw new Error('ASSISTED_HANDOFF_LINK_MISSING');
  }
  const handoffToken = mobile.token;
  const revision =
    typeof preparedHandoff.contentPackageRef?.revision === 'number'
      ? preparedHandoff.contentPackageRef.revision
      : packageRevision;
  return {
    downloadUrl: input.downloadUrl,
    handoffToken,
    receipt: {
      binding: input.binding,
      events: [
        {
          actorId: input.binding.accountId ?? input.workspaceId,
          occurredAt: input.nowIso,
          type: 'materials_prepared',
        },
        {
          actorId: input.binding.accountId ?? input.workspaceId,
          occurredAt: input.nowIso,
          type: 'handed_over',
        },
      ],
      exportReceiptId: input.exportReceiptId,
      handoffLink: {
        createdAt: input.nowIso,
        expiresAt: mobile.expiresAt,
        token: handoffToken,
      },
      id: mobile.handoffId,
      packageId: input.packageId,
      status: 'handed_over',
      workspaceId: input.workspaceId,
    },
    revision,
  };
}
