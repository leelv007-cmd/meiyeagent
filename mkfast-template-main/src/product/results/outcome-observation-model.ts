/**
 * Outcome observation ledger pure projection (P1-E1 / #158).
 *
 * Append-only ledger with supersede corrections. Source tiers are fixed:
 * verified / merchant_recorded / inferred_association.
 * Missing signals stay unknown — never zero or pseudo-ROI.
 */

export const OUTCOME_OBSERVATION_KINDS = [
  'attention',
  'inquiry',
  'contact_added',
  'appointment',
  'voucher_purchase',
  'redemption',
  'store_visit',
  /** U2「没动静」— first-class; never encode via feedback (V31-19). */
  'no_activity',
] as const;

export type OutcomeObservationKind = (typeof OUTCOME_OBSERVATION_KINDS)[number];

export const OUTCOME_OBSERVATION_KIND_LABEL: Record<
  OutcomeObservationKind,
  string
> = {
  attention: '获得注意',
  inquiry: '发生咨询',
  contact_added: '加微',
  appointment: '预约',
  voucher_purchase: '买券',
  redemption: '核销',
  store_visit: '到店',
  no_activity: '没动静',
};

/** U2 self-report chips (six). attention/redemption stay available as extended. */
export const OUTCOME_SELF_REPORT_CHIP_KINDS = [
  'inquiry',
  'contact_added',
  'appointment',
  'voucher_purchase',
  'store_visit',
  'no_activity',
] as const satisfies readonly OutcomeObservationKind[];

export const OUTCOME_SOURCE_TIERS = [
  'verified',
  'merchant_recorded',
  'inferred_association',
] as const;

export type OutcomeSourceTier = (typeof OUTCOME_SOURCE_TIERS)[number];

export const OUTCOME_SOURCE_TIER_LABEL: Record<OutcomeSourceTier, string> = {
  verified: '已验证',
  merchant_recorded: '门店记录',
  inferred_association: '推断相关性',
};

export const OUTCOME_LADDER_STEPS = [
  'published',
  'attention',
  'consultation',
  'appointment_or_purchase',
  'redeemed_or_visited',
] as const;

export type OutcomeLadderStepId = (typeof OUTCOME_LADDER_STEPS)[number];

export const OUTCOME_LADDER_STEP_LABEL: Record<OutcomeLadderStepId, string> = {
  published: '已发布',
  attention: '获得注意',
  consultation: '发生咨询',
  appointment_or_purchase: '预约/买券',
  redeemed_or_visited: '核销/到店',
};

/**
 * Canonical observation fact (append-only).
 * Never stores full chat body, customer contact, or CRM detail.
 */
export type OutcomeObservationFact = {
  id: string;
  workspaceId: string;
  contentPackageId: string;
  contentPackageRevision: number;
  publicationRecordId?: string;
  kind: OutcomeObservationKind;
  /** When the signal occurred (merchant clock). */
  occurredAt: string;
  /** When the ledger row was recorded. */
  recordedAt: string;
  actorId: string;
  sourceTier: OutcomeSourceTier;
  quantity?: number;
  /** Minimal necessary note — never PII contact details. */
  note?: string;
  /** Supersede chain: this row replaces an earlier observation. */
  supersedesObservationId?: string;
};

export type OutcomeChipAction = {
  kind: OutcomeObservationKind;
  label: string;
  enabled: boolean;
  /** Min 44×44 target for 375px. */
  minHitAreaPx: 44;
  testId: string;
};

export type OutcomeObservationPanelView =
  | {
      kind: 'ready';
      heading: string;
      summary: string;
      chips: OutcomeChipAction[];
      ladder: Array<{
        id: OutcomeLadderStepId;
        label: string;
        reached: boolean;
        /** unknown when step not reached and no negative evidence. */
        state: 'reached' | 'unknown';
      }>;
      groups: Array<{
        sourceTier: OutcomeSourceTier;
        sourceTierLabel: string;
        disclaimer?: string;
        observations: Array<{
          id: string;
          kindLabel: string;
          occurredAtLabel: string;
          quantityLabel: string;
          isSuperseded: boolean;
          supersedesLabel?: string;
        }>;
        emptyLabel: string;
      }>;
      /** Hard rule: inferred never uses causal verbs. */
      inferredUsesCausalLanguage: false;
    }
  | {
      kind: 'fail_closed';
      heading: string;
      reason:
        | 'not_published'
        | 'missing_package_revision'
        | 'workspace_mismatch'
        | 'missing_publication_binding';
      message: string;
      chips: OutcomeChipAction[];
    };

