import {
  contentPackageSchema,
  todayRecommendationStateSchema,
  type ContentPackage,
  type TodayRecommendationState,
} from '@meiye/contracts';

export interface TodayRecommendationRecord {
  taskId: string;
  rawInput: string;
  deliveredAt: string;
  delivery: unknown;
  contentPackage: unknown;
  contextTrace: unknown;
  briefTrace: unknown;
  selectionTrace: unknown;
}

export function projectTodayRecommendation(
  workspaceId: string,
  currentFactsRevision: number,
  record: TodayRecommendationRecord | null,
  at = new Date().toISOString(),
): TodayRecommendationState {
  const cold = (stale: boolean) =>
    todayRecommendationStateSchema.parse({
      workspaceId,
      currentFactsRevision,
      recommendation: null,
      stale,
    });
  if (!record || currentFactsRevision === 0) return cold(false);

  const context = asRecord(record.contextTrace);
  const sourceRevisions = asRecord(context?.sourceRevisions);
  const factsRevision = sourceRevisions?.facts;
  if (
    typeof factsRevision !== 'number' ||
    !Number.isInteger(factsRevision) ||
    factsRevision !== currentFactsRevision
  ) {
    return cold(true);
  }

  const delivery = asRecord(record.delivery);
  const packageId = stringValue(delivery?.packageId);
  const versionId = stringValue(delivery?.versionId);
  const contentPackage = contentPackageSchema.safeParse(record.contentPackage);
  if (!packageId || !versionId || !contentPackage.success) return cold(false);
  const version = contentPackage.data.versions.find(
    (candidate) => candidate.id === versionId,
  );
  const brief = asRecord(record.briefTrace);
  const factReferences = stringArray(brief?.factRefs);
  const selection = asRecord(record.selectionTrace);
  const whyNow = winningReason(selection);
  const opportunity = currentOpportunity(
    contentPackage.data.marketing?.opportunity,
    at,
  );
  if (
    contentPackage.data.workspaceId !== workspaceId ||
    contentPackage.data.id !== packageId ||
    !version ||
    !version.conversionHook ||
    factReferences.length === 0 ||
    !whyNow
  ) {
    return cold(false);
  }

  return todayRecommendationStateSchema.parse({
    workspaceId,
    currentFactsRevision,
    stale: false,
    recommendation: {
      workspaceId,
      taskId: record.taskId,
      factsRevision,
      packageId,
      versionId,
      title: version.title,
      body: version.body,
      whyNow,
      factReferences,
      customerAction: version.conversionHook,
      sourceLabel: record.rawInput,
      createdAt: record.deliveredAt,
      ...(opportunity ? { opportunity } : {}),
    },
  });
}

function currentOpportunity(
  opportunity:
    | NonNullable<ContentPackage['marketing']>['opportunity']
    | undefined,
  at: string,
) {
  return opportunity?.status === 'active' &&
    opportunity.sourceType !== 'evergreen_fallback' &&
    opportunity.matchedStoreReferences.length > 0 &&
    Date.parse(opportunity.expiresAt) > Date.parse(at)
    ? opportunity
    : undefined;
}

function winningReason(selection: Record<string, unknown> | undefined) {
  const winner = stringValue(selection?.winnerCandidateId);
  const scores = Array.isArray(selection?.candidateScores)
    ? selection.candidateScores
    : [];
  const score = scores
    .map(asRecord)
    .find((candidate) => candidate?.candidateId === winner);
  return stringValue(score?.reason);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(stringValue)
            .filter((item): item is string => item !== undefined),
        ),
      ]
    : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
