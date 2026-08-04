import {
  contentPackageSchema,
  todayRecommendationStateSchema,
  type ContentPackage,
  type TodayRecommendationState,
} from '@meiye/contracts';
import {
  normalizeHarnessTodayRecommendationConfig,
  resolveTodayRecommendationIndustrySlug,
  type HarnessTodayRecommendationConfig,
} from '../admin-config/foundation-module.js';

// Today recommendation currently has no per-workspace timezone field. Keep the
// existing merchant product convention explicit: Asia/Shanghai, with the
// business day starting at 08:00 local time.
// Intentional equivalence: MERCHANT_TIMEZONE_OFFSET_MS - MERCHANT_DAY_START_MS
// === 0 because the Asia/Shanghai 08:00 business-day boundary is mathematically
// equal to the UTC calendar-day boundary. Read this before changing either
// constant.
const MERCHANT_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const MERCHANT_DAY_START_MS = 8 * 60 * 60 * 1000;

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
  if (!isSameMerchantBusinessDay(record.deliveredAt, at)) return cold(false);

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
    },
  });
}

function configuredWhyNow(record: TodayRecommendationRecord, at: string) {
  if (!record.recommendationRules) return undefined;
  // Read-time key migration: persisted Chinese industry keys still hit after
  // defaults moved to published slugs. Pure + idempotent; no write-back.
  const rules = normalizeHarnessTodayRecommendationConfig(
    record.recommendationRules,
  );

  const intent = asRecord(record.intent);
  const intentContext = asRecord(intent?.context) ?? intent;
  const industryRaw =
    stringValue(intentContext?.industry_category) ??
    stringValue(intentContext?.industry) ??
    stringValue(intentContext?.scene);
  // Production writes Chinese labels into industry_category; only published
  // slugs (or resolvable aliases) may hit the industry layer. 美甲 / free text
  // stay unmapped and fall through to platform → weekday.
  const industrySlug = industryRaw
    ? resolveTodayRecommendationIndustrySlug(industryRaw)
    : undefined;
  const brief = asRecord(record.briefTrace);
  const platform = stringArray(brief?.platforms)[0];
  const weekday = merchantBusinessWeekday(at);

  return (
    (industrySlug
      ? stringValue(rules.industryWhyNow[industrySlug])
      : undefined) ??
    (platform ? stringValue(rules.platformWhyNow[platform]) : undefined) ??
    (weekday ? stringValue(rules.weekdayWhyNow[weekday]) : undefined)
  );
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

function isSameMerchantBusinessDay(deliveredAt: string, at: string) {
  const deliveredDate = merchantBusinessCalendarDate(deliveredAt);
  const currentDate = merchantBusinessCalendarDate(at);
  return deliveredDate !== undefined && deliveredDate === currentDate;
}

function merchantBusinessCalendarDate(value: string) {
  const timestamp = merchantBusinessTimestamp(value);
  return timestamp === undefined
    ? undefined
    : new Date(timestamp).toISOString().slice(0, 10);
}

function merchantBusinessWeekday(value: string) {
  const timestamp = merchantBusinessTimestamp(value);
  return timestamp === undefined
    ? undefined
    : String(new Date(timestamp).getUTCDay() || 7);
}

function merchantBusinessTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? timestamp + MERCHANT_TIMEZONE_OFFSET_MS - MERCHANT_DAY_START_MS
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
