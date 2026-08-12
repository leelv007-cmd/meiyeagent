/**
 * Harness result projections for the results domain (moved 2026-08-12 from
 * workbench-state-model.ts when that module was dissolved: it had no single
 * subject — ten exports, seven with zero production consumers, pinned in
 * place by source-text tests).
 */
import type { ContentPackageKind } from '@meiye/contracts';
import { contentPackageCarrierOf } from '@meiye/contracts';

/**
 * Honest status for the streamed copy panel (ADR-0007 / D-042): the drafting
 * label may only appear while the workflow is actually producing tokens. A
 * suspended workflow is waiting on the merchant — material authorization,
 * Brief confirmation, a blocking question — and must say so instead.
 *
 * A finished workflow is neither: `success`/`failed` are terminal, so the text
 * on screen is delivered text. Calling that drafting is what makes an already
 * finished body render as if it were still arriving — caret, blur-in reveal,
 * replayed on every mount. 「无假流式」forbids it.
 */
export function harnessCopyStreamPhase(
  progressState?: 'waiting' | 'running' | 'suspended' | 'success' | 'failed'
): 'awaiting_confirmation' | 'completed' | 'drafting' {
  if (progressState === 'suspended') return 'awaiting_confirmation';
  if (progressState === 'success' || progressState === 'failed') {
    return 'completed';
  }
  return 'drafting';
}

interface CopyPackageResultInput {
  currentVersionId?: string;
  generated: { assetIds: string[] };
  /** Wire/storage kind; product carrier is derived via contentPackageCarrierOf. */
  kind: ContentPackageKind;
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

/**
 * Compact text-only result panel for a pure-copy ContentPackage.
 *
 * xhs-spec §3.1 / #314: dispatch on the media|copy|note carrier口径 derived by
 * `contentPackageCarrierOf` — do not branch on wire kind image_text|video.
 * Only the copy carrier (image_text with no ordered media) is compact-eligible;
 * generated assets that are not yet ordered still block compact delivery so an
 * intermediate visual run cannot render as pure text.
 */
export function compactDeliveredCopyResult(
  contentPackage: CopyPackageResultInput
) {
  const currentVersion = contentPackage.versions.find(
    ({ id }) => id === contentPackage.currentVersionId
  );
  if (!currentVersion) return null;

  const carrier = contentPackageCarrierOf({
    kind: contentPackage.kind,
    orderedAssetCount: currentVersion.orderedAssetIds.length,
  });
  if (carrier !== 'copy' || contentPackage.generated.assetIds.length > 0) {
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
