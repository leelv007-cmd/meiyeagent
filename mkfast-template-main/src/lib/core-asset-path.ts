import { isSharedWorkspaceAssetObjectKey } from '@meiye/contracts';

export function isAllowedWorkspaceAssetObjectKey(objectKey: string) {
  return isSharedWorkspaceAssetObjectKey(objectKey);
}
