import { p1ErrorCode } from './client';

export type ContentPackageActionFeedback = 'generic' | 'version_conflict';

export async function recoverContentPackageAction(
  error: unknown,
  refreshPackages: () => Promise<unknown>
): Promise<ContentPackageActionFeedback> {
  await refreshPackages();
  return p1ErrorCode(error) === 'CONTENT_PACKAGE_VERSION_CONFLICT'
    ? 'version_conflict'
    : 'generic';
}