/** Map legacy ContentPackage signal kinds onto P1-E1 kinds. */
export function mapLegacyResultSignalKind(
  kind: string
): OutcomeObservationKind | null {
  switch (kind) {
    case 'attention':
      return 'attention';
    case 'private_message':
    case 'inquiry':
      return 'inquiry';
    case 'wechat_added':
    case 'contact_added':
      return 'contact_added';
    case 'appointment':
      return 'appointment';
    case 'voucher_purchased':
    case 'voucher_purchase':
      return 'voucher_purchase';
    case 'redeemed':
    case 'redemption':
      return 'redemption';
    case 'store_visit':
      return 'store_visit';
    case 'no_activity':
      return 'no_activity';
    default:
      return null;
  }
}

/** Map legacy source enum onto P1-E1 source tiers. */
export function mapLegacyResultSignalSource(
  source: string
): OutcomeSourceTier | null {
  switch (source) {
    case 'verified_adapter':
    case 'verified':
      return 'verified';
    case 'merchant_recorded':
      return 'merchant_recorded';
    case 'inferred_temporal':
    case 'inferred_association':
      return 'inferred_association';
    default:
      return null;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return iso.slice(0, 16);
  }
}

function ladderStage(kind: OutcomeObservationKind): number {
  switch (kind) {
    case 'attention':
      return 1;
    case 'inquiry':
    case 'contact_added':
      return 2;
    case 'appointment':
    case 'voucher_purchase':
      return 3;
    case 'redemption':
    case 'store_visit':
      return 4;
    case 'no_activity':
      // Negative chip: does not advance the evidence ladder.
      return 0;
  }
}

export function projectOutcomeLadder(input: {
  hasPublicationRecord: boolean;
  activeObservations: readonly OutcomeObservationFact[];
}): Array<{
  id: OutcomeLadderStepId;
  label: string;
  reached: boolean;
  state: 'reached' | 'unknown';
}> {
  const stage = input.activeObservations.reduce(
    (highest, obs) => Math.max(highest, ladderStage(obs.kind)),
    0
  );
  return OUTCOME_LADDER_STEPS.map((id) => {
    const reached =
      id === 'published'
        ? input.hasPublicationRecord
        : id === 'attention'
          ? stage >= 1
          : id === 'consultation'
            ? stage >= 2
            : id === 'appointment_or_purchase'
              ? stage >= 3
              : stage >= 4;
    return {
      id,
      label: OUTCOME_LADDER_STEP_LABEL[id],
      reached,
      state: reached ? ('reached' as const) : ('unknown' as const),
    };
  });
}

function disabledChips(reasonDisabled: boolean): OutcomeChipAction[] {
  return OUTCOME_OBSERVATION_KINDS.map((kind) => ({
    kind,
    label: OUTCOME_OBSERVATION_KIND_LABEL[kind],
    enabled: !reasonDisabled,
    minHitAreaPx: 44 as const,
    testId: `outcome-chip-${kind}`,
  }));
}

/**
 * Active observations exclude those superseded by a later row.
 */
export function activeOutcomeObservations(
  observations: readonly OutcomeObservationFact[]
): OutcomeObservationFact[] {
  const superseded = new Set(
    observations
      .map((o) => o.supersedesObservationId)
      .filter((id): id is string => Boolean(id))
  );
  return observations.filter((o) => !superseded.has(o.id));
}

/**
 * Project outcome chips + evidence ladder.
 * Fail closed until a publication record exists for the package.
 */
export function projectOutcomeObservationPanel(input: {
  workspaceId?: string;
  contentPackageId?: string;
  contentPackageRevision?: number;
  hasPublicationRecord?: boolean;
  observations?: readonly OutcomeObservationFact[];
  observationsWorkspaceId?: string;
}): OutcomeObservationPanelView {
  const heading = '结果信号';
  const chipsDisabled = disabledChips(true);

  if (
    input.contentPackageId === undefined ||
    input.contentPackageRevision === undefined ||
    !Number.isInteger(input.contentPackageRevision) ||
    input.contentPackageRevision < 0
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'missing_package_revision',
      message: '尚未绑定精确成品版本，无法记录结果信号。',
      chips: chipsDisabled,
    };
  }

  if (
    input.workspaceId &&
    input.observationsWorkspaceId &&
    input.workspaceId !== input.observationsWorkspaceId
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'workspace_mismatch',
      message: '结果信号不属于当前工作区，已隐藏。',
      chips: chipsDisabled,
    };
  }

  if (input.hasPublicationRecord !== true) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'not_published',
      message: '发布记录写入后，才能补记注意、咨询、加微等结果信号。',
      chips: chipsDisabled,
    };
  }

  const all = (input.observations ?? []).filter(
    (o) => o.contentPackageId === input.contentPackageId
  );
  const active = activeOutcomeObservations(all);
  const supersededIds = new Set(
    all
      .map((o) => o.supersedesObservationId)
      .filter((id): id is string => Boolean(id))
  );

  const byTier = (tier: OutcomeSourceTier) =>
    all
      .filter((o) => o.sourceTier === tier)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return {
    kind: 'ready',
    heading,
    summary:
      '按证据分级展示经营进展；推断相关性不表示由该内容导致。缺失显示未知，不显示零。',
    chips: disabledChips(false),
    ladder: projectOutcomeLadder({
      hasPublicationRecord: true,
      activeObservations: active,
    }),
    groups: [
      {
        sourceTier: 'verified',
        sourceTierLabel: OUTCOME_SOURCE_TIER_LABEL.verified,
        observations: byTier('verified').map(toRow(supersededIds)),
        emptyLabel: '暂无已验证信号',
      },
      {
        sourceTier: 'merchant_recorded',
        sourceTierLabel: OUTCOME_SOURCE_TIER_LABEL.merchant_recorded,
        observations: byTier('merchant_recorded').map(toRow(supersededIds)),
        emptyLabel: '暂无门店记录',
      },
      {
        sourceTier: 'inferred_association',
        sourceTierLabel: OUTCOME_SOURCE_TIER_LABEL.inferred_association,
        disclaimer: '仅时间与内容关联，不代表由该内容导致、带来或转化。',
        observations: byTier('inferred_association').map(toRow(supersededIds)),
        emptyLabel: '暂无推断关联',
      },
    ],
    inferredUsesCausalLanguage: false,
  };
}

