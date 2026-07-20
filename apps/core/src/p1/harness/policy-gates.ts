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
  | 'export'
  | 'publish'
  | 'paid_action';

export interface HarnessPolicyInput {
  phase: HarnessPolicyPhase;
  bundle: { workspaceId: string; revision: number };
  brief: Record<string, unknown>;
  candidate: {
    candidateId: string;
    workspaceId: string;
    intendedUse: 'internal_draft' | 'public_content' | 'paid_promotion';
    factClaims: Array<{
      kind: 'price' | 'benefit' | 'qualification' | 'offer' | 'other';
      value: string;
      sourceRef?: string;
    }>;
    assetRefs: string[];
    expressionIdentityRef?: string;
  };
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
}

export interface HarnessPolicyResult {
  passed: boolean;
  failures: HarnessGateFailure[];
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
  const failures = CONTENT_PHASE_GATE_IDS.flatMap((gateId) => {
    const failure = contentGate(gateId, input);
    return failure ? [failure] : [];
  });
  if (input.phase !== 'execution') {
    const revisionFailure = externalRevisionGate(input);
    if (revisionFailure) {
      failures.push(revisionFailure);
    } else {
      const approvalFailure = externalApprovalGate(input);
      if (approvalFailure) failures.push(approvalFailure);
    }
  }
  return { passed: failures.length === 0, failures };
}

function contentGate(
  gateId: HarnessGateId,
  input: HarnessPolicyInput,
): HarnessGateFailure | null {
  switch (gateId) {
    case 'cross_workspace_lineage':
      return crossWorkspaceGate(input);
    case 'critical_fact_source':
      return criticalFactSourceGate(input);
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
): HarnessGateFailure | null {
  const sourceIds = new Set(input.sourceRefs.map(({ id }) => id));
  const ungrounded = input.candidate.factClaims.some(
    (claim) =>
      claim.kind !== 'other' &&
      (!claim.sourceRef || !sourceIds.has(claim.sourceRef)),
  );
  return ungrounded
    ? failure(
        'critical_fact_source',
        '候选中的关键经营事实没有可追溯来源，不能作为真实内容交付。',
        ['补充权威事实来源', '删除无来源主张'],
      )
    : null;
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
): HarnessGateFailure {
  return { gateId, reason, alternativePath };
}
