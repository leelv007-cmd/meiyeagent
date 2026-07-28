import {
  MARKETING_IDENTITY_PLATFORMS,
  MARKETING_SCENES,
  registerMarketingIdentityCommandSchema,
  type MarketingIdentityPlatform,
  type MarketingScene,
  type RegisterMarketingIdentityCommand,
} from '@meiye/contracts';

export type MarketingIdentityQuestionId =
  | 'kind'
  | 'displayName'
  | 'owner'
  | 'primaryClaimOrRole'
  | 'professionalBoundaries'
  | 'expressionSamples'
  | 'sourceRef'
  | 'forbiddenClaims'
  | 'visualPrinciples'
  | 'seriesAnchors'
  | 'portraitAuthorized'
  | 'voiceAuthorized'
  | 'allowedPlatforms'
  | 'allowedScenes';

export interface MarketingIdentityDraft {
  allowedPlatforms?: MarketingIdentityPlatform[];
  allowedScenes?: MarketingScene[];
  displayName?: string;
  expressionSamples?: string;
  forbiddenClaims?: string;
  kind?: 'brand' | 'person';
  owner?: string;
  portraitAuthorized?: boolean;
  primaryClaimOrRole?: string;
  professionalBoundaries?: string;
  seriesAnchors?: string;
  sourceRef?: string;
  visualPrinciples?: string;
  voiceAuthorized?: boolean;
}

const COMMON_QUESTIONS: MarketingIdentityQuestionId[] = [
  'kind',
  'displayName',
  'owner',
  'primaryClaimOrRole',
  'professionalBoundaries',
  'expressionSamples',
  'sourceRef',
];

const BRAND_QUESTIONS: MarketingIdentityQuestionId[] = [
  'forbiddenClaims',
  'visualPrinciples',
  'seriesAnchors',
];

const PERSON_QUESTIONS: MarketingIdentityQuestionId[] = [
  'portraitAuthorized',
  'voiceAuthorized',
];

/**
 * D-142: the authorized reach used to be written for the merchant — every
 * platform and every scene, silently, from the client. Nothing gates on these
 * two lists (their only reader is the context bundle at
 * apps/core/src/p1/harness/production-context-port.ts:696-697), which is
 * exactly why the silence mattered: the generation chain was told the merchant
 * had authorized reach they were never asked about. They are questions now.
 */
const SCOPE_QUESTIONS: MarketingIdentityQuestionId[] = [
  'allowedPlatforms',
  'allowedScenes',
];

export function marketingIdentityQuestions(
  draft: MarketingIdentityDraft
): MarketingIdentityQuestionId[] {
  if (!draft.kind) return ['kind'];
  return [
    ...COMMON_QUESTIONS,
    ...(draft.kind === 'brand' ? BRAND_QUESTIONS : PERSON_QUESTIONS),
    ...SCOPE_QUESTIONS,
  ];
}

export function answerMarketingIdentityQuestion(
  draft: MarketingIdentityDraft,
  questionId: MarketingIdentityQuestionId,
  value: boolean | string | readonly string[]
): MarketingIdentityDraft {
  if (questionId === 'kind') {
    if (value !== 'brand' && value !== 'person') {
      throw new Error('Identity kind must be brand or person.');
    }
    return { ...draft, kind: value };
  }
  if (questionId === 'portraitAuthorized' || questionId === 'voiceAuthorized') {
    if (typeof value !== 'boolean') {
      throw new Error('Identity authorization answers must be boolean.');
    }
    return { ...draft, [questionId]: value };
  }
  if (questionId === 'allowedPlatforms') {
    return { ...draft, allowedPlatforms: parseScopeAnswer(value, PLATFORMS) };
  }
  if (questionId === 'allowedScenes') {
    return { ...draft, allowedScenes: parseScopeAnswer(value, SCENES) };
  }
  if (typeof value !== 'string') {
    throw new Error('Identity text answers must be strings.');
  }
  return { ...draft, [questionId]: value };
}

function parseScopeAnswer<Allowed extends string>(
  value: boolean | string | readonly string[],
  allowed: readonly Allowed[]
): Allowed[] {
  if (!Array.isArray(value)) {
    throw new Error('Identity scope answers must be arrays.');
  }
  // Deduplicated and ordered by the catalog, so a re-tick can never grow the
  // list and the merchant reads it back in the order they were shown.
  const picked = new Set(value);
  const unknown = [...picked].find(
    (entry) => !allowed.includes(entry as Allowed)
  );
  if (unknown !== undefined) {
    throw new Error(`Unknown identity scope value: ${unknown}`);
  }
  return allowed.filter((entry) => picked.has(entry));
}

function hasAnswer(
  draft: MarketingIdentityDraft,
  questionId: MarketingIdentityQuestionId
) {
  if (!Object.hasOwn(draft, questionId)) return false;
  const value = draft[questionId];
  // A scope answered with nothing ticked is not an answer — the merchant has
  // to name at least one platform and one scene before this can be registered.
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    return value.trim().length > 0 || BRAND_QUESTIONS.includes(questionId);
  }
  return value !== undefined;
}

