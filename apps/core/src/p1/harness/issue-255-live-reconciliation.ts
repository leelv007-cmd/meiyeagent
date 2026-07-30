import { z } from 'zod';

import type { FoundationStore } from '../foundation/ports.js';
import type { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';

export async function reconcileIssue255LiveRun(input: {
  foundation: FoundationStore;
  receipts: PostgresIssue255LiveReceiptRepository;
  runNonce: string;
}) {
  const runNonce = z.string().trim().min(1).parse(input.runNonce);
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v1') {
    await input.receipts.migrateLegacyRejectedBeforeBillingV1();
    return input.receipts.confirmFailedBeforeBilling(
      runNonce,
      input.foundation,
    );
  }
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v2') {
    return [await input.receipts.reconcileLegacyAcceptedImageWithoutTaskRefV2()];
  }
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v3') {
    await input.receipts.prepareCoordinatorVideoV3FailedBeforeBilling();
    return input.receipts.confirmFailedBeforeBilling(
      runNonce,
      input.foundation,
    );
  }
  const unknown = (await input.receipts.listRun(runNonce)).filter(
    ({ status }) => status === 'unknown',
  );
  if (unknown.length === 0) {
    throw new Error(
      'Issue 255 reconciliation requires at least one unknown receipt.',
    );
  }
  const reconciled = [];
  for (const receipt of unknown) {
    reconciled.push(
      await input.receipts.reconcileFromProviderLedger(
        {
          runNonce,
          modality: receipt.modality,
          effectId: receipt.effectId,
          requestFingerprint: receipt.requestFingerprint,
        },
        input.foundation,
      ),
    );
  }
  return reconciled;
}
