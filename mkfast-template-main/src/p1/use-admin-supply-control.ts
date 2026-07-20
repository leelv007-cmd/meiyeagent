import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoutePolicyRevision } from '@meiye/contracts';

import type {
  GovernedActionTarget,
  GovernedQuickActionId,
} from '@/p1/admin-supply-quick-actions-model';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import {
  DEFAULT_RUN_TABLE_URL_STATE,
  type SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';

export const ADMIN_SUPPLY_CONTROL_QUERY = 'admin_supply_control';
export const ADMIN_SUPPLY_ACTION_PREVIEW_QUERY = 'admin_supply_action_preview';
export const ADMIN_SUPPLY_ACTION_COMMAND = 'admin_supply_action';

export type GovernedExecutionTarget = GovernedActionTarget & {
  operation?: string;
  qualityTier?: 'quality' | 'balanced' | 'auto';
  routePolicy?: RoutePolicyRevision;
  selectionId?: string;
};

export type GovernedActionDraft = {
  actionId: GovernedQuickActionId;
  candidate?: RoutePolicyRevision;
  reason: string;
  secureWriteReceiptId?: string;
  target: GovernedExecutionTarget;
};

export type CanonicalGovernedActionId =
  | 'connectivity_probe'
  | 'conformance_probe'
  | 'candidate_config_save'
  | 'candidate_config_validate'
  | 'route_simulate'
  | 'publish'
  | 'rollback'
  | 'isolate'
  | 'recover'
  | 'stop_new_tasks'
  | 'drain'
  | 'credential_pre_revoke'
  | 'credential_rotate'
  | 'health_refresh';

type GovernedActionRequest = {
  action: CanonicalGovernedActionId;
  expectedRevisionId: string | null;
  idempotencyKey: string;
  parameters?: Record<string, unknown>;
  reason: string;
  target: {
    resourceId: string;
    resourceType: GovernedExecutionTarget['resourceType'];
  };
};

export type GovernedActionPreview = {
  after: unknown | null;
  before: unknown | null;
  changes: string[];
  expectedRevisionId: string | null;
  id: string;
  reversible: boolean;
  routeDecision?: RouteDecisionExplanationView;
  scope: string;
  warnings: string[];
};

export type RouteDecisionExplanationView = {
  acceptanceBranch: {
    decision: string;
    fallbackDeploymentId?: string;
    primaryDeploymentId?: string;
    reason: string;
  };
  costEvidenceSource: Array<{
    amountMicros?: number;
    deploymentId: string;
    source: string | null;
  }>;
  dataProcessingLevel: {
    copy: string;
    dataClasses: string[];
    level: string;
    primaryDataClass: string;
    protectedChannel: boolean;
  };
  evidenceFreshness: Array<{
    criticalEvidence: Array<{
      kind: string;
      observedAt?: string;
      status: string;
    }>;
    deploymentId: string;
  }>;
  failClosed: boolean;
  failClosedReason: string | null;
  hardFilter: {
    excluded: Array<{
      deploymentId: string;
      reasons: string[];
    }>;
    passedDeploymentIds: string[];
  };
  liveExclusions: Array<{
    deploymentId: string;
    reasons: string[];
  }>;
  maxCost: {
    amountMicros: number;
    currency: string;
    evidenceSource: string | null;
  } | null;
  notSelectedReasons: Array<{
    deploymentId: string;
    reasons: string[];
  }>;
  sort: {
    layerOrder: readonly string[];
    ranked: Array<{
      band: string;
      deploymentId: string;
      rank: number;
    }>;
  };
  surface: 'simulator' | 'task_audit';
};

export type GovernedActionReview = {
  preview: GovernedActionPreview;
  request: GovernedActionRequest;
};

export type GovernedActionExecution = {
  reason: string;
  review: GovernedActionReview;
};

const CANONICAL_ACTION_IDS: Record<
  GovernedQuickActionId,
  CanonicalGovernedActionId
> = {
  candidate_config_validate: 'candidate_config_validate',
  candidate_config_save: 'candidate_config_save',
  channel_isolate: 'isolate',
  channel_recover: 'recover',
  conformance_probe: 'conformance_probe',
  connectivity_probe: 'connectivity_probe',
  credential_rotate: 'credential_rotate',
  drain: 'drain',
  health_balance_refresh: 'health_refresh',
  pre_revoke_impact_check: 'credential_pre_revoke',
  publish: 'publish',
  rollback: 'rollback',
  route_simulate: 'route_simulate',
  stop_new_tasks: 'stop_new_tasks',
};

const SECURE_WRITE_RECEIPT_ID =
  /^(?:secure-write-(?:receipt-[A-Za-z0-9._:-]{1,128}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|swr_[A-Za-z0-9._:-]{4,128}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function isSecureWriteReceiptId(value: string | undefined): boolean {
  return SECURE_WRITE_RECEIPT_ID.test(value?.trim() ?? '');
}

function actionParameters(
  draft: GovernedActionDraft
): Record<string, unknown> | undefined {
  switch (draft.actionId) {
    case 'connectivity_probe':
    case 'conformance_probe':
      if (
        draft.target.resourceType !== 'deployment' ||
        !draft.target.operation
      ) {
        throw new Error('Provider probe requires a deployment and operation.');
      }
      return {
        deploymentId: draft.target.resourceId,
        operation: draft.target.operation,
        probeKind:
          draft.actionId === 'conformance_probe'
            ? 'conformance'
            : 'connectivity',
      };
    case 'candidate_config_save':
      if (draft.target.resourceType !== 'route_policy' || !draft.candidate) {
        throw new Error('Candidate save requires a route-policy candidate.');
      }
      return { candidate: draft.candidate };
    case 'candidate_config_validate':
      if (draft.target.resourceType !== 'route_policy') {
        throw new Error(
          'Candidate validation requires a route-policy revision.'
        );
      }
      return {
        dataClass: [],
        failureScenario: 'success',
        operation: draft.target.operation,
        routePolicyRevisionId: draft.target.resourceId,
        selection: {
          fallbackConsent: true,
          mode: 'auto',
          profile: draft.target.qualityTier ?? 'quality',
        },
        unavailableDeploymentIds: [],
      };
    case 'route_simulate':
      return {
        dataClass: [],
        failureScenario: 'success',
        operation: draft.target.resourceId,
        selection: {
          fallbackConsent: true,
          mode: 'auto',
          profile: 'balanced',
        },
        unavailableDeploymentIds: [],
      };
    case 'credential_rotate': {
      if (!isSecureWriteReceiptId(draft.secureWriteReceiptId)) {
        throw new Error(
          'Credential rotation requires a secure-write receipt ID.'
        );
      }
      return { secureWriteReceiptId: draft.secureWriteReceiptId?.trim() };
    }
    default:
      return undefined;
  }
}

function prepareGovernedAction(
  draft: GovernedActionDraft
): GovernedActionRequest {
  const reason = draft.reason.trim();
  if (reason.length < 8) {
    throw new Error(
      'Governed action reason must contain at least 8 characters.'
    );
  }
  const parameters = actionParameters(draft);
  return {
    action: CANONICAL_ACTION_IDS[draft.actionId],
    expectedRevisionId: draft.target.expectedRevisionId ?? null,
    idempotencyKey: `${draft.actionId}:${draft.target.resourceId}:${crypto.randomUUID()}`,
    ...(parameters ? { parameters } : {}),
    reason,
    target: {
      resourceId: draft.target.resourceId,
      resourceType: draft.target.resourceType,
    },
  };
}

export async function previewGovernedSupplyAction(
  draft: GovernedActionDraft
): Promise<GovernedActionReview> {
  const request = prepareGovernedAction(draft);
  const preview = await queryP1<GovernedActionPreview>('model-supply', {
    action: ADMIN_SUPPLY_ACTION_PREVIEW_QUERY,
    payload: request,
  });
  return { preview, request };
}

export async function executeGovernedSupplyAction({
  reason,
  review,
}: GovernedActionExecution) {
  const payload = {
    ...review.request,
    approvedPreviewId: review.preview.id,
    reason: reason.trim(),
  };
  return commandP1<unknown>(
    'model-supply',
    { action: ADMIN_SUPPLY_ACTION_COMMAND, payload },
    review.request.idempotencyKey
  );
}

export function useAdminSupplyControlSnapshot(
  runQuery: SupplyRunTableUrlState = DEFAULT_RUN_TABLE_URL_STATE
) {
  const payload = { runQuery };
  return useQuery({
    queryKey: p1QueryKeys.request(
      'model-supply',
      ADMIN_SUPPLY_CONTROL_QUERY,
      payload
    ),
    queryFn: ({ signal }) =>
      queryP1<SupplyControlSnapshot>(
        'model-supply',
        { action: ADMIN_SUPPLY_CONTROL_QUERY, payload },
        signal
      ),
  });
}

export function useGovernedSupplyActionPreview() {
  return useMutation({ mutationFn: previewGovernedSupplyAction });
}

export function useGovernedSupplyAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: executeGovernedSupplyAction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: p1QueryKeys.module('model-supply'),
        }),
        queryClient.invalidateQueries({
          queryKey: p1QueryKeys.module('integrations'),
        }),
      ]);
    },
  });
}
