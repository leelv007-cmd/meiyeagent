import type { OwnedAsset } from './supply-contracts.js';

export type OwnedAssetRegistrationFailureStage =
  | 'content_package_persistence'
  | 'ledger_settlement'
  | 'receipt_registration'
  | 'result_persistence';

/** Optional durable-storage seam used only when an asset registration fails. */
export interface OwnedAssetRegistrationLifecyclePort {
  recordOwnedAssetRegistrationFailure(input: {
    asset: OwnedAsset;
    error: unknown;
    failureStage: OwnedAssetRegistrationFailureStage;
    workspaceId: string;
  }): Promise<void>;
}

export function ownedAssetRegistrationLifecycle(
  storage: unknown,
): OwnedAssetRegistrationLifecyclePort | undefined {
  if (
    storage &&
    typeof storage === 'object' &&
    typeof Reflect.get(storage, 'recordOwnedAssetRegistrationFailure') ===
      'function'
  ) {
    return storage as OwnedAssetRegistrationLifecyclePort;
  }
  return undefined;
}
