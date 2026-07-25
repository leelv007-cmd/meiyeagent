import { createHash } from 'node:crypto';

import { extractVisibleClaimPatternMatches } from './visible-claim-patterns.js';

export const HARNESS_GATE_IDS = [
  'cross_workspace_lineage',
  'critical_fact_source',
  'subject_asset_rights',
  'expression_identity',
  'price_benefit_freshness',
  'external_revision',
  'external_action_approval',
] as const;

export type HarnessGateId = (typeof HARNESS_GATE_IDS)[number];
export type HarnessPolicyPhase =
  | 'execution'
  | 'delivery'
  | 'export'
  | 'publish'
  | 'paid_action';

export type HarnessFactClaim = {
  kind: 'price' | 'benefit' | 'qualification' | 'offer' | 'other';
  value: string;
  sourceRef?: string;
};

export interface VisibleClaimExtraction {
  claims: Array<HarnessFactClaim & { field: string }>;
  inputHash: string;
  revision: 'visible-claim-extractor-v2';
}

export interface HarnessPolicyInput {
  phase: HarnessPolicyPhase;
  bundle: { workspaceId: string; revision: number };
  brief: Record<string, unknown>;
  candidate: {
    candidateId: string;
    workspaceId: string;
    intendedUse: 'internal_draft' | 'public_content' | 'paid_promotion';
    factClaims: HarnessFactClaim[];
    assetRefs: string[];
    expressionIdentityRef?: string;
    visibleText?: Array<{ field: string; text: string }>;
  };
  trustedFactClaims?: HarnessFactClaim[];
  sourceRefs: Array<{
    id: string;
    workspaceId: string;
    revision: number;
    status: 'current' | 'expired' | 'withdrawn';
  }>;
  rightsRefs: Array<{
    assetId: string;
    workspaceId: string;
    status: 'authorized' | 'unknown' | 'withdrawn';
    allowedUses: Array<
      'internal_draft' | 'public_content' | 'paid_promotion'
    >;
  }>;
  identityRefs: Array<{
    id: string;
    workspaceId: string;
    status: 'registered' | 'unregistered' | 'withdrawn';
  }>;
  actionContext?: {
    kind: 'export' | 'publish' | 'paid_action';
    target: string;
    revision: number;
  };
  approvalReceipt?: {
    status: 'approved' | 'revoked';
    actionKind: 'export' | 'publish' | 'paid_action';
    target: string;
    revision: number;
  };
  currentRevision?: number;
}

export interface HarnessGateFailure {
  gateId: HarnessGateId;
  reason: string;
  alternativePath: string[];
  triggeredClaims?: VisibleClaimExtraction['claims'];
}

export interface HarnessPolicyResult {
  passed: boolean;
  failures: HarnessGateFailure[];
  claimExtraction?: VisibleClaimExtraction;
}

export function createHarnessCandidateValidator(
  input: Omit<HarnessPolicyInput, 'candidate'>,
) {
  return {
    validate(candidate: HarnessPolicyInput['candidate']) {
      return validateHarnessPolicy({ ...structuredClone(input), candidate });
    },
  };
}

const CONTENT_PHASE_GATE_IDS = HARNESS_GATE_IDS.slice(0, 5);

export function validateHarnessPolicy(
  input: HarnessPolicyInput,
): HarnessPolicyResult {
  const claimExtraction =
    input.phase === 'execution'
      ? undefined
      : extractVisibleClaims(input.candidate.visibleText ?? []);
  const policyInput = claimExtraction
    ? withExtractedVisibleClaims(input, claimExtraction)
    : input;
  const failures = CONTENT_PHASE_GATE_IDS.flatMap((gateId) => {
    const failure = contentGate(gateId, policyInput, claimExtraction);
    return failure ? [failure] : [];
  });
  if (
    input.phase === 'export' ||
    input.phase === 'publish' ||
    input.phase === 'paid_action'
  ) {
    const revisionFailure = externalRevisionGate(policyInput);
    if (revisionFailure) {
      failures.push(revisionFailure);
    } else {
      const approvalFailure = externalApprovalGate(policyInput);
      if (approvalFailure) failures.push(approvalFailure);
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    ...(claimExtraction ? { claimExtraction } : {}),
  };
}

function contentGate(
  gateId: HarnessGateId,
  input: HarnessPolicyInput,
  claimExtraction?: VisibleClaimExtraction,
): HarnessGateFailure | null {
  switch (gateId) {
    case 'cross_workspace_lineage':
      return crossWorkspaceGate(input);
    case 'critical_fact_source':
      return criticalFactSourceGate(input, claimExtraction);
    case 'subject_asset_rights':
      return subjectAssetRightsGate(input);
    case 'expression_identity':
      return expressionIdentityGate(input);
    case 'price_benefit_freshness':
      return priceBenefitFreshnessGate(input);
    default:
      return null;
  }
}

function crossWorkspaceGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const expected = input.bundle.workspaceId;
  const mismatched =
    input.candidate.workspaceId !== expected ||
    input.sourceRefs.some((reference) => reference.workspaceId !== expected) ||
    input.rightsRefs.some((reference) => reference.workspaceId !== expected) ||
    input.identityRefs.some((reference) => reference.workspaceId !== expected);
  return mismatched
    ? failure(
        'cross_workspace_lineage',
        '候选引用了其他门店或其他表达主体的数据，已停止该候选。',
        ['移除跨店引用', '重新编译当前门店 ContextBundle'],
      )
    : null;
}

