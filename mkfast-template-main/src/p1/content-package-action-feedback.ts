import { p1ErrorCode } from './client';

export type ContentPackageActionFeedback =
  | 'generic'
  | 'variant_generation'
  | 'version_conflict';

export async function recoverContentPackageAction(
  error: unknown,
  refreshPackages: () => Promise<unknown>,
  action?: string
): Promise<ContentPackageActionFeedback> {
  await refreshPackages();
  if (p1ErrorCode(error) === 'CONTENT_PACKAGE_VERSION_CONFLICT') {
    return 'version_conflict';
  }
  return action === 'generate_content_package_variants'
    ? 'variant_generation'
    : 'generic';
}
