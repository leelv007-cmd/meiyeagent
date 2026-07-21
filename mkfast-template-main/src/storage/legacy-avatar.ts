const LEGACY_AVATAR_KEY =
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:[A-Za-z0-9._-]{0,250}\.jpeg|[A-Za-z0-9._-]{0,251}\.(?:jpg|png|webp))$/iu;

const contentTypeForExtension: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function isStrictLegacyAvatarKey(key: string): boolean {
  return LEGACY_AVATAR_KEY.test(key);
}

export function legacyAvatarContentTypeMatches(
  key: string,
  contentType: string
): boolean {
  if (!isStrictLegacyAvatarKey(key)) return false;
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return contentTypeForExtension[extension] === contentType.toLowerCase();
}

export function hasActiveLegacyAvatarClaim(
  claim: {
    imageUrl: string;
    objectKey: string;
    userImage: string | null;
  },
  contentType: string
): boolean {
  return (
    claim.userImage === claim.imageUrl &&
    legacyAvatarContentTypeMatches(claim.objectKey, contentType)
  );
}
