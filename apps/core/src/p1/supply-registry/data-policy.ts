/**
 * DataPolicyRevision hard filter (G5 / D-064).
 *
 * Deployment binds a versioned DataPolicyRevision (source trust / processing
 * region / retention-training subprocessor / allowed data classes). Task
 * planning freezes dataClass; restricted classes only enter dual-approved
 * Deployments. Content-safety rejection never vendor-switches. No compliant
 * candidate fails closed (no silent data-protection downgrade).
 *
 * ---------------------------------------------------------------------------
 * medical / medical-health naming (D-064 evidence boundary, P1-06)
 * ---------------------------------------------------------------------------
 * `medical` and `medical-health` are **content data sensitivity classes** —
 * they classify the sensitivity of content payload (health-related text /
 * medical descriptors in user content). They are **NOT** the D-025 medical
 * beauty (医美) product category boundary. First-wave routing does **not**
 * authorize medical-beauty content merely because this data class is present.
 * ---------------------------------------------------------------------------
 */
import type {
  DataPolicyRevision,
  SupplyDataClass,
} from '@meiye/contracts';
import type { DataClass, ModelDeployment } from '../model-supply/supply-contracts.js';
import { deploymentAllowsDataClass } from '../model-supply/route-planning.js';

/**
 * All content sensitivity data classes recognized by DataPolicy.
 * Includes `public` (low sensitivity) and restricted classes.
 */
export type ContentSensitivityDataClass = SupplyDataClass;

/**
 * Restricted classes that require dual approval (contract + technical evidence).
 * Spec wording: contains_face / pii / medical-health; `medical` is the legacy
 * alias for the same content-sensitivity bucket (≠ D-025 医美品类).
 */
export const DUAL_APPROVAL_REQUIRED_DATA_CLASSES: readonly ContentSensitivityDataClass[] =
  ['contains_face', 'pii', 'medical', 'medical-health'] as const;

/**
 * Contract comment + test anchor: medical/medical-health is content sensitivity,
 * not the D-025 medical beauty category. First wave does not take medical-beauty
 * content solely because this class is set.
 */
export const MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE =
  'medical/medical-health = content data sensitivity classification; NOT D-025 medical beauty (医美) product category. First-wave does not authorize medical-beauty content from this data class alone.' as const;

export type DataPolicySourceTrustLevel =
  | 'platform_verified'
  | 'contract_attested'
  | 'self_declared'
  | 'untrusted';

export type DualApprovalEvidence = {
  /** SupplyContract / terms revision that authorizes the data class. */
  contractApproved: boolean;
  contractRevisionId?: string;
  /** Technical evidence (activation / conformance / region control). */
  technicalApproved: boolean;
  technicalEvidenceRef?: string;
  approvedAt?: string;
};

export type DataPolicyPayload = {
  sourceTrustLevel: DataPolicySourceTrustLevel | string;
  processingRegion: 'domestic' | 'overseas' | string;
  retentionTrainingSubprocessor?: string;
  allowedDataClasses: ContentSensitivityDataClass[];
  dualApprovalRequiredFor?: ContentSensitivityDataClass[];
};

export type DataPolicyHardFilterReason =
  | 'data_class_disallowed'
  | 'data_policy_region_mismatch'
  | 'dual_approval_missing'
  | 'data_policy_missing_for_restricted_class'
  | 'content_safety_no_vendor_switch'
  | 'no_compliant_candidate';

export type DataPolicyHardFilterResult = {
  allowed: boolean;
  reasons: DataPolicyHardFilterReason[];
  dataPolicyRevisionId: string | null;
  dualApprovalRequired: boolean;
  dualApprovalSatisfied: boolean | null;
};

export type DataProcessingLevelView = {
  /** Operator/user-facing processing level — never a vendor identity. */
  level: 'standard' | 'elevated' | 'protected';
  protectedChannel: boolean;
  /**
   * Front copy for "数据处理等级 / 受保护通道".
   * Must not include provider/counterparty/deployment vendor identity.
   */
  copy: string;
  primaryDataClass: ContentSensitivityDataClass;
  dataClasses: ContentSensitivityDataClass[];
};