function criticalFactSourceGate(
  input: HarnessPolicyInput,
  claimExtraction?: VisibleClaimExtraction,
): HarnessGateFailure | null {
  const sourceIds = new Set(input.sourceRefs.map(({ id }) => id));
  const ungrounded = input.candidate.factClaims.some(
    (claim) =>
      claim.kind !== 'other' &&
      (!claim.sourceRef || !sourceIds.has(claim.sourceRef)),
  );
  if (!ungrounded) return null;
  const triggeredClaims = claimExtraction?.claims.filter(
    (claim) =>
      !input.candidate.factClaims.some(
        (candidate) =>
          candidate.kind === claim.kind &&
          candidate.value === claim.value &&
          candidate.sourceRef &&
          sourceIds.has(candidate.sourceRef),
      ),
  );
  return triggeredClaims?.length
    ? failure(
        'critical_fact_source',
        visibleClaimFailureReason(triggeredClaims),
        ['核对并补充门店已确认资料', '删除或改写无依据内容'],
        triggeredClaims,
      )
    : failure(
        'critical_fact_source',
        '候选中的关键经营事实没有可追溯来源，不能作为真实内容交付。',
        ['补充权威事实来源', '删除无来源主张'],
      );
}

function subjectAssetRightsGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const rightsByAsset = new Map(
    input.rightsRefs.map((reference) => [reference.assetId, reference]),
  );
  const unauthorized = input.candidate.assetRefs.some((assetId) => {
    const rights = rightsByAsset.get(assetId);
    return (
      !rights ||
      rights.status !== 'authorized' ||
      !rights.allowedUses.includes(input.candidate.intendedUse)
    );
  });
  return unauthorized
    ? failure(
        'subject_asset_rights',
        '候选使用了未授权或用途不匹配的主体素材，已停止该候选。',
        ['换安全素材', '匿名化', '请求授权', '放弃该表达'],
      )
    : null;
}

function expressionIdentityGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const identityRef = input.candidate.expressionIdentityRef;
  if (!identityRef) return null;
  const identity = input.identityRefs.find(({ id }) => id === identityRef);
  return !identity || identity.status !== 'registered'
    ? failure(
        'expression_identity',
        '候选声称了未登记或已撤回的表达身份，不能冒用该身份。',
        ['改用门店中性表达', '登记并核验表达身份'],
      )
    : null;
}

function priceBenefitFreshnessGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const sourceById = new Map(
    input.sourceRefs.map((reference) => [reference.id, reference]),
  );
  const stale = input.candidate.factClaims.some((claim) => {
    if (!['price', 'benefit', 'offer'].includes(claim.kind)) return false;
    if (!claim.sourceRef) return false;
    const source = sourceById.get(claim.sourceRef);
    if (!source) return false;
    return source?.status !== 'current';
  });
  return stale
    ? failure(
        'price_benefit_freshness',
        '候选使用了已过期或撤回的价格、优惠或权益。',
        ['补充当前有效事实', '移除过期价格或权益'],
      )
    : null;
}

function externalRevisionGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const action = input.actionContext;
  const invalid =
    !action ||
    input.currentRevision === undefined ||
    action.revision !== input.currentRevision;
  return invalid
    ? failure(
        'external_revision',
        '准备外发的不是当前权威版本，已阻止继续。',
        ['刷新当前版本', '重新生成外发快照'],
      )
    : null;
}

function externalApprovalGate(
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  const action = input.actionContext;
  if (!action || action.kind === 'export') return null;
  const receipt = input.approvalReceipt;
  const invalid =
    !receipt ||
    receipt.status !== 'approved' ||
    receipt.actionKind !== action.kind ||
    receipt.target !== action.target ||
    receipt.revision !== action.revision;
  return invalid
    ? failure(
        'external_action_approval',
        '公开或付费动作缺少绑定当前版本、目标与用途的一次性批准。',
        ['请求本次动作批准', '改为仅保存草稿'],
      )
    : null;
}

