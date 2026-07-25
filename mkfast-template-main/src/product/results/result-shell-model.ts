/**
 * ResultShellModel pure projection (WT-D1 / #99, D-085 / D-089).
 *
 * Composes existing sub-projections:
 * - harnessCandidateResultModel (candidate adopt state)
 * - harnessCopyStreamPhase (ADR-0007 stream phase)
 * - delivery capability (platform mode)
 *
 * ContentPackageResults (post-publish outcome signals) is intentionally NOT
 * remapped into this shell — it stays a separate attribution surface.
 *
 * Projection only: no Result table / status entity / second history.
 */

import type {
  ResultAction,
  ResultActionId,
  ResultCanonicalObjectLink,
  ResultPanel,
  ResultShellModel,
  ResultShellPhase,
  ResultTarget,
  ResultTargetResolveOutcome,
  ResultWorkspaceKind,
} from '@meiye/contracts';
import { resultPanels } from '@meiye/contracts';

import {
  harnessCandidateResultModel,
  harnessCopyStreamPhase,
} from '@/product/workbench-state-model';

// ---------------------------------------------------------------------------
// Inputs (canonical facts the shell reads — not a new store)
// ---------------------------------------------------------------------------

export type ResultShellProgressState =
  | 'waiting'
  | 'running'
  | 'suspended'
  | 'success'
  | 'failed';

export type ResultShellDeliveryCapability = {
  mode: 'automatic_verified' | 'assisted' | 'unavailable';
  platform?: string;
  reason?: string;
};

export type ResultShellDeliveryAttemptState =
  | 'none'
  | 'awaiting_approval'
  | 'delivering'
  | 'partial'
  | 'failed'
  | 'delivered';

export type ResultShellHarnessPackage = Parameters<
  typeof harnessCandidateResultModel
>[0];

/**
 * Canonical facts assembled by the page / query layer.
 * Shell never invents workIds or falls back to "latest".
 */
export type ResultShellFacts = {
  target: ResultTarget;
  workspaceKind: ResultWorkspaceKind;
  /** Task/Job progress (running lane). */
  progressState?: ResultShellProgressState;
  /** acceptance_unknown forces recover path over adopt/regenerate. */
  acceptanceUnknown?: boolean;
  /** Media / rights choice pending merchant input. */
  needsUserChoice?: boolean;
  /** Whether at least one usable candidate exists and is not yet adopted. */
  hasUsableCandidate?: boolean;
  /** Whether a candidate has been adopted into ContentPackage. */
  hasAdoptedCandidate?: boolean;
  /** Whether the adopted package has a concrete platform variant to deliver. */
  hasDeliverableVariant?: boolean;
  /** Delivery attempt projection (not a second Result status). */
  deliveryAttempt?: ResultShellDeliveryAttemptState;
  /** Delivery capability sub-projection (D-086). */
  deliveryCapability?: ResultShellDeliveryCapability;
  /** Optional harness package for candidate sub-projection. */
  harnessPackage?: ResultShellHarnessPackage;
  /** Task / content / version ids for canonical links. */
  taskId?: string;
  jobId?: string;
  contentRevisionId?: string;
  /** Token stream first-token flag (copy / image_text running). */
  hasFirstToken?: boolean;
  /** Preferred panel from URL (validated against resultPanels). */
  requestedPanel?: ResultPanel;
};

export type ResultShellView =
  | {
      kind: 'ready';
      shell: ResultShellModel;
      /** Sub-projections composed into the shell (not parallel stores). */
      sub: {
        streamPhase: 'awaiting_confirmation' | 'drafting' | null;
        hasFirstToken: boolean;
        candidates: ReturnType<typeof harnessCandidateResultModel>;
        deliveryCapability: ResultShellDeliveryCapability | null;
        a11yAnnouncement: string;
      };
    }
  | {
      kind: 'error';
      code: 'NOT_FOUND' | 'FORBIDDEN' | 'LINEAGE_MISMATCH' | 'LEGACY_READONLY';
      recoverable: boolean;
      message: string;
      requested: ResultTarget;
      /** Legacy archive branch — open ContentPackage detail, not Result Center write path. */
      archiveLabel?: string;
      contentId?: string;
    };

// ---------------------------------------------------------------------------
// Phase projection (priority table from result-workspace-action-contract §4)
// ---------------------------------------------------------------------------

