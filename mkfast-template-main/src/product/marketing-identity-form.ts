import {
  registerMarketingIdentityCommandSchema,
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
  | 'voiceAuthorized';

export interface MarketingIdentityDraft {
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

export function marketingIdentityQuestions(
  draft: MarketingIdentityDraft
): MarketingIdentityQuestionId[] {
  if (!draft.kind) return ['kind'];
  return [
    ...COMMON_QUESTIONS,
    ...(draft.kind === 'brand' ? BRAND_QUESTIONS : PERSON_QUESTIONS),
  ];
}

export function answerMarketingIdentityQuestion(
  draft: MarketingIdentityDraft,
  questionId: MarketingIdentityQuestionId,
  value: boolean | string
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
  if (typeof value !== 'string') {
    throw new Error('Identity text answers must be strings.');
  }
  return { ...draft, [questionId]: value };
}

function hasAnswer(
  draft: MarketingIdentityDraft,
  questionId: MarketingIdentityQuestionId
) {
  if (!Object.hasOwn(draft, questionId)) return false;
  const value = draft[questionId];
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
    forbiddenClaims: draft.forbiddenClaims,
    visualPrinciples: draft.visualPrinciples,
    seriesAnchors: draft.seriesAnchors,
    portraitAuthorized: draft.portraitAuthorized,
    voiceAuthorized: draft.voiceAuthorized,
  });
}

export function marketingIdentityRegistrationPayload(input: {
  kind: 'brand' | 'person';
  displayName: string;
  owner: string;
  primaryClaimOrRole: string;
  professionalBoundaries: string;
  expressionSamples: string;
  sourceRef: string;
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
    allowedPlatforms: [
      'xiaohongshu' as const,
      'douyin' as const,
      'video_account' as const,
      'offline' as const,
    ],
    allowedScenes: [
      'daily_service_exposure' as const,
      'traffic_opportunity' as const,
      'brand_personal_ip' as const,
      'promotion_groupbuy_conversion' as const,
      'routine_marketing_materials' as const,
    ],
    expressionSamples: lines(input.expressionSamples),
    effectiveFrom: new Date().toISOString(),
    expiresAt: null,
    departureHandling:
      '撤回、离职或换运营后停止生成新内容，已发内容按授权政策处理。',
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
          historicalContentPermission: 'review_required',
        }
  );
}

function lines(value: string) {
  return value
    .split(/[,\n，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
