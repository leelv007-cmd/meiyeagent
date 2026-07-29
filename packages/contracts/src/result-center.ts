import { z } from 'zod';

/**
 * Result Center navigation / shell contract (S1 / #87, WT-D1 / #99).
 *
 * WT-D1 freezes this module for WT-C / WT-E consumers.
 * Cross-entry handoff uses typed navigation — not ad-hoc query strings.
 *
 * ResultTarget + resolver outcome shapes extended by #94 (B4) for lineage
 * validation and readonly legacy branch. Shell transition matrices stay WT-D.
 *
 * Result Center is a pure projection surface over Task / Work / Job / Asset /
 * ContentPackage / RouteSnapshot / delivery receipts. It MUST NOT introduce a
 * Result table, Result status entity, or second history ledger.
 */

/**
 * Typed ToolHandoff / result-center navigation contract.
 * workId is required; returnToDraftKey and focusKey restore composer context.
 */
export interface ResultCenterNavigation {
  workId: string;
  returnToDraftKey?: string;
  focusKey?: string;
}

/**
 * High-level Result Shell phase union (projection only; WT-D owns transitions).
 * Keep short — detail matrices land in ResultShellModel under WT-D.
 */
export type ResultShellPhase =
  | 'running'
  | 'needs_input'
  | 'ready'
  | 'failed'
  | 'delivered';

/** Shareable Result Center panel keys (D-089). */
export const resultPanels = [
  'result',
  'adjust',
  'delivery',
  'history',
  'run',
] as const;

export type ResultPanel = (typeof resultPanels)[number];

/**
 * Canonical Result Center target.
 * workId is required; optional keys must belong to that Work's lineage.
 */
export type ResultTarget = {
  workId: string;
  contentId?: string;
  versionId?: string;
  panel?: ResultPanel;
  focusKey?: string;
};

/** Mediated workspace kind mounted under Result Shell (D-085). */
export type ResultWorkspaceKind = 'copy' | 'image' | 'video';

/**
 * Shared Result Shell action ids (D-085 matrix).
 * Labels are product-facing and may vary by workspaceKind.
 */
export const resultActionIds = [
  'leave_and_continue',
  'handle_current_issue',
  'adopt_candidate',
  'continue_adjust',
  'deliver',
  'retry',
  'recover_or_verify',
  'create_from_this',
  'cancel_run',
  'open_history',
  'open_run_detail',
  'open_more',
] as const;

export type ResultActionId = (typeof resultActionIds)[number];

export type ResultActionRole = 'primary' | 'secondary' | 'overflow';

/** One projected action chip / command affordance. */
export type ResultAction = {
  id: ResultActionId;
  role: ResultActionRole;
  /** Product label (Chinese). */
  label: string;
  enabled: boolean;
};

/** Canonical object deep-link shown in shell chrome. */
export type ResultCanonicalObjectLink = {
  kind: 'work' | 'content' | 'version' | 'task' | 'job';
  id: string;
};

/**
 * Uncommitted local edit isolation key (D-089).
 * Never merge drafts across workspaceKind / revision / surface version.
 */
export type ResultUncommittedEditKey = {
  workspaceKind: ResultWorkspaceKind;
  workId: string;
  baseRevisionId: string;
  surfaceVersion: string;
};

/** Browser return / restore snapshot (history.state or controlled store). */
export type ResultReturnRestoreSnapshot = {
  sourceRoute: string;
  filter?: string;
  scrollY?: number;
  focusKey?: string;
  panel?: ResultPanel;
  selectedObjectId?: string;
  baseRevisionId?: string;
  uncommittedEditKey?: ResultUncommittedEditKey;
  returnToDraftKey?: string;
};

/** Three-way choice when local base revision drifts from canonical. */
export const resultRevisionDriftChoices = [
  'restore',
  'compare',
  'discard',
] as const;

export type ResultRevisionDriftChoice =
  (typeof resultRevisionDriftChoices)[number];

export type ResultRevisionDriftState = {
  kind: 'revision_drift';
  baseRevisionId: string;
  currentRevisionId: string;
  choices: readonly ResultRevisionDriftChoice[];
  uncommittedEditKey: ResultUncommittedEditKey;
};

/** Command adapter input — every mutating action carries OCC + idempotency. */
export type ResultCommandInput = {
  action: ResultActionId;
  target: ResultTarget;
  expectedRevision?: string;
  idempotencyKey: string;
};

export type ResultCommandOutcome =
  | { kind: 'ok'; revisionId?: string }
  | {
      kind: 'stale';
      currentRevisionId: string;
      baseRevisionId: string;
    }
  | { kind: 'rejected'; code: string; message: string };

/**
 * Unified command adapter contract (D-085 / D-089).
 * New and legacy renderers must call this adapter only — no bypass mutations.
 */
export interface ResultCommandAdapter {
  execute(input: ResultCommandInput): Promise<ResultCommandOutcome>;
}

const resultObjectIdSchema = z.string().trim().min(1);

export const resultAdoptSelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      copyAssetId: resultObjectIdSchema,
      kind: z.literal('copy'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('image'),
      orderedAssetIds: z.array(resultObjectIdSchema).min(1),
    })
    .strict(),
  z
    .object({
      copyAssetId: resultObjectIdSchema,
      kind: z.literal('image_text'),
      orderedAssetIds: z.array(resultObjectIdSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('video'),
      videoAssetId: resultObjectIdSchema,
    })
    .strict(),
]);

/** Canonical merchant adoption command for copy, image sets, and video. */
export const resultAdoptCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    selection: resultAdoptSelectionSchema,
    workId: resultObjectIdSchema,
  })
  .strict();