function toRow(supersededIds: Set<string>) {
  return (obs: OutcomeObservationFact) => ({
    id: obs.id,
    kindLabel: OUTCOME_OBSERVATION_KIND_LABEL[obs.kind],
    occurredAtLabel: formatTime(obs.occurredAt),
    quantityLabel: obs.quantity === undefined ? '未知' : String(obs.quantity),
    isSuperseded: supersededIds.has(obs.id),
    ...(obs.supersedesObservationId
      ? {
          supersedesLabel: `更正自 ${obs.supersedesObservationId.slice(0, 8)}`,
        }
      : {}),
  });
}

/**
 * Project observations from existing ContentPackage resultSignals.
 */
export function observationsFromResultSignals(input: {
  workspaceId: string;
  contentPackageId: string;
  contentPackageRevision: number;
  publicationRecordId?: string;
  signals: readonly {
    id: string;
    kind: string;
    source: string;
    actorId: string;
    occurredAt: string;
    quantity?: number;
    note?: string;
    supersedesSignalId?: string;
    status?: 'active' | 'superseded' | 'withdrawn';
    /**
     * V31-19: the exact revision this signal observed, or `'unknown'` for the
     * quarantined legacy rows the migration could not prove. Required on the
     * contract (`content-package.ts:595`) — omitting it here silently dropped
     * the field and let every row inherit the package's current revision.
     */
    contentPackageRevision?: number | 'unknown';
  }[];
}): OutcomeObservationFact[] {
  const out: OutcomeObservationFact[] = [];
  for (const signal of input.signals) {
    if (signal.status === 'withdrawn') continue;
    // A row that cannot name the revision it observed is not provable evidence,
    // so it must never be laundered into the package's current revision and
    // rendered as bound. Same rule as the Core twin
    // (`content-package-facts.ts:109`).
    if (signal.contentPackageRevision === 'unknown') continue;
    const kind = mapLegacyResultSignalKind(signal.kind);
    const sourceTier = mapLegacyResultSignalSource(signal.source);
    if (!kind || !sourceTier) continue;
    // Inferred projection never carries no_activity (merchant-only negative).
    if (sourceTier === 'inferred_association' && kind === 'no_activity') {
      continue;
    }
    out.push({
      id: signal.id,
      workspaceId: input.workspaceId,
      contentPackageId: input.contentPackageId,
      contentPackageRevision:
        signal.contentPackageRevision ?? input.contentPackageRevision,
      ...(input.publicationRecordId
        ? { publicationRecordId: input.publicationRecordId }
        : {}),
      kind,
      occurredAt: signal.occurredAt,
      recordedAt: signal.occurredAt,
      actorId: signal.actorId,
      sourceTier,
      ...(signal.quantity !== undefined ? { quantity: signal.quantity } : {}),
      ...(signal.note ? { note: signal.note } : {}),
      ...(signal.supersedesSignalId
        ? { supersedesObservationId: signal.supersedesSignalId }
        : {}),
    });
  }
  return out;
}

/**
 * Reject notes that look like full chat bodies or contact PII.
 * Pure client guard — server still enforces.
 */
export function isUnsafeOutcomeNote(note: string | undefined): boolean {
  if (!note) return false;
  const trimmed = note.trim();
  if (trimmed.length > 120) return true;
  if (/(微信|手机|电话|1[3-9]\d{9})/u.test(trimmed)) return true;
  if (/@/.test(trimmed) && /\./.test(trimmed)) return true;
  return false;
}