/** Normalize planning dataClass: empty → public. */
export function normalizeRequestedDataClasses(
  dataClass: readonly (ContentSensitivityDataClass | DataClass | 'public')[],
): ContentSensitivityDataClass[] {
  if (dataClass.length === 0) return ['public'];
  const out: ContentSensitivityDataClass[] = [];
  for (const value of dataClass) {
    if (
      value === 'public' ||
      value === 'contains_face' ||
      value === 'pii' ||
      value === 'medical' ||
      value === 'medical-health'
    ) {
      if (!out.includes(value)) out.push(value);
    }
  }
  return out.length === 0 ? ['public'] : out;
}

export function isRestrictedDataClass(
  dataClass: ContentSensitivityDataClass,
): boolean {
  return (DUAL_APPROVAL_REQUIRED_DATA_CLASSES as readonly string[]).includes(
    dataClass,
  );
}

export function isMedicalHealthContentSensitivity(
  dataClass: ContentSensitivityDataClass,
): boolean {
  // Content sensitivity only — not D-025 medical beauty category.
  return dataClass === 'medical' || dataClass === 'medical-health';
}

/**
 * Project frontend-safe "数据处理等级 / 受保护通道" copy.
 * Never leaks vendor / counterparty / deployment identity.
 */
export function projectDataProcessingLevel(
  dataClasses: readonly ContentSensitivityDataClass[],
): DataProcessingLevelView {
  const normalized = normalizeRequestedDataClasses([...dataClasses]);
  const hasRestricted = normalized.some(isRestrictedDataClass);
  const hasMedicalHealth = normalized.some(isMedicalHealthContentSensitivity);
  const primary =
    normalized.find(isRestrictedDataClass) ?? normalized[0] ?? 'public';

  if (hasMedicalHealth || normalized.includes('pii')) {
    return {
      level: 'protected',
      protectedChannel: true,
      copy: '受保护通道：内容按高敏感数据处理，仅经双批准合规部署执行。此说明不涉及供应商身份。',
      primaryDataClass: primary,
      dataClasses: normalized,
    };
  }
  if (hasRestricted) {
    return {
      level: 'elevated',
      protectedChannel: true,
      copy: '提升数据处理等级：人脸等受限内容仅进入合规受保护通道。',
      primaryDataClass: primary,
      dataClasses: normalized,
    };
  }
  return {
    level: 'standard',
    protectedChannel: false,
    copy: '标准数据处理等级：低敏感内容可在已获准通道间调度。',
    primaryDataClass: 'public',
    dataClasses: normalized,
  };
}

function dualApprovalRequiredFor(
  payload: DataPolicyPayload,
  dataClass: ContentSensitivityDataClass,
): boolean {
  const required =
    payload.dualApprovalRequiredFor ??
    DUAL_APPROVAL_REQUIRED_DATA_CLASSES.filter((value) =>
      payload.allowedDataClasses.includes(value),
    );
  return required.includes(dataClass) || isRestrictedDataClass(dataClass);
}

/**
 * Hard-filter one Deployment against requested data classes + optional
 * DataPolicyRevision. When no revision is bound, falls through to the thin
 * regional `deploymentAllowsDataClass` characterization behavior.
 */