const resultAdjustLegacySourceSchema = z
  .object({
    baseJobId: resultObjectIdSchema,
    kind: z.literal('legacy_job'),
  })
  .strict();

const resultAdjustContentPackageSourceSchema = z
  .object({
    expectedPackageRevision: z.number().int().nonnegative(),
    kind: z.literal('content_package_snapshot'),
    packageId: resultObjectIdSchema,
    snapshotId: resultObjectIdSchema,
    workflowId: resultObjectIdSchema,
  })
  .strict();

export const resultAdjustSourceSchema = z.discriminatedUnion('kind', [
  resultAdjustLegacySourceSchema,
  resultAdjustContentPackageSourceSchema,
]);

const resultAdjustScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      assetId: resultObjectIdSchema,
      kind: z.literal('asset'),
    })
    .strict(),
  z
    .object({
      assetIds: z.array(resultObjectIdSchema).min(1),
      kind: z.literal('set'),
    })
    .strict(),
]);

/** Prepare an adjustment by freezing its source revision and explicit scope. */
export const resultAdjustCommandSchema = z
  .object({
    expectedWorkUpdatedAt: z.iso.datetime(),
    instruction: z.string().trim().min(1).max(2_000),
    scope: resultAdjustScopeSchema.optional(),
    source: resultAdjustSourceSchema,
    workId: resultObjectIdSchema,
  })
  .strict();

/**
 * Submit a prepared adjustment with a server-owned, already-confirmed quote.
 * Money, pricing policy, and execution-contract fields are never browser input.
 */
export const resultAdjustConfirmCommandSchema = z.union([
  z
    .object({
      billingQuoteId: resultObjectIdSchema,
      derivedWorkId: resultObjectIdSchema,
      source: resultAdjustLegacySourceSchema,
    })
    .strict(),
  z
    .object({
      billingQuoteId: resultObjectIdSchema,
      derivedTaskId: resultObjectIdSchema,
      derivedWorkId: resultObjectIdSchema,
      instruction: z.string().trim().min(1).max(2_000),
      scope: resultAdjustScopeSchema.optional(),
      source: resultAdjustContentPackageSourceSchema,
    })
    .strict(),
]);

export const resultExportCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    packageId: resultObjectIdSchema,
    platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
  })
  .strict();

export type ResultAdoptCommand = z.infer<typeof resultAdoptCommandSchema>;
export type ResultAdoptSelection = z.infer<typeof resultAdoptSelectionSchema>;
export type ResultAdjustCommand = z.infer<typeof resultAdjustCommandSchema>;
export type ResultAdjustConfirmCommand = z.infer<
  typeof resultAdjustConfirmCommandSchema
>;
export type ResultAdjustSource = z.infer<typeof resultAdjustSourceSchema>;
export type ResultExportCommand = z.infer<typeof resultExportCommandSchema>;

/**
 * Result Shell pure projection shape (D-085 / D-089).
 * Implementation lives under product/results; this freezes the cross-lane view.
 */
export type ResultShellModel = {
  target: ResultTarget;
  phase: ResultShellPhase;
  workspaceKind: ResultWorkspaceKind;
  primaryAction: ResultAction | null;
  secondaryActions: ResultAction[];
  overflowActions: ResultAction[];
  canonicalLinks: ResultCanonicalObjectLink[];
  panel: ResultPanel;
};

/** Label for readonly legacy ContentPackage archive branch (D-091 / D-098 C4). */
export const LEGACY_ARCHIVE_LABEL = '历史档案' as const;
export type LegacyArchiveLabel = typeof LEGACY_ARCHIVE_LABEL;

/**
 * ResultTargetResolver outcome (pure contract; no "guess latest Work").
 *
 * - ok: authorized lineage match
 * - legacy_readonly: pre-lineage ContentPackage → 历史档案 (no write path)
 * - lineage_mismatch: explicit target does not belong to work (recoverable)
 * - not_found: work / content missing
 * - forbidden: viewer lacks workspace membership / access
 */
export type ResultTargetResolveOutcome =
  | {
      kind: 'ok';
      target: ResultTarget;
      mode: 'active';
      workspaceId: string;
    }
  | {
      kind: 'legacy_readonly';
      /** contentId is the archive subject; workId may be absent. */
      contentId: string;
      archiveLabel: LegacyArchiveLabel;
      workspaceId: string;
      /** Optional version deep-link still validated against the package. */
      versionId?: string;
    }
  | {
      kind: 'lineage_mismatch';
      code: 'LINEAGE_MISMATCH';
      recoverable: true;
      message: string;
      requested: ResultTarget;
    }
  | {
      kind: 'not_found';
      code: 'NOT_FOUND';
      message: string;
      requested: ResultTarget;
    }
  | {
      kind: 'forbidden';
      code: 'FORBIDDEN';
      message: string;
      requested: ResultTarget;
    };

/** Canonical Result Center path for a workId (no collection index). */
export function resultCenterPath(workId: string): string {
  return `/dashboard/results/${encodeURIComponent(workId)}`;
}

/**
 * Build shareable Result Center search params from a target.
 * Stage never enters URL — only contentId / versionId / panel / focusKey.
 */
export function resultCenterSearchParams(
  target: Pick<ResultTarget, 'contentId' | 'versionId' | 'panel' | 'focusKey'>,
): Record<string, string> {
  const search: Record<string, string> = {};
  if (target.contentId) search.contentId = target.contentId;
  if (target.versionId) search.versionId = target.versionId;
  if (target.panel) search.panel = target.panel;
  if (target.focusKey) search.focusKey = target.focusKey;
  return search;
}
