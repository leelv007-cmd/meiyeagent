import { DEFAULT_AVATARS_FOLDER, DEFAULT_MAX_FILE_SIZE } from './constants';
import { UploadError } from './types';

export type UploadPurpose = 'avatar' | 'private_file' | 'product_asset';

export interface UploadPolicy {
  allowedContentTypes: readonly string[];
  folder?: string;
  isPublic: boolean;
  maxBytes: number;
}

export const AVATAR_MAX_FILE_SIZE = 2 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 4096;

const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
  avatar: {
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    folder: DEFAULT_AVATARS_FOLDER,
    isPublic: true,
    maxBytes: AVATAR_MAX_FILE_SIZE,
  },
  private_file: {
    allowedContentTypes: [],
    isPublic: false,
    maxBytes: DEFAULT_MAX_FILE_SIZE,
  },
  product_asset: {
    allowedContentTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm',
    ],
    isPublic: false,
    maxBytes: DEFAULT_MAX_FILE_SIZE,
  },
};

export function resolveUploadPolicy(purpose: UploadPurpose): UploadPolicy {
  return UPLOAD_POLICIES[purpose];
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function hasAvatarSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') {
    return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === 'image/png') {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === 'image/webp') {
    return (
      hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      hasPrefix(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
    );
  }
  return false;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function avatarDimensions(
  contentType: string,
  bytes: Uint8Array
): { height: number; width: number } | undefined {
  if (contentType === 'image/png' && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { height: view.getUint32(20), width: view.getUint32(16) };
  }

  if (contentType === 'image/jpeg') {
    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    let offset = 2;
    while (offset + 8 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda || offset + 1 >= bytes.byteLength) break;
      const segmentLength = readUint16BE(bytes, offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
      if (marker != null && startOfFrameMarkers.has(marker)) {
        return {
          height: readUint16BE(bytes, offset + 3),
          width: readUint16BE(bytes, offset + 5),
        };
      }
      offset += segmentLength;
    }
    return undefined;
  }

  if (contentType === 'image/webp' && bytes.byteLength >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return {
        height: readUint24LE(bytes, 27) + 1,
        width: readUint24LE(bytes, 24) + 1,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits =
        (bytes[21] ?? 0) |
        ((bytes[22] ?? 0) << 8) |
        ((bytes[23] ?? 0) << 16) |
        ((bytes[24] ?? 0) << 24);
      return {
        height: ((bits >>> 14) & 0x3fff) + 1,
        width: (bits & 0x3fff) + 1,
      };
    }
    if (chunk === 'VP8 ' && hasPrefix(bytes.subarray(23), [0x9d, 0x01, 0x2a])) {
      return {
        height:
          readUint16BE(new Uint8Array([bytes[29] ?? 0, bytes[28] ?? 0]), 0) &
          0x3fff,
        width:
          readUint16BE(new Uint8Array([bytes[27] ?? 0, bytes[26] ?? 0]), 0) &
          0x3fff,
      };
    }
  }
  return undefined;
}

export function validateUploadPolicy(input: {
  bytes: Uint8Array;
  contentType: string;
  purpose: UploadPurpose;
  size: number;
}): void {
  const policy = resolveUploadPolicy(input.purpose);
  if (input.size <= 0 || input.size > policy.maxBytes) {
    throw new UploadError('File does not satisfy the upload size policy');
  }
  if (
    policy.allowedContentTypes.length > 0 &&
    !policy.allowedContentTypes.includes(input.contentType)
  ) {
    throw new UploadError('File content type is not allowed for this upload');
  }
  if (
    input.purpose === 'avatar' &&
    !hasAvatarSignature(input.contentType, input.bytes)
  ) {
    throw new UploadError(
      'Avatar file signature does not match its content type'
    );
  }
  if (input.purpose === 'avatar') {
    const dimensions = avatarDimensions(input.contentType, input.bytes);
    if (
      !dimensions ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width > AVATAR_MAX_DIMENSION ||
      dimensions.height > AVATAR_MAX_DIMENSION
    ) {
      throw new UploadError('Avatar image dimensions are not allowed');
    }
  }
}
