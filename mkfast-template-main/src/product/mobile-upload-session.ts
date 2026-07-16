export type MobileUploadPhase =
  | 'local'
  | 'uploading'
  | 'interrupted'
  | 'stored'
  | 'persisted';

interface FileIdentity {
  name: string;
  sha256: string;
  size: number;
  type: string;
}

export interface MobileUploadSession {
  assetId: string;
  file: FileIdentity;
  fingerprint: string;
  objectKey?: string;
  persistedAssetId?: string;
  phase: MobileUploadPhase;
  uploadId: string;
}

const STORAGE_KEY = 'meiye:mobile-upload-session';

function fingerprint(file: FileIdentity) {
  return `sha256:${file.sha256}`;
}

export async function identifyMobileUploadFile(
  file: File
): Promise<FileIdentity> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer()
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return {
    name: file.name,
    sha256,
    size: file.size,
    type: file.type,
  };
}

function assetId(uploadId: string) {
  return `asset-mobile-${uploadId}`;
}

export function createMobileUploadSession(
  file: FileIdentity,
  uploadId: string = crypto.randomUUID()
): MobileUploadSession {
  return {
    assetId: assetId(uploadId),
    file: { ...file },
    fingerprint: fingerprint(file),
    phase: 'local',
    uploadId,
  };
}

export function resumeMobileUploadSession(
  session: MobileUploadSession,
  file: FileIdentity
): MobileUploadSession {
  if (session.fingerprint !== fingerprint(file)) {
    throw new Error(mobile_upload_same_file_required());
  }
  return { ...session, file: { ...file }, phase: 'uploading' };
}

export function markMobileUploadStored(
  session: MobileUploadSession,
  objectKey: string
): MobileUploadSession {
  return { ...session, objectKey, phase: 'stored' };
}

export function markMobileUploadPersisted(
  session: MobileUploadSession,
  objectKey: string
): MobileUploadSession {
  return {
    ...session,
    objectKey,
    persistedAssetId: session.assetId,
    phase: 'persisted',
  };
}

export function readMobileUploadSession(storage: Storage = sessionStorage) {
  const value = storage.getItem(STORAGE_KEY);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as MobileUploadSession;
    return parsed.uploadId &&
      parsed.fingerprint &&
      parsed.assetId &&
      parsed.file?.sha256
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeMobileUploadSession(
  session: MobileUploadSession | undefined,
  storage: Storage = sessionStorage
) {
  if (!session) {
    storage.removeItem(STORAGE_KEY);
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}
import { mobile_upload_same_file_required } from '@/locale/paraglide/messages';
