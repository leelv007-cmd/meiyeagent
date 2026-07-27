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
  intent?: unknown;
  recommendationRules?: TodayRecommendationRules;
}

export interface TodayRecommendationRules {
  weekdayWhyNow: Record<string, string>;
  industryWhyNow: Record<string, string>;
  platformWhyNow: Record<string, string>;
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
  // The current record contract carries no workspace timezone; keep the
  // boundary deterministic and fail closed until that contract is explicit.
  if (!isSameUtcCalendarDay(record.deliveredAt, at)) return cold(false);

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
  const whyNow =
    configuredWhyNow(record, at) ??
    winningReason(selection) ??
    mediaReplayReason(selection, contentPackage.data.kind);
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

function configuredWhyNow(record: TodayRecommendationRecord, at: string) {
  const rules = record.recommendationRules;
  if (!rules) return undefined;
  const intent = asRecord(record.intent);
  const context = asRecord(intent?.context);
  const industry = stringValue(context?.industry) ?? stringValue(context?.scene);
  const platform = stringArray(asRecord(record.briefTrace)?.platforms)[0];
  const day = utcCalendarDayOfWeek(at);
  const combinedKeys = [
    [day, industry, platform].filter(Boolean).join(':'),
    [day, industry].filter(Boolean).join(':'),
  ].filter((key) => key.length > 0);
  for (const key of combinedKeys) {
    const match = rules.weekdayWhyNow[key];
    if (match) return match;
  }
  if (industry && rules.industryWhyNow[industry]) {
    return rules.industryWhyNow[industry];
  }
  if (platform && rules.platformWhyNow[platform]) {
    return rules.platformWhyNow[platform];
  }
  return rules.weekdayWhyNow[day];
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

function mediaReplayReason(
  selection: Record<string, unknown> | undefined,
  kind: ContentPackage['kind'],
) {
  const winner = stringValue(selection?.winnerCandidateId);
  const candidateScores = selection?.candidateScores;
  if (!winner || !Array.isArray(candidateScores) || candidateScores.length > 0) {
    return undefined;
  }
  return kind === 'video'
    ? '这份视频成品今天已经完成，可以从这份成品继续编辑。'
    : '这份图文成品今天已经完成，可以从这份成品继续编辑。';
}

function isSameUtcCalendarDay(deliveredAt: string, at: string) {
  const deliveredDate = utcCalendarDate(deliveredAt);
  const currentDate = utcCalendarDate(at);
  return deliveredDate !== undefined && deliveredDate === currentDate;
}

function utcCalendarDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : undefined;
}

function utcCalendarDayOfWeek(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getUTCDay()) : '';
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