/**
 * Project high-level ResultShellPhase from canonical predicates.
 * Hits upper rows first; completed must not override delivery/running failures.
 */
export function projectResultShellPhase(
  facts: ResultShellFacts
): ResultShellPhase {
  const delivery = facts.deliveryAttempt ?? 'none';

  if (
    delivery === 'awaiting_approval' ||
    delivery === 'delivering' ||
    delivery === 'partial' ||
    delivery === 'failed'
  ) {
    // Delivery in-flight / partial / failed still surfaces as ready shell
    // with delivery-oriented primary action (needs_input for approval/partial).
    if (delivery === 'awaiting_approval' || delivery === 'partial') {
      return 'needs_input';
    }
    if (delivery === 'failed') return 'failed';
    // delivering → still "running" from the merchant's progress POV
    return 'running';
  }

  if (delivery === 'delivered') return 'delivered';

  if (facts.acceptanceUnknown) return 'needs_input';
  if (facts.needsUserChoice) return 'needs_input';

  if (facts.progressState === 'failed') return 'failed';
  if (
    facts.progressState === 'running' ||
    facts.progressState === 'waiting' ||
    facts.progressState === 'suspended'
  ) {
    return 'running';
  }

  // success / undefined with candidates or adopted → ready
  return 'ready';
}

// ---------------------------------------------------------------------------
// Action matrix
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<ResultActionId, string> = {
  leave_and_continue: '离开并后台继续',
  handle_current_issue: '处理当前问题',
  adopt_candidate: '采用此版本',
  continue_adjust: '继续调整',
  deliver: '交付',
  retry: '重试',
  recover_or_verify: '恢复或核验',
  create_from_this: '基于此再创作',
  cancel_run: '取消',
  open_history: '版本与历史',
  open_run_detail: '运行详情',
  open_more: '更多',
};

function action(
  id: ResultActionId,
  role: ResultAction['role'],
  enabled = true,
  labelOverride?: string
): ResultAction {
  return {
    id,
    role,
    label: labelOverride ?? ACTION_LABELS[id],
    enabled,
  };
}

function adoptLabel(workspaceKind: ResultWorkspaceKind): string {
  switch (workspaceKind) {
    case 'copy':
      return '采用此版本';
    case 'image':
      return '采用这组';
    case 'video':
      return '使用此成片';
  }
}

/**
 * Phase → primary / secondary / overflow action matrix (desktop budget:
 * 1 primary + ≤3 secondary; rest overflow). Mobile collapses secondary to more.
 */
export function projectResultShellActions(
  phase: ResultShellPhase,
  facts: ResultShellFacts
): Pick<
  ResultShellModel,
  'primaryAction' | 'secondaryActions' | 'overflowActions'
