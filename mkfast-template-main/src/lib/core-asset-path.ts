import { isSharedWorkspaceAssetObjectKey } from '@meiye/contracts';

export function isAllowedWorkspaceAssetObjectKey(objectKey: string) {
  return isSharedWorkspaceAssetObjectKey(objectKey);
}

/**
 * The single key shape a browser may *write* (W02 ①). Reading spans the whole
 * workspace asset space, but writing is narrower on purpose: the readable
 * allowlist admits any `canvas/assets/<name>.<ext>`, which would let a merchant
 * overwrite an unrelated canvas asset with bytes nobody verified. An intake key
 * names its own content, so the digest in the key can be matched against the
 * bytes that arrive — the object cannot be anything other than what it claims.
 */
const WORKSPACE_INTAKE_UPLOAD_KEY =
  /^[A-Za-z0-9._-]+\/canvas\/assets\/intake-([a-f0-9]{64})\.(?:jpg|png|webp)$/u;

export function workspaceIntakeUploadDigest(objectKey: string) {
  return WORKSPACE_INTAKE_UPLOAD_KEY.exec(objectKey)?.[1] ?? null;
}
