/**
 * Harness adoption is an optimistic-concurrency write against the package the
 * merchant is looking at, and that package's revision moves without the
 * merchant touching anything: as soon as the package reads delivered, the
 * workbench auto-prepares the mobile publish handoff
 * (`use-publish-handoff.ts:240`), and Core records a self-publish approval
 * receipt in that call, bumping the revision. The Result Center's render-time
 * projection is therefore a dead CAS token by the time adoption fires — in the
 * p2 image-text deep run the preparer landed 307ms before adoption and Core
 * answered `CONTENT_PACKAGE_REVISION_CONFLICT: revision changed from 1 to 2`.
 *
 * Reading the revision inside the command turn closes all but a few
 * milliseconds of that window; the single refresh-and-retry the conflict
 * envelope asks for ("Refresh and retry.") closes the rest. A second conflict
 * is a real disagreement and still surfaces to the merchant.
 */
import type { PublicContentPackage } from '@meiye/contracts';

import { p1ErrorCode } from '@/p1/client';

export const CONTENT_PACKAGE_REVISION_CONFLICT =
  'CONTENT_PACKAGE_REVISION_CONFLICT';

export interface AdoptHarnessCandidateDependencies {
  command: (
    action: string,
    payload: Record<string, unknown>,
    idempotencyKey: string
  ) => Promise<PublicContentPackage>;
  readPackage: (packageId: string) => Promise<PublicContentPackage>;
  refresh: () => Promise<void>;
}

export async function adoptHarnessCandidateOnLatestRevision(
  input: { candidateId: string; packageId: string },
  dependencies: AdoptHarnessCandidateDependencies
): Promise<PublicContentPackage> {
  const attempt = (expectedRevision: number) =>
    dependencies.command(
      'adopt_harness_candidate',
      {
        candidateId: input.candidateId,
        expectedRevision,
        packageId: input.packageId,
      },
      // The revision is part of the key on purpose: the retry is a different
      // claim about the world, so it must not replay the first attempt's
      // idempotency record.
      `adopt-harness:${input.packageId}:${expectedRevision}:${input.candidateId}`
    );
  const current = await dependencies.readPackage(input.packageId);
  try {
    return await attempt(current.revision);
  } catch (error) {
    if (p1ErrorCode(error) !== CONTENT_PACKAGE_REVISION_CONFLICT) throw error;
    await dependencies.refresh();
    const refreshed = await dependencies.readPackage(input.packageId);
    return attempt(refreshed.revision);
  }
}
