import {
  contentPackageSchema,
  todayRecommendationStateSchema,
  type ContentPackage,
  type TodayRecommendationState,
} from '@meiye/contracts';
import type { HarnessTodayRecommendationConfig } from '../admin-config/foundation-module.js';

export interface TodayRecommendationRecord {
  taskId: string;
  rawInput: string;
  deliveredAt: string;
  delivery: unknown;
  contentPackage: unknown;
  intent?: unknown;
  recommendationRules?: HarnessTodayRecommendationConfig;
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
  const intentContext = asRecord(intent?.context) ?? intent;
  const industry =
    stringValue(intentContext?.industry_category) ??
    stringValue(intentContext?.industry) ??
    stringValue(intentContext?.scene);
  const brief = asRecord(record.briefTrace);
  const platform = stringArray(brief?.platforms)[0];
  const weekday = String(new Date(at).getUTCDay() || 7);

  return (
    (industry ? stringValue(rules.industryWhyNow[industry]) : undefined) ??
    (platform ? stringValue(rules.platformWhyNow[platform]) : undefined) ??
    stringValue(rules.weekdayWhyNow[weekday])
  );
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