export function evaluateDataPolicyHardFilter(input: {
  deployment: ModelDeployment;
  requestedDataClasses: readonly (ContentSensitivityDataClass | DataClass | 'public')[];
  dataPolicy?: DataPolicyPayload | DataPolicyRevision | null;
  dataPolicyRevisionId?: string | null;
  dualApproval?: DualApprovalEvidence | null;
  /**
   * When prior attempt was rejected for content safety, vendor switch is
   * forbidden (D-064) — fail closed on the same protection path.
   */
  contentSafetyRejected?: boolean;
}): DataPolicyHardFilterResult {
  const reasons: DataPolicyHardFilterReason[] = [];
  const requested = normalizeRequestedDataClasses([...input.requestedDataClasses]);
  const hasRestricted = requested.some(isRestrictedDataClass);

  if (input.contentSafetyRejected) {
    reasons.push('content_safety_no_vendor_switch');
    return {
      allowed: false,
      reasons,
      dataPolicyRevisionId: input.dataPolicyRevisionId ?? null,
      dualApprovalRequired: hasRestricted,
      dualApprovalSatisfied: null,
    };
  }

  const policy = input.dataPolicy ?? null;
  if (!policy) {
    // F-G-03: restricted data classes fail closed without a bound DataPolicy
    // (null or undefined). Thin regional filter alone is not sufficient.
    if (hasRestricted) {
      reasons.push('data_policy_missing_for_restricted_class');
      return {
        allowed: false,
        reasons,
        dataPolicyRevisionId: null,
        dualApprovalRequired: true,
        dualApprovalSatisfied: false,
      };
    }
    // medical-health is not in thin DataClass; treat as medical for thin path.
    const thinRequested: DataClass[] = requested.flatMap((value) => {
      if (value === 'public') return [];
      if (value === 'medical-health') return ['medical' as DataClass];
      return [value as DataClass];
    });
    const thinAllowed = deploymentAllowsDataClass(
      input.deployment,
      thinRequested,
    );
    if (!thinAllowed) {
      reasons.push('data_class_disallowed');
    }
    return {
      allowed: reasons.length === 0,
      reasons,
      dataPolicyRevisionId: input.dataPolicyRevisionId ?? null,
      dualApprovalRequired: false,
      dualApprovalSatisfied: null,
    };
  }

  // Region: policy processing region must not expand past deployment region.
  if (
    policy.processingRegion === 'domestic' &&
    input.deployment.region !== 'domestic'
  ) {
    reasons.push('data_policy_region_mismatch');
  }
  if (
    policy.processingRegion === 'overseas' &&
    input.deployment.region !== 'overseas'
  ) {
    // Overseas policy on domestic deployment is allowed only if classes are public;
    // restricted classes stay domestic-bound when policy says overseas? Prefer match.
    // Spec: processing region is a hard constraint — mismatch fails.
    reasons.push('data_policy_region_mismatch');
  }

  const allowed = new Set(policy.allowedDataClasses);
  for (const dataClass of requested) {
    if (!allowed.has(dataClass)) {
      // medical ↔ medical-health alias within content-sensitivity bucket
      if (
        dataClass === 'medical' &&
        allowed.has('medical-health')
      ) {
        continue;
      }
      if (
        dataClass === 'medical-health' &&
        allowed.has('medical')
      ) {
        continue;
      }
      reasons.push('data_class_disallowed');
      break;
    }
  }

  let dualApprovalRequired = false;
  let dualApprovalSatisfied: boolean | null = null;
  for (const dataClass of requested) {
    if (!dualApprovalRequiredFor(policy, dataClass)) continue;
    dualApprovalRequired = true;
    const evidence = input.dualApproval;
    const ok =
      evidence?.contractApproved === true &&
      evidence?.technicalApproved === true;
    dualApprovalSatisfied = ok;
    if (!ok) {
      reasons.push('dual_approval_missing');
      break;
    }
  }

  // Still respect thin regional ceiling so policy cannot expand overseas into
  // face/pii/medical without regional support.
  const thinRequested: DataClass[] = requested.flatMap((value) => {
    if (value === 'public') return [];
    if (value === 'medical-health') return ['medical' as DataClass];
    return [value as DataClass];
  });
  if (
    thinRequested.length > 0 &&
    !deploymentAllowsDataClass(input.deployment, thinRequested)
  ) {
    if (!reasons.includes('data_class_disallowed')) {
      reasons.push('data_class_disallowed');
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    dataPolicyRevisionId: input.dataPolicyRevisionId ?? null,
    dualApprovalRequired,
    dualApprovalSatisfied,
  };
}

/**
 * Fail-closed decision when planning yields zero compliant candidates.
 */
export function failClosedWithoutCompliantCandidate(input: {
  eligibleCount: number;
}): {
  failClosed: boolean;
  reason: 'no_compliant_candidate' | null;
} {
  if (input.eligibleCount > 0) {
    return { failClosed: false, reason: null };
  }
  return { failClosed: true, reason: 'no_compliant_candidate' };
}
