import { validateUploadPolicy } from './upload-policy';
import { isStrictLegacyAvatarKey } from './legacy-avatar';

const LEGACY_AVATAR_KEY =
  /^avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/u;

export interface LegacyAvatarUser {
  image: string;
  updatedAt: Date;
  userId: string;
  workspaceIds: string[];
}

export interface LegacyAvatarBackfillRecord {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  createdAt: Date;
  description: 'legacy-avatar-backfill';
  filename: string;
  id: string;
  image: string;
  isPublic: true;
  originalName: string;
  purpose: 'avatar';
  r2Key: string;
  size: number;
  userId: string;
  workspaceId: string;
}

export interface LegacyAvatarBackfillPlan {
  alreadyManaged: number;
  ambiguous: Array<{ reason: string; r2Key?: string; userId: string }>;
  eligible: LegacyAvatarBackfillRecord[];
  external: Array<{ reason: string; userId: string }>;
  missing: Array<{ r2Key: string; userId: string }>;
}

export function parseAvatarBackfillArguments(args: string[]): {
  apply: boolean;
} {
  let apply = false;
  for (const argument of args) {
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { apply };
}

export async function executeLegacyAvatarBackfillPlan(
  plan: LegacyAvatarBackfillPlan,
  apply: boolean,
  insertIfStillEligible: (
    record: LegacyAvatarBackfillRecord
  ) => Promise<boolean>
): Promise<{
  applied: number;
  mode: 'apply' | 'dry-run';
  refusedStateChanges: number;
}> {
  if (!apply) {
    return { applied: 0, mode: 'dry-run', refusedStateChanges: 0 };
  }

  let applied = 0;
  let refusedStateChanges = 0;
  for (const record of plan.eligible) {
    if (await insertIfStillEligible(record)) applied += 1;
    else refusedStateChanges += 1;
  }
  return { applied, mode: 'apply', refusedStateChanges };
}

function controlledAvatarKey(
  image: string,
  baseUrl: string
): string | undefined {
  let base: URL;
  let url: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(image, base);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin || url.pathname !== '/api/storage/file') {
    return undefined;
  }
  if (
    url.hash ||
    url.searchParams.getAll('key').length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== 'key')
  ) {
    return undefined;
  }
  const key = url.searchParams.get('key');
  return key && isStrictLegacyAvatarKey(key) ? key : undefined;
}

function detectAvatarContentType(
  bytes: Uint8Array
): LegacyAvatarBackfillRecord['contentType'] | undefined {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte
    )
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

export async function buildLegacyAvatarBackfillPlan(
  input: {
    baseUrl: string;
    existingKeys: ReadonlySet<string>;
    users: LegacyAvatarUser[];
  },
  readObject: (key: string) => Promise<Uint8Array | null>
): Promise<LegacyAvatarBackfillPlan> {
  const plan: LegacyAvatarBackfillPlan = {
    alreadyManaged: 0,
    ambiguous: [],
    eligible: [],
    external: [],
    missing: [],
  };
  const userKeys = new Map(
    input.users.map((user) => [
      user.userId,
      controlledAvatarKey(user.image, input.baseUrl),
    ])
  );
  const referenceCounts = new Map<string, number>();
  for (const key of userKeys.values()) {
    if (key) referenceCounts.set(key, (referenceCounts.get(key) ?? 0) + 1);
  }

  for (const user of input.users) {
    const key = userKeys.get(user.userId);
    if (!key) {
      plan.external.push({
        reason: 'image is not a controlled legacy avatar URL',
        userId: user.userId,
      });
      continue;
    }
    if ((referenceCounts.get(key) ?? 0) !== 1) {
      plan.ambiguous.push({
        reason: 'object is referenced by more than one user',
        r2Key: key,
        userId: user.userId,
      });
      continue;
    }
    if (input.existingKeys.has(key)) {
      plan.alreadyManaged += 1;
      continue;
    }
    const workspaceIds = [
      ...new Set(
        user.workspaceIds.filter(
          (workspaceId) =>
            workspaceId.length > 0 && workspaceId.trim() === workspaceId
        )
      ),
    ];
    if (workspaceIds.length !== 1) {
      plan.ambiguous.push({
        reason: 'user must have exactly one workspace membership',
        r2Key: key,
        userId: user.userId,
      });
      continue;
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readObject(key);
    } catch {
      plan.ambiguous.push({
        reason: 'object inspection failed',
        r2Key: key,
        userId: user.userId,
      });
      continue;
    }
    if (!bytes) {
      plan.missing.push({ r2Key: key, userId: user.userId });
      continue;
    }
    const contentType = detectAvatarContentType(bytes);
    if (!contentType) {
      plan.ambiguous.push({
        reason: 'object is not a supported avatar image',
        r2Key: key,
        userId: user.userId,
      });
      continue;
    }
    try {
      validateUploadPolicy({
        bytes,
        contentType,
        purpose: 'avatar',
        size: bytes.byteLength,
      });
    } catch {
      plan.ambiguous.push({
        reason: 'object does not satisfy the current avatar policy',
        r2Key: key,
        userId: user.userId,
      });
      continue;
    }
    const match = LEGACY_AVATAR_KEY.exec(key);
    if (!match) continue;
    const filename = key.slice('avatars/'.length);
    plan.eligible.push({
      contentType,
      createdAt: user.updatedAt,
      description: 'legacy-avatar-backfill',
      filename,
      id: match[1]!,
      image: user.image,
      isPublic: true,
      originalName: match[2]!,
      purpose: 'avatar',
      r2Key: key,
      size: bytes.byteLength,
      userId: user.userId,
      workspaceId: workspaceIds[0]!,
    });
  }

  return plan;
}