export function marketingIdentityFlowState(draft: MarketingIdentityDraft): {
  answeredQuestionIds: MarketingIdentityQuestionId[];
  currentQuestionId: MarketingIdentityQuestionId | null;
  readyForPreview: boolean;
} {
  const questions = marketingIdentityQuestions(draft);
  const answeredQuestionIds = questions.filter((questionId) =>
    hasAnswer(draft, questionId)
  );
  const currentQuestionId =
    questions.find((questionId) => !hasAnswer(draft, questionId)) ?? null;
  return {
    answeredQuestionIds,
    currentQuestionId,
    readyForPreview: currentQuestionId === null,
  };
}

export function marketingIdentityRegistrationFromDraft(
  draft: MarketingIdentityDraft
): RegisterMarketingIdentityCommand {
  if (!marketingIdentityFlowState(draft).readyForPreview || !draft.kind) {
    throw new Error('Identity registration is incomplete.');
  }
  return marketingIdentityRegistrationPayload({
    kind: draft.kind,
    displayName: draft.displayName ?? '',
    owner: draft.owner ?? '',
    primaryClaimOrRole: draft.primaryClaimOrRole ?? '',
    professionalBoundaries: draft.professionalBoundaries ?? '',
    expressionSamples: draft.expressionSamples ?? '',
    sourceRef: draft.sourceRef ?? '',
    allowedPlatforms: draft.allowedPlatforms ?? [],
    allowedScenes: draft.allowedScenes ?? [],
    forbiddenClaims: draft.forbiddenClaims,
    visualPrinciples: draft.visualPrinciples,
    seriesAnchors: draft.seriesAnchors,
    portraitAuthorized: draft.portraitAuthorized,
    voiceAuthorized: draft.voiceAuthorized,
  });
}

/**
 * The four terms below are registered without a question of their own, so the
 * wizard shows them on the preview panel before the merchant confirms (D-142):
 * effectiveFrom is the moment of registration, expiresAt carries no expiry,
 * departureHandling is the standing promise, and historicalContentPermission
 * stays at the middle 'review_required' rather than retaining published work.
 * Whatever changes here has to change on that panel too.
 */
export const MARKETING_IDENTITY_DEPARTURE_HANDLING =
  '撤回、离职或换运营后停止生成新内容，已发内容按授权政策处理。';

export const MARKETING_IDENTITY_HISTORICAL_CONTENT_PERMISSION =
  'review_required' as const;

export function marketingIdentityRegistrationPayload(input: {
  kind: 'brand' | 'person';
  displayName: string;
  owner: string;
  primaryClaimOrRole: string;
  professionalBoundaries: string;
  expressionSamples: string;
  sourceRef: string;
  allowedPlatforms: readonly MarketingIdentityPlatform[];
  allowedScenes: readonly MarketingScene[];
  forbiddenClaims?: string;
  visualPrinciples?: string;
  seriesAnchors?: string;
  portraitAuthorized?: boolean;
  voiceAuthorized?: boolean;
}): RegisterMarketingIdentityCommand {
  const common = {
    identityId: `marketing-${crypto.randomUUID()}`,
    expectedVersion: 0 as const,
    displayName: input.displayName,
    owner: input.owner,
    professionalBoundaries: lines(input.professionalBoundaries),
    allowedPlatforms: [...input.allowedPlatforms],
    allowedScenes: [...input.allowedScenes],
    expressionSamples: lines(input.expressionSamples),
    effectiveFrom: new Date().toISOString(),
    expiresAt: null,
    departureHandling: MARKETING_IDENTITY_DEPARTURE_HANDLING,
    sourceRef: input.sourceRef,
  };
  return registerMarketingIdentityCommandSchema.parse(
    input.kind === 'brand'
      ? {
          ...common,
          kind: 'brand',
          brandClaims: lines(input.primaryClaimOrRole),
          forbiddenClaims: lines(input.forbiddenClaims ?? ''),
          visualPrinciples: lines(input.visualPrinciples ?? ''),
          seriesAnchors: lines(input.seriesAnchors ?? ''),
        }
      : {
          ...common,
          kind: 'person',
          realWorldRole: input.primaryClaimOrRole,
          portraitAuthorization: input.portraitAuthorized
            ? 'authorized'
            : 'not_authorized',
          voiceAuthorization: input.voiceAuthorized
            ? 'authorized'
            : 'not_authorized',
          historicalContentPermission:
            MARKETING_IDENTITY_HISTORICAL_CONTENT_PERMISSION,
        }
  );
}

const PLATFORMS: readonly MarketingIdentityPlatform[] =
  MARKETING_IDENTITY_PLATFORMS;
const SCENES: readonly MarketingScene[] = MARKETING_SCENES;

function lines(value: string) {
  return value
    .split(/[,\n，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
