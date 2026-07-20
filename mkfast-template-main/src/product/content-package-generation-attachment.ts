import type {
  ContentPackage,
  CreativeJob,
  CreativeWork,
} from '@meiye/contracts';

type SessionWork = Pick<CreativeWork, 'derivedFrom' | 'id' | 'sessionId'>;

export function contentPackageGenerationAttachmentTarget({
  contentPackages,
  currentWork,
  works,
}: {
  contentPackages: readonly ContentPackage[];
  currentWork: SessionWork;
  works: readonly SessionWork[];
}) {
  const sessionWorkIds = new Set(
    works
      .filter((work) => work.sessionId === currentWork.sessionId)
      .map((work) => work.id)
  );
  const matches = contentPackages.filter(
    (contentPackage) =>
      contentPackage.kind === 'image_text' &&
      contentPackage.status === 'accepted' &&
      Boolean(contentPackage.currentVersionId) &&
      contentPackage.source.workId &&
      sessionWorkIds.has(contentPackage.source.workId)
  );
  if (matches.length === 1) return matches[0];
  const workById = new Map(works.map((work) => [work.id, work]));
  const lineageWorkIds = new Set<string>();
  let sourceWorkId = currentWork.derivedFrom;
  while (sourceWorkId && !lineageWorkIds.has(sourceWorkId)) {
    lineageWorkIds.add(sourceWorkId);
    sourceWorkId = workById.get(sourceWorkId)?.derivedFrom;
  }
  const lineageMatches = matches.filter(
    (contentPackage) =>
      contentPackage.source.workId &&
      lineageWorkIds.has(contentPackage.source.workId)
  );
  return lineageMatches.length === 1 ? lineageMatches[0] : undefined;
}

export function createContentPackageGenerationAttachmentCommand({
  assetIds,
  expectedRevision,
  job,
  packageId,
}: {
  assetIds: readonly string[];
  expectedRevision: number;
  job: Pick<CreativeJob, 'id' | 'status'>;
  packageId: string;
}) {
  if (
    job.status !== 'completed' ||
    !job.id.trim() ||
    !packageId.trim() ||
    assetIds.length === 0 ||
    assetIds.some((assetId) => !assetId.trim()) ||
    new Set(assetIds).size !== assetIds.length
  ) {
    throw new Error(
      'A completed CreativeJob with unique persisted output Assets is required.'
    );
  }
  const orderedAssetIds = [...assetIds];
  return {
    action: 'attach_content_package_generation' as const,
    idempotencyKey: [
      'attach-content-package-generation',
      packageId,
      String(expectedRevision),
      job.id,
      orderedAssetIds.map(encodeURIComponent).join(','),
    ].join(':'),
    payload: {
      assetIds: orderedAssetIds,
      childRun: {
        assetIds: orderedAssetIds,
        runId: job.id,
        runType: 'creative_job' as const,
        status: 'succeeded' as const,
      },
      expectedRevision,
      packageId,
    },
  };
}
