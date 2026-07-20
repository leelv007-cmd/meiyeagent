import type { ModelOperation } from '@/p1/settings-view-model';

interface CreativeOperationState {
  currentJob?: { contract: { operation: ModelOperation } };
  work?: { operation?: ModelOperation };
}

export function autoConfirmedCreativeBrief(briefDrafts: {
  audience: string;
  scene: string;
  tone: string;
}) {
  return {
    autoConfirmBrief: true as const,
    briefDrafts,
  };
}

export function quoteRecoveryReady(
  previousRevision: string,
  currentRevision?: string,
  targetCatalogRevision?: string,
  currentCatalogRevision?: string
) {
  return Boolean(
    currentRevision &&
      currentRevision.trim() !== previousRevision.trim() &&
      targetCatalogRevision &&
      targetCatalogRevision === currentCatalogRevision
  );
}

export function streamErrorCode(error: Error) {
  try {
    const envelope = JSON.parse(error.message) as unknown;
    if (!envelope || typeof envelope !== 'object' || !('error' in envelope)) {
      return undefined;
    }
    const failure = envelope.error;
    return failure &&
      typeof failure === 'object' &&
      'code' in failure &&
      typeof failure.code === 'string'
      ? failure.code
      : undefined;
  } catch {
    return undefined;
  }
}

export function workbenchComplianceDefaults(defaults: {
  'compliance.aigc_label.default': boolean;
  'compliance.watermark.default': boolean;
}) {
  return {
    aigcLabelEnabled: defaults['compliance.aigc_label.default'],
    watermarkEnabled: defaults['compliance.watermark.default'],
  };
}

export function workbenchComplianceContractValues(values: {
  aigcLabelEnabled: boolean;
  watermarkEnabled: boolean;
}) {
  return { ...values };
}

export function restoredCreationOperation({
  currentJob,
  work,
}: CreativeOperationState): ModelOperation {
  return currentJob?.contract.operation ?? work?.operation ?? 'copy.generate';
}

export function workbenchGreetingName(
  ...candidates: Array<string | null | undefined>
) {
  for (const candidate of candidates) {
    const name = candidate?.trim();
    if (name) return name;
  }
  return undefined;
}

/**
 * Honest status for the streamed copy panel (ADR-0007 / D-042): the drafting
 * label may only appear while the workflow is actually producing tokens. A
 * suspended workflow is waiting on the merchant — material authorization,
 * Brief confirmation, a blocking question — and must say so instead.
 */
export function harnessCopyStreamPhase(
  progressState?: 'waiting' | 'running' | 'suspended' | 'success' | 'failed'
): 'awaiting_confirmation' | 'drafting' {
  return progressState === 'suspended' ? 'awaiting_confirmation' : 'drafting';
}

interface CopyPackageResultInput {
  currentVersionId?: string;
  generated: { assetIds: string[] };
  kind: string;
  versions: Array<{
    body: string;
    conversionHook?: string;
    id: string;
    orderedAssetIds: string[];
    title: string;
  }>;
}

interface HarnessCandidateResultInput {
  currentVersionId?: string;
  harnessSelection?: {
    adoptedCandidateId?: string;
    recommendedCandidateId: string;
  };
  versions: Array<{
    body: string;
    conversionHook?: string;
    harnessCandidateId?: string;
    harnessScore?: number;
    id: string;
    orderedAssetIds: string[];
    title: string;
  }>;
}

export function harnessCandidateResultModel(
  contentPackage: HarnessCandidateResultInput
) {
  if (!contentPackage.harnessSelection) return null;
  const candidates = contentPackage.versions.flatMap((version) =>
    version.harnessCandidateId
      ? [
          {
            body: version.body,
            candidateId: version.harnessCandidateId,
            ...(version.conversionHook
              ? { conversionHook: version.conversionHook }
              : {}),
            id: version.id,
            orderedAssetIds: version.orderedAssetIds,
            score: version.harnessScore ?? 0,
            title: version.title,
          },
        ]
      : []
  );
  const primary = candidates.find(
    ({ candidateId }) =>
      candidateId === contentPackage.harnessSelection?.recommendedCandidateId
  );
  if (!primary) return null;
  return {
    adoptedCandidateId: contentPackage.harnessSelection.adoptedCandidateId,
    alternatives: candidates
      .filter(({ candidateId }) => candidateId !== primary.candidateId)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidateId.localeCompare(right.candidateId)
      ),
    primary,
  };
}

export function compactDeliveredCopyResult(
  contentPackage: CopyPackageResultInput
) {
  if (contentPackage.kind !== 'image_text') return null;
  const currentVersion = contentPackage.versions.find(
    ({ id }) => id === contentPackage.currentVersionId
  );
  if (
    !currentVersion ||
    currentVersion.orderedAssetIds.length > 0 ||
    contentPackage.generated.assetIds.length > 0
  ) {
    return null;
  }
  return {
    body: currentVersion.body,
    ...(currentVersion.conversionHook
      ? { conversionHook: currentVersion.conversionHook }
      : {}),
    title: currentVersion.title,
  };
}
