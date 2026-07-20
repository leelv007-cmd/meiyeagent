import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanonicalAssistedHandoff } from './delivery-assisted-live';

test('live assisted action exports then binds and hands over the exact canonical revision once', async () => {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const result = await createCanonicalAssistedHandoff({
    exportPackage: async () => ({
      contentPackage: {
        approvalReceipts: [
          {
            binding: {
              accountId: 'account-1',
              actionScheduledAt: '2026-07-20T13:00:00.000Z',
              cost: { amount: 8, currency: 'CNY' as const },
              packageId: 'pkg-1',
              platform: 'xiaohongshu' as const,
              purpose: 'public_content',
              variantVersionId: 'version-1',
              workspaceId: 'ws-1',
            },
            id: 'approval-1',
            status: 'approved' as const,
          },
        ],
        id: 'pkg-1',
        revision: 5,
        variants: [
          {
            currentVersionId: 'version-1',
            platform: 'xiaohongshu' as const,
          },
        ],
        workspaceId: 'ws-1',
      },
      downloadUrl: '/download/package.zip',
      receiptId: 'export-1',
    }),
    nowIso: '2026-07-20T12:00:00.000Z',
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
    responsibility: {
      ownerId: 'publisher-li',
      responsibilityRole: 'external_owner',
    },
    submit: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'assisted_prepare') {
        return { receipt: { id: 'assisted-1' }, revision: 0 };
      }
      return {
        receipt: {
          handoffLink: { token: 'handoff-token-12345678' },
          id: 'assisted-1',
          status: 'handed_over',
        },
        revision: 1,
      };
    },
  });

  assert.equal(calls[0]?.action, 'assisted_prepare');
  assert.deepEqual(calls[0]?.payload, {
    contentPackageRevision: 5,
    exportReceiptId: 'export-1',
    id: 'assisted:pkg-1:xiaohongshu:version-1:export-1',
    occurredAt: '2026-07-20T12:00:00.000Z',
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
    variantVersionId: 'version-1',
  });
  assert.equal(calls[1]?.action, 'assisted_hand_over');
  assert.deepEqual(
    (calls[1]?.payload.binding as { ownerId?: string; accountId?: string }),
    {
      accountId: 'account-1',
      approvalReceiptId: 'approval-1',
      contentPackageRevision: 5,
      costRange: { currency: 'CNY', maxAmount: 8, minAmount: 0 },
      ownerId: 'publisher-li',
      packageId: 'pkg-1',
      platform: 'xiaohongshu',
      purpose: 'public_content',
      responsibilityRole: 'external_owner',
      scheduledAt: '2026-07-20T13:00:00.000Z',
      variantVersionId: 'version-1',
      workspaceId: 'ws-1',
    },
  );
  assert.equal(result.handoffToken, 'handoff-token-12345678');
  assert.equal(result.downloadUrl, '/download/package.zip');
});
