/**
 * Browser → Core workspace asset upload (W02 ①).
 *
 * `parse_single_asset` will not accept a source it cannot verify: Core re-reads
 * the object and compares sha256 + sizeBytes against the command. So the
 * digest is computed here, from the exact bytes that are sent, and travels with
 * the object key into the parse command — one identity, three places.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface WorkspaceAssetUpload {
  contentType: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  sourceUrl: string;
}

export class WorkspaceAssetUploadError extends Error {
  constructor(readonly reason: 'unsupported_type' | 'upload_failed') {
    super(`Workspace asset upload failed: ${reason}`);
    this.name = 'WorkspaceAssetUploadError';
  }
}

export async function sha256Hex(bytes: BufferSource) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The digest is the name, so the same photo uploaded twice is the same object
 * instead of an orphan per attempt — and the BFF can re-derive it from the
 * bytes it receives (`workspaceIntakeUploadDigest`), which is what keeps this
 * write channel from being a way to author arbitrary canvas assets.
 */
export function workspaceIntakeObjectKey(input: {
  contentType: string;
  sha256: string;
  workspaceId: string;
}) {
  const extension = EXTENSIONS[input.contentType];
  if (!extension) throw new WorkspaceAssetUploadError('unsupported_type');
  return `${input.workspaceId}/canvas/assets/intake-${input.sha256}.${extension}`;
}

export async function uploadWorkspaceIntakeAsset(input: {
  file: File;
  workspaceId: string;
}): Promise<WorkspaceAssetUpload> {
  const contentType = input.file.type;
  if (!EXTENSIONS[contentType]) {
    throw new WorkspaceAssetUploadError('unsupported_type');
  }
  const bytes = await input.file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const objectKey = workspaceIntakeObjectKey({
    contentType,
    sha256,
    workspaceId: input.workspaceId,
  });
  const response = await fetch(
    `/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`,
    {
      body: bytes,
      credentials: 'same-origin',
      headers: { 'content-type': contentType },
      method: 'PUT',
    }
  );
  if (!response.ok) throw new WorkspaceAssetUploadError('upload_failed');
  const result = (await response.json()) as { sourceUrl?: unknown };
  if (typeof result.sourceUrl !== 'string' || !result.sourceUrl) {
    throw new WorkspaceAssetUploadError('upload_failed');
  }
  return {
    contentType,
    objectKey,
    sha256,
    sizeBytes: bytes.byteLength,
    sourceUrl: result.sourceUrl,
  };
}
