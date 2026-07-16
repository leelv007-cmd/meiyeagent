const workspaceAssetObjectKeyPattern =
  /^[A-Za-z0-9._-]+\/(?:generated\/[a-f0-9]{64}\.(?:png|mp4|zip)|composed\/[a-f0-9]{64}\.(?:png|mp4))$/;

export function isAllowedWorkspaceAssetObjectKey(objectKey: string) {
  return workspaceAssetObjectKeyPattern.test(objectKey);
}
