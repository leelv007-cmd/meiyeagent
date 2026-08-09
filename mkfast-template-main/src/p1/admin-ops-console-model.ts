/**
 * Ops console view helpers (V31-22). Pure model — no network.
 */

export type OpsReleaseListItemView = {
  releaseId: string;
  version: number;
  status: string;
  manifestHash: string;
  createdAt: string;
  updatedAt: string | null;
  workspaceAllowlist: string[];
  approvedBy: string | null;
};

export type OpsReleaseListView = {
  items: OpsReleaseListItemView[];
  production: string | null;
  canary: string | null;
  draft: string[];
};

export type OpsKillSwitchView = {
  switchId: string;
  landed: boolean;
  providerTicket: string;
  impactScope: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
  reason: string | null;
  canEnable: boolean;
  unavailableReason: string | null;
};

export type OpsAuditEntryView = {
  id: string;
  action: string;
  operatorId: string;
  reason: string;
  evidence: string | null;
  target: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type OpsToolPolicyListView = {
  items: {
    toolName: string;
    revisions: { revision: string; description: string; createdAt: string }[];
    productionPinned: boolean;
  }[];
  productionToolPolicyRevision: string | null;
};

export type OpsDiffView = {
  leftReleaseId: string;
  rightReleaseId: string;
  changes: { path: string; left: unknown; right: unknown }[];
};

/** Three-state buckets for the release desk list. */
export function bucketReleases(list: OpsReleaseListView): {
  production: OpsReleaseListItemView[];
  canary: OpsReleaseListItemView[];
  draft: OpsReleaseListItemView[];
  other: OpsReleaseListItemView[];
} {
  const production: OpsReleaseListItemView[] = [];
  const canary: OpsReleaseListItemView[] = [];
  const draft: OpsReleaseListItemView[] = [];
  const other: OpsReleaseListItemView[] = [];
  for (const item of list.items) {
    if (item.status === 'production') production.push(item);
    else if (item.status === 'canary') canary.push(item);
    else if (item.status === 'draft') draft.push(item);
    else other.push(item);
  }
  return { production, canary, draft, other };
}

export function shortHash(hash: string, len = 12): string {
  if (hash.length <= len) return hash;
  return `${hash.slice(0, len)}…`;
}

export function canSubmitRollback(input: {
  reason: string;
  evidence: string;
}): boolean {
  return input.reason.trim().length > 0 && input.evidence.trim().length > 0;
}