function failure(
  gateId: HarnessGateId,
  reason: string,
  alternativePath: string[],
  triggeredClaims?: VisibleClaimExtraction['claims'],
): HarnessGateFailure {
  return {
    gateId,
    reason,
    alternativePath,
    ...(triggeredClaims?.length ? { triggeredClaims } : {}),
  };
}

export function extractVisibleClaims(
  visibleText: Array<{ field: string; text: string }>,
): VisibleClaimExtraction {
  const normalizedFields = visibleText.map(({ field, text }) => ({
    field: field.trim(),
    text: text.trim(),
  }));
  const claims = normalizedFields.flatMap(({ field, text }) =>
    extractClaimsFromField(field, text),
  );
  return {
    claims: deduplicateVisibleClaims(claims),
    inputHash: createHash('sha256')
      .update(JSON.stringify(normalizedFields))
      .digest('hex'),
    revision: 'visible-claim-extractor-v2',
  };
}

function extractClaimsFromField(field: string, text: string) {
  return extractVisibleClaimPatternMatches(text).map((claim) => ({
    field,
    ...claim,
  }));
}

function withExtractedVisibleClaims(
  input: HarnessPolicyInput,
  extraction: VisibleClaimExtraction,
): HarnessPolicyInput {
  const extractedClaims = extraction.claims.map(({ field: _field, ...claim }) => {
    const trusted = input.trustedFactClaims?.find((candidate) =>
      trustedClaimSupports(candidate, claim),
    );
    return {
      ...claim,
      ...(trusted?.sourceRef ? { sourceRef: trusted.sourceRef } : {}),
    };
  });
  return {
    ...input,
    candidate: {
      ...input.candidate,
      factClaims: [...input.candidate.factClaims, ...extractedClaims],
    },
  };
}

function trustedClaimSupports(
  trusted: HarnessFactClaim,
  extracted: HarnessFactClaim,
) {
  if (
    trusted.kind !== extracted.kind &&
    !(trusted.kind === 'offer' && extracted.kind === 'price') &&
    !(trusted.kind === 'price' && extracted.kind === 'offer') &&
    !(trusted.kind === 'offer' && extracted.kind === 'benefit') &&
    !(trusted.kind === 'benefit' && extracted.kind === 'offer')
  ) {
    return false;
  }
  const trustedValue = normalizeClaimValue(trusted.value);
  const extractedValue = normalizeClaimValue(extracted.value);
  const extractedNumbers = comparableNumericValues(extracted.value);
  if (extractedNumbers.size > 0) {
    const trustedNumbers = trustedNumericValues(trusted.value);
    return [...extractedNumbers].every((number) => trustedNumbers.has(number));
  }
  return (
    trustedValue.includes(extractedValue) ||
    extractedValue.includes(trustedValue)
  );
}

function normalizeClaimValue(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function deduplicateVisibleClaims(
  claims: VisibleClaimExtraction['claims'],
): VisibleClaimExtraction['claims'] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = JSON.stringify(claim);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visibleClaimFailureReason(
  claims: VisibleClaimExtraction['claims'],
) {
  const kinds = new Set(claims.map(({ kind }) => kind));
  const labels = [
    kinds.has('qualification') ? '资质' : null,
    kinds.has('price') || kinds.has('offer') ? '价格或优惠' : null,
    kinds.has('benefit') ? '权益承诺' : null,
  ].filter((label): label is string => label !== null);
  return `成品文案含有未被门店已确认资料支持的${labels.join('、')}，暂不能交付。`;
}

function trustedNumericValues(value: string) {
  try {
    return numericValuesFromUnknown(JSON.parse(value));
  } catch {
    return comparableNumericValues(value);
  }
}

function numericValuesFromUnknown(
  value: unknown,
  key = '',
  result = new Set<string>(),
) {
  if (TEMPORAL_FACT_KEY.test(key)) return result;
  if (typeof value === 'number' && Number.isFinite(value)) {
    result.add(canonicalNumericValue(String(value)));
    return result;
  }
  if (typeof value === 'string') {
    if (!ISO_DATE_VALUE.test(value)) {
      for (const number of comparableNumericValues(value)) result.add(number);
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) numericValuesFromUnknown(item, key, result);
    return result;
  }
  if (value && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      numericValuesFromUnknown(nestedValue, nestedKey, result);
    }
  }
  return result;
}

function comparableNumericValues(value: string) {
  return new Set(
    (value.normalize('NFKC').match(/[-+]?\d+(?:\.\d+)?/gu) ?? []).map(
      canonicalNumericValue,
    ),
  );
}

function canonicalNumericValue(value: string) {
  return String(Number(value));
}

const TEMPORAL_FACT_KEY =
  /(?:at|date|time|until|from|expires|expired|effective|recorded|captured|valid|revision)$/iu;
const ISO_DATE_VALUE = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/u;
