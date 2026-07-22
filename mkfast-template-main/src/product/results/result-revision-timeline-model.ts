/**
 * Result Center version timeline pure projection (P1-B1 / #150).
 *
 * Reads ContentPackage revision facts only — never invents a second Result
 * ledger. Merchant language only: no UUID operator labels.
 */

export type RevisionTimelineVersionSource =
  | 'ai_generated'
  | 'merchant_edited'
  | 'rollback_restored';

/** Canonical ContentPackage version facts the panel may read. */
export type RevisionTimelineVersionFact = {
  versionId: string;
  title: string;
  createdAt: string;
  source?: RevisionTimelineVersionSource;
  derivedFromVersionId?: string;
  /**
   * Optional merchant-safe operator display name.
   * Must never be a raw Work/Job/User UUID.
   */
  operatorDisplayName?: string;
};

export type RevisionTimelineFacts = {
  currentVersionId?: string;
  versions: readonly RevisionTimelineVersionFact[];
};

export type RevisionTimelineRecoverAction = {
  kind: 'restore_version';
  targetVersionId: string;
  label: string;
  enabled: boolean;
};

export type RevisionTimelineEntry = {
  versionId: string;
  title: string;
  /** Localised timestamp for merchant display. */
  createdAtLabel: string;
  operatorLabel: string;
  sourceLabel: string;
  /** Derived-from title when the parent version is still in the timeline. */
  derivedFromLabel?: string;
  isCurrent: boolean;
  recoverAction: RevisionTimelineRecoverAction | null;
};

export type RevisionTimelinePanelView = {
  heading: string;
  summary: string;
  empty: boolean;
  emptyMessage: string;
  entries: RevisionTimelineEntry[];
};

const SOURCE_LABEL: Record<RevisionTimelineVersionSource, string> = {
  ai_generated: '系统生成',
  merchant_edited: '本店修改',
  rollback_restored: '版本恢复',
};

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

function isUnsafeOperatorLabel(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (UUID_RE.test(trimmed)) return true;
  // Bare opaque ids without spaces (e.g. "user_abc123") stay hidden.
  if (
    /^[a-z0-9_-]{16,}$/iu.test(trimmed) &&
    !/[\u4e00-\u9fff]/u.test(trimmed)
  ) {
    return true;
  }
  return false;
}

export function revisionSourceLabel(
  source: RevisionTimelineVersionSource | undefined
): string {
  if (!source) return '内容版本';
  return SOURCE_LABEL[source];
}

export function revisionOperatorLabel(
  source: RevisionTimelineVersionSource | undefined,
  operatorDisplayName?: string
): string {
  if (!isUnsafeOperatorLabel(operatorDisplayName)) {
    return operatorDisplayName!.trim();
  }
  switch (source) {
    case 'merchant_edited':
      return '本店同事';
    case 'rollback_restored':
      return '本店恢复';
    case 'ai_generated':
    case undefined:
      return '系统';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function formatCreatedAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/**
 * Project the version timeline panel from ContentPackage revisions.
 * Pure — no I/O, no second ledger store.
 */
export function projectRevisionTimeline(
  facts: RevisionTimelineFacts
): RevisionTimelinePanelView {
  const byId = new Map(
    facts.versions.map((version) => [version.versionId, version])
  );
  const ordered = [...facts.versions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  const entries: RevisionTimelineEntry[] = ordered.map((version) => {
    const isCurrent =
      Boolean(facts.currentVersionId) &&
      version.versionId === facts.currentVersionId;
    const parent = version.derivedFromVersionId
      ? byId.get(version.derivedFromVersionId)
      : undefined;
    const derivedFromLabel = parent
      ? `基于「${parent.title || '上一版本'}」`
      : version.derivedFromVersionId
        ? '基于较早版本'
        : undefined;

    return {
      versionId: version.versionId,
      title: version.title.trim() || '未命名版本',
      createdAtLabel: formatCreatedAtLabel(version.createdAt),
      operatorLabel: revisionOperatorLabel(
        version.source,
        version.operatorDisplayName
      ),
      sourceLabel: revisionSourceLabel(version.source),
      ...(derivedFromLabel ? { derivedFromLabel } : {}),
      isCurrent,
      recoverAction: isCurrent
        ? null
        : {
            kind: 'restore_version',
            targetVersionId: version.versionId,
            label: '恢复此版本',
            enabled: true,
          },
    };
  });

  const empty = entries.length === 0;
  return {
    heading: '版本与历史',
    summary: empty
      ? '还没有可查看的内容版本。'
      : `共 ${entries.length} 个版本，最新在上。`,
    empty,
    emptyMessage: '采用或保存后，这里会显示版本时间线、来源和可恢复动作。',
    entries,
  };
}