> {
  const delivery = facts.deliveryAttempt ?? 'none';
  // P1-B1 / #150: History + Run Detail are real panels (not empty no-ops).
  // Keep them in overflow so they never steal the single primary action.
  const historyAndRun: ResultAction[] = [
    action('open_history', 'overflow'),
    action('open_run_detail', 'overflow'),
  ];

  if (facts.acceptanceUnknown) {
    return {
      primaryAction: action('recover_or_verify', 'primary'),
      secondaryActions: [action('leave_and_continue', 'secondary')],
      overflowActions: historyAndRun,
    };
  }

  if (delivery === 'awaiting_approval') {
    return {
      primaryAction: action(
        'handle_current_issue',
        'primary',
        true,
        '查看并批准'
      ),
      secondaryActions: [action('leave_and_continue', 'secondary')],
      overflowActions: historyAndRun,
    };
  }

  if (delivery === 'partial') {
    return {
      primaryAction: action(
        'handle_current_issue',
        'primary',
        true,
        '处理未完成交付'
      ),
      secondaryActions: [action('continue_adjust', 'secondary')],
      overflowActions: historyAndRun,
    };
  }

  if (delivery === 'failed') {
    return {
      primaryAction: action('retry', 'primary', true, '重试交付'),
      secondaryActions: [action('continue_adjust', 'secondary')],
      overflowActions: historyAndRun,
    };
  }

  if (delivery === 'delivering') {
    return {
      primaryAction: action('leave_and_continue', 'primary'),
      secondaryActions: [],
      overflowActions: [action('cancel_run', 'overflow'), ...historyAndRun],
    };
  }

  switch (phase) {
    case 'running': {
      const primary =
        facts.progressState === 'suspended'
          ? action('handle_current_issue', 'primary')
          : action('leave_and_continue', 'primary');
      return {
        primaryAction: primary,
        secondaryActions: [],
        overflowActions: [
          action('cancel_run', 'overflow'),
          // Run detail is the useful diagnostic while generating; history
          // still available when revisions already exist for this work.
          ...historyAndRun,
        ],
      };
    }
    case 'needs_input':
      return {
        primaryAction: action('handle_current_issue', 'primary'),
        secondaryActions: [action('leave_and_continue', 'secondary')],
        overflowActions: historyAndRun,
      };
    case 'failed':
      return {
        primaryAction: action('retry', 'primary'),
        secondaryActions: [action('continue_adjust', 'secondary')],
        overflowActions: historyAndRun,
      };
    case 'delivered':
      return {
        primaryAction: action('create_from_this', 'primary'),
        secondaryActions: [action('continue_adjust', 'secondary')],
        overflowActions: historyAndRun,
      };
    case 'ready': {
      if (facts.hasUsableCandidate && !facts.hasAdoptedCandidate) {
        return {
          primaryAction: action(
            'adopt_candidate',
            'primary',
            true,
            adoptLabel(facts.workspaceKind)
          ),
          secondaryActions: [action('continue_adjust', 'secondary')],
          overflowActions: historyAndRun,
        };
      }
      if (
        facts.hasAdoptedCandidate &&
        facts.hasDeliverableVariant &&
        delivery === 'none'
      ) {
        return {
          primaryAction: action('deliver', 'primary'),
          secondaryActions: [
            action('continue_adjust', 'secondary'),
            action('create_from_this', 'secondary'),
          ],
          overflowActions: historyAndRun,
        };
      }
      return {
        primaryAction: action('continue_adjust', 'primary'),
        secondaryActions: [action('create_from_this', 'secondary')],
        overflowActions: historyAndRun,
      };
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function projectCanonicalLinks(
  facts: ResultShellFacts
): ResultCanonicalObjectLink[] {
  const links: ResultCanonicalObjectLink[] = [
    { kind: 'work', id: facts.target.workId },
  ];
  if (facts.target.contentId) {
    links.push({ kind: 'content', id: facts.target.contentId });
  }
  if (facts.target.versionId) {
    links.push({ kind: 'version', id: facts.target.versionId });
  } else if (facts.contentRevisionId) {
    links.push({ kind: 'version', id: facts.contentRevisionId });
  }
  if (facts.taskId) links.push({ kind: 'task', id: facts.taskId });
  if (facts.jobId) links.push({ kind: 'job', id: facts.jobId });
  return links;
}

function resolvePanel(
  facts: ResultShellFacts,
  phase: ResultShellPhase
): ResultPanel {
  if (
    facts.requestedPanel &&
    (resultPanels as readonly string[]).includes(facts.requestedPanel)
  ) {
    return facts.requestedPanel;
  }
  if (phase === 'running') return 'run';
  if (
    facts.deliveryAttempt === 'awaiting_approval' ||
    facts.deliveryAttempt === 'delivering' ||
    facts.deliveryAttempt === 'partial' ||
    facts.deliveryAttempt === 'failed'
  ) {
    return 'delivery';
  }
  return 'result';
}

function a11yAnnouncementFor(
  phase: ResultShellPhase,
  facts: ResultShellFacts,
  hasFirstToken: boolean
): string {
  // Stage announcements only in the aggregate a11y layer — never replace
  // token-stream rendering for copy/image_text.
  switch (phase) {
    case 'running':
      if (
        (facts.workspaceKind === 'copy' || facts.workspaceKind === 'image') &&
        hasFirstToken
      ) {
        return '正在生成内容';
      }
      if (facts.progressState === 'suspended') {
        return '等待确认';
      }
      return '任务进行中';
    case 'needs_input':
      return facts.acceptanceUnknown ? '需要恢复或核验' : '需要处理当前问题';
    case 'ready':
      return '结果可用';
    case 'failed':
      return '任务失败';
    case 'delivered':
      return '已交付';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/**
 * Project a full ResultShellModel from canonical facts.
 * Pure — no I/O, no mutation, no latest-result fallback.
 */
export function projectResultShellModel(
  facts: ResultShellFacts
): ResultShellModel {
  const phase = projectResultShellPhase(facts);
  const actions = projectResultShellActions(phase, facts);
  return {
    target: {
      workId: facts.target.workId,
      ...(facts.target.contentId ? { contentId: facts.target.contentId } : {}),
      ...(facts.target.versionId ? { versionId: facts.target.versionId } : {}),
      ...(facts.target.panel ? { panel: facts.target.panel } : {}),
      ...(facts.target.focusKey ? { focusKey: facts.target.focusKey } : {}),
    },
    phase,
    workspaceKind: facts.workspaceKind,
    primaryAction: actions.primaryAction,
    secondaryActions: actions.secondaryActions,
    overflowActions: actions.overflowActions,
    canonicalLinks: projectCanonicalLinks(facts),
    panel: resolvePanel(facts, phase),
  };
}

/**
 * Full shell view including composed sub-projections and a11y aggregate.
 */
export function projectResultShellView(
  facts: ResultShellFacts
): ResultShellView {
  const shell = projectResultShellModel(facts);
  const candidates = facts.harnessPackage
    ? harnessCandidateResultModel(facts.harnessPackage)
    : null;
  // Stream phase follows progressState for copy/image workspaces even when the
  // high-level shell phase is needs_input (suspended awaiting confirmation).
  const streamActive =
    facts.workspaceKind === 'copy' || facts.workspaceKind === 'image';
  const streamPhase = streamActive
    ? harnessCopyStreamPhase(facts.progressState)
    : null;
  const hasFirstToken = Boolean(facts.hasFirstToken);

  return {
    kind: 'ready',
    shell,
    sub: {
      streamPhase,
      hasFirstToken,
      candidates,
      deliveryCapability: facts.deliveryCapability ?? null,
      a11yAnnouncement: a11yAnnouncementFor(shell.phase, facts, hasFirstToken),
    },
  };
}

/**
 * Map a ResultTargetResolveOutcome into a shell view.
 * Invalid targets never fall back to latest result.
 */
export function shellViewFromResolveOutcome(
  outcome: ResultTargetResolveOutcome,
  factsWhenOk: Omit<ResultShellFacts, 'target'> & { target?: ResultTarget }
): ResultShellView {
  switch (outcome.kind) {
    case 'ok':
      return projectResultShellView({
        ...factsWhenOk,
        target: outcome.target,
      });
    case 'legacy_readonly':
      return {
        kind: 'error',
        code: 'LEGACY_READONLY',
        recoverable: false,
        message: '该内容为历史档案，请在内容详情中查看。',
        requested: {
          workId: factsWhenOk.target?.workId ?? '',
          contentId: outcome.contentId,
          ...(outcome.versionId ? { versionId: outcome.versionId } : {}),
        },
        archiveLabel: outcome.archiveLabel,
        contentId: outcome.contentId,
      };
    case 'lineage_mismatch':
      return {
        kind: 'error',
        code: 'LINEAGE_MISMATCH',
        recoverable: true,
        message: outcome.message,
        requested: outcome.requested,
      };
    case 'not_found':
      return {
        kind: 'error',
        code: 'NOT_FOUND',
        recoverable: false,
        message: outcome.message,
        requested: outcome.requested,
      };
    case 'forbidden':
      return {
        kind: 'error',
        code: 'FORBIDDEN',
        recoverable: false,
        message: outcome.message,
        requested: outcome.requested,
      };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** Static marker: shell is a projection, not a Result entity store. */
export const RESULT_SHELL_PROJECTION_ONLY = true as const;

/** Action budget helpers for desktop / mobile chrome. */
export function desktopVisibleActions(shell: ResultShellModel): {
  primary: ResultAction | null;
  secondary: ResultAction[];
  more: ResultAction[];
} {
  return {
    primary: shell.primaryAction,
    secondary: shell.secondaryActions.slice(0, 3),
    more: [...shell.secondaryActions.slice(3), ...shell.overflowActions],
  };
}

export function mobileVisibleActions(shell: ResultShellModel): {
  primary: ResultAction | null;
  more: ResultAction[];
} {
  return {
    primary: shell.primaryAction,
    more: [...shell.secondaryActions, ...shell.overflowActions],
  };
}
