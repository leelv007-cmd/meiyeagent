/**
 * Governed quick actions panel (J5 / D-070 ③).
 * Lists the full action set with permission / preview / CAS flags.
 * Execution goes through ImpactReviewDialog + Core typed commands (no secrets).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  getGovernedQuickAction,
  type GovernedActionsPanelView,
  type GovernedQuickActionId,
} from '@/p1/admin-supply-quick-actions-model';
import {
  projectLiveRouteDecision,
  type LiveRouteSimulatorState,
} from '@/p1/admin-supply-route-simulator-model';
import {
  clearCredentialRotationHandoff,
  consumeCredentialRotationHandoff,
  isTerminalRotationReceiptError,
  peekCredentialRotationHandoff,
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
} from '@/p1/provider-credential-rotation-handoff';
import {
  isSecureWriteReceiptId,
  type GovernedActionDraft,
  type GovernedActionExecution,
  type GovernedActionReview,
  type GovernedExecutionTarget,
} from '@/p1/use-admin-supply-control';
import {
  admin_supply_acceptance_state_b5835164,
  admin_supply_action_d9d98278,
  admin_supply_action_executing,
  admin_supply_action_failed,
  admin_supply_action_success,
  admin_supply_all_via_core_typed_commands_capability_p_13b9729e,
  admin_supply_audit_reason_of_at_least_8_characters_49450638,
  admin_supply_candidate_deployment_ids_bc4efa40,
  admin_supply_candidate_revision_id_e2433ed4,
  admin_supply_cas_idempotency_4f4772a6,
  admin_supply_confirm_label,
  admin_supply_constraint,
  admin_supply_cost_evidence_source_3c7deb8c,
  admin_supply_credential_rotate_receipt_does_not_match_ef599ff8,
  admin_supply_credential_rotate_receipt_expired_restag_b8643321,
  admin_supply_credential_rotate_receipt_is_no_longer_a_b9f0f544,
  admin_supply_credential_rotate_safe_write_receipt_bcb2778d,
  admin_supply_data_processing_level_6bb64a54,
  admin_supply_data_processing_protected,
  admin_supply_enter_at_least_one_deployment_id_930a0781,
  admin_supply_enter_candidate_revision_id_120b8caa,
  admin_supply_enter_safe_write_receipt_id_do_not_paste_3f97452c,
  admin_supply_evidence_freshness_bfc825d0,
  admin_supply_governed_quick_actions_2029dea2,
  admin_supply_hard_filter_ec352341,
  admin_supply_hard_filter_passed_excluded,
  admin_supply_impact_preview_loading,
  admin_supply_irreversible_0235ca64,
  admin_supply_label_reason,
  admin_supply_label_target,
  admin_supply_live_exclusion_6818702d,
  admin_supply_max_cost_3c9b4905,
  admin_supply_no_8bf5c10a,
  admin_supply_no_blind_retry_of_accepted_unknown_5ca78898,
  admin_supply_no_candidates_74869b6e,
  admin_supply_no_direct_db_writes_65c80a14,
  admin_supply_no_evidence_878c6b14,
  admin_supply_no_publish_gate_bypass_69d56aff,
  admin_supply_no_secret_echo_1d752c89,
  admin_supply_none_72077749,
  admin_supply_not_selected_reason_16e93687,
  admin_supply_permission_560165a6,
  admin_supply_preview_de61aa8e,
  admin_supply_preview_failed,
  admin_supply_preview_from_core,
  admin_supply_reason_1ff9c3d0,
  admin_supply_reason_and_execute_287aa02e,
  admin_supply_receipt_prefilled_from_integrations_page_1d9e8a84,
  admin_supply_reversibility,
  admin_supply_reversible_16954c95,
  admin_supply_reversible_drain_a1d54996,
  admin_supply_safe_write_receipt_id_e64c3440,
  admin_supply_select_target_bd2f8146,
  admin_supply_target_941f0831,
  admin_supply_three_layer_sort_0bd6ffd5,
  admin_supply_unknown_d9c32a4c,
  admin_supply_unknown_error_5f76edc5,
  admin_supply_view_audit_0cdc970f,
  admin_supply_yes_30160a21,
} from '@/locale/paraglide/messages';

type ActionOutcome = {
  actionId: GovernedQuickActionId;
  details?: Array<{ label: string; value: string }>;
  message: string;
  status: 'pending' | 'succeeded' | 'failed';
};

/**
 * Outcome words come from the execution result, so the tone is mapped on the
 * word rather than picked at the call site. Only failure earns a colour;
 * pending and success stay on the neutral panel surface.
 */
const OUTCOME_TONE: Record<ActionOutcome['status'], string> = {
  pending: '',
  succeeded: '',
  failed: 'border-destructive/40 text-destructive',
};

function outcomeTone(status: ActionOutcome['status']): string {
  return OUTCOME_TONE[status] ?? '';
}

type GovernedActionFormValues = {
  candidateDeploymentIds?: string;
  candidateRevisionId?: string;
  reason: string;
  secureWriteReceiptId?: string;
  targetId: string;
};

function governedActionFormSchema(actionId: GovernedQuickActionId) {
  return z
    .object({
      reason: z.string().trim().min(8),
      candidateDeploymentIds: z.string().optional(),
      candidateRevisionId: z.string().optional(),
      secureWriteReceiptId: z.string().optional(),
      targetId: z.string().min(1),
    })
    .superRefine((value, context) => {
      if (actionId === 'candidate_config_save') {
        if (!value.candidateRevisionId?.trim()) {
          context.addIssue({
            code: 'custom',
            message: admin_supply_enter_candidate_revision_id_120b8caa(),
            path: ['candidateRevisionId'],
          });
        }
        if (
          !value.candidateDeploymentIds
            ?.split(',')
            .some((deploymentId) => deploymentId.trim())
        ) {
          context.addIssue({
            code: 'custom',
            message: admin_supply_enter_at_least_one_deployment_id_930a0781(),
            path: ['candidateDeploymentIds'],
          });
        }
      }
      if (
        actionId === 'credential_rotate' &&
        !isSecureWriteReceiptId(value.secureWriteReceiptId)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            admin_supply_enter_safe_write_receipt_id_do_not_paste_3f97452c(),
          path: ['secureWriteReceiptId'],
        });
      }
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function projectRouteDecision(
  value: unknown
): Array<{ label: string; value: string }> | undefined {
  const explanation = asRecord(value);
  if (!explanation) return undefined;
  const acceptance = asRecord(explanation.acceptanceBranch);
  const hardFilter = asRecord(explanation.hardFilter);
  const sort = asRecord(explanation.sort);
  const maxCost = asRecord(explanation.maxCost);
  const dataProcessing = asRecord(explanation.dataProcessingLevel);

  const stringList = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === 'string')
      : [];
  const records = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.flatMap((item) => {
          const record = asRecord(item);
          return record ? [record] : [];
        })
      : [];
  const exclusions = (candidate: unknown) =>
    records(candidate)
      .map((item) => {
        const deploymentId =
          typeof item.deploymentId === 'string' ? item.deploymentId : 'unknown';
        const reasons = stringList(item.reasons);
        return `${deploymentId}${reasons.length ? `（${reasons.join('、')}）` : ''}`;
      })
      .join('；');
  const ranked = records(sort?.ranked)
    .map((item) => {
      const deploymentId =
        typeof item.deploymentId === 'string' ? item.deploymentId : 'unknown';
      const rank = typeof item.rank === 'number' ? `#${item.rank}` : '';
      const band = typeof item.band === 'string' ? item.band : '';
      return `${rank} ${deploymentId}${band ? `（${band}）` : ''}`.trim();
    })
    .join('；');
  const freshness = records(explanation.evidenceFreshness)
    .map((item) => {
      const deploymentId =
        typeof item.deploymentId === 'string' ? item.deploymentId : 'unknown';
      const facts = records(item.criticalEvidence)
        .map((fact) =>
          typeof fact.kind === 'string' && typeof fact.status === 'string'
            ? `${fact.kind}:${fact.status}`
            : ''
        )
        .filter(Boolean)
        .join('、');
      return `${deploymentId}${facts ? `（${facts}）` : ''}`;
    })
    .join('；');
  const costEvidence = records(explanation.costEvidenceSource)
    .map((item) => {
      const deploymentId =
        typeof item.deploymentId === 'string' ? item.deploymentId : 'unknown';
      const source = typeof item.source === 'string' ? item.source : 'unknown';
      return `${deploymentId}:${source}`;
    })
    .join('；');

  return [
    {
      label: admin_supply_hard_filter_ec352341(),
      value: admin_supply_hard_filter_passed_excluded({
        passed:
          stringList(hardFilter?.passedDeploymentIds).join('、') ||
          admin_supply_none_72077749(),
        excluded:
          exclusions(hardFilter?.excluded) || admin_supply_none_72077749(),
      }),
    },
    {
      label: admin_supply_three_layer_sort_0bd6ffd5(),
      value: `${stringList(sort?.layerOrder).join(' → ') || admin_supply_none_72077749()}；${ranked || admin_supply_no_candidates_74869b6e()}`,
    },
    {
      label: admin_supply_live_exclusion_6818702d(),
      value:
        exclusions(explanation.liveExclusions) || admin_supply_none_72077749(),
    },
    {
      label: admin_supply_max_cost_3c9b4905(),
      value:
        typeof maxCost?.amountMicros === 'number' &&
        typeof maxCost.currency === 'string'
          ? `${maxCost.amountMicros} μ${maxCost.currency}（${String(maxCost.evidenceSource ?? 'unknown')}）`
          : admin_supply_unknown_d9c32a4c(),
    },
    {
      label: admin_supply_acceptance_state_b5835164(),
      value: `${String(acceptance?.decision ?? 'unknown')}（${String(acceptance?.reason ?? 'unknown')}）`,
    },
    {
      label: admin_supply_not_selected_reason_16e93687(),
      value:
        exclusions(explanation.notSelectedReasons) ||
        admin_supply_none_72077749(),
    },
    {
      label: admin_supply_evidence_freshness_bfc825d0(),
      value: freshness || admin_supply_no_evidence_878c6b14(),
    },
    {
      label: admin_supply_cost_evidence_source_3c7deb8c(),
      value: costEvidence || admin_supply_unknown_d9c32a4c(),
    },
    {
      label: admin_supply_data_processing_level_6bb64a54(),
      value:
        typeof dataProcessing?.copy === 'string'
          ? dataProcessing.copy
          : admin_supply_data_processing_protected({
              level: String(dataProcessing?.level ?? 'unknown'),
              protected:
                dataProcessing?.protectedChannel === true
                  ? admin_supply_yes_30160a21()
                  : admin_supply_no_8bf5c10a(),
            }),
    },
    {
      label: 'Fail closed',
      value:
        explanation.failClosed === true
          ? String(explanation.failClosedReason ?? admin_supply_yes_30160a21())
          : admin_supply_no_8bf5c10a(),
    },
  ];
}

function projectActionResult(
  value: unknown
): Array<{ label: string; value: string }> | undefined {
  const result = asRecord(value);
  const routeDecision = asRecord(result?.routeDecision);
  return projectRouteDecision(routeDecision?.simulator);
}

function rotationHandoffPrefill(
  targets: GovernedExecutionTarget[]
): Pick<GovernedActionFormValues, 'secureWriteReceiptId' | 'targetId'> {
  const staged = peekCredentialRotationHandoff();
  if (!staged) {
    return { secureWriteReceiptId: '', targetId: '' };
  }
  // Bind against the platform workspace before prefill. Mismatch/expiry clear.
  const bound = consumeCredentialRotationHandoff(
    {
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: staged.accountId,
    },
    { clearOnReady: false }
  );
  if (bound.status !== 'ready') {
    return { secureWriteReceiptId: '', targetId: '' };
  }
  const targetPresent = targets.some(
    (target) =>
      (target.selectionId ?? target.resourceId) === bound.record.accountId
  );
  return {
    secureWriteReceiptId: bound.record.receiptId,
    targetId: targetPresent ? bound.record.accountId : '',
  };
}

function GovernedActionFormCells({
  actionId,
  label,
  targets,
  disabled,
  onSubmit,
}: {
  actionId: GovernedQuickActionId;
  label: string;
  targets: GovernedExecutionTarget[];
  disabled: boolean;
  onSubmit: (values: GovernedActionFormValues) => Promise<void>;
}) {
  const handoffDefaults =
    actionId === 'credential_rotate'
      ? rotationHandoffPrefill(targets)
      : { secureWriteReceiptId: '', targetId: '' };
  const form = useForm<GovernedActionFormValues>({
    defaultValues: {
      candidateDeploymentIds: '',
      candidateRevisionId: '',
      reason: '',
      secureWriteReceiptId: handoffDefaults.secureWriteReceiptId,
      targetId: handoffDefaults.targetId,
    },
    mode: 'onChange',
    resolver: zodResolver(governedActionFormSchema(actionId)),
  });
  const receipt = useWatch({
    control: form.control,
    name: 'secureWriteReceiptId',
  });
  const handoffPrefillActive =
    actionId === 'credential_rotate' &&
    Boolean(handoffDefaults.secureWriteReceiptId);

  return (
    <>
      <TableCell>
        <Controller
          control={form.control}
          name="targetId"
          render={({ field }) => (
            <Select
              onValueChange={(value) => field.onChange(value ?? '')}
              value={field.value || undefined}
            >
              <SelectTrigger
                aria-label={admin_supply_label_target({ label })}
                className="h-9 min-w-48 data-size:h-9"
              >
                <SelectValue
                  placeholder={admin_supply_select_target_bd2f8146()}
                />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => {
                  const id = target.selectionId ?? target.resourceId;
                  return (
                    <SelectItem key={id} value={id}>
                      {target.label ?? target.resourceId}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        />
        {actionId === 'credential_rotate' ? (
          <div>
            <input
              aria-label={admin_supply_credential_rotate_safe_write_receipt_bcb2778d()}
              autoComplete="off"
              className="mt-2 h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
              data-handoff-prefill={String(handoffPrefillActive)}
              data-testid="supply-credential-rotate-receipt"
              placeholder={admin_supply_safe_write_receipt_id_e64c3440()}
              type="text"
              {...form.register('secureWriteReceiptId')}
            />
            {handoffPrefillActive ? (
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="supply-credential-rotate-handoff-hint"
              >
                {admin_supply_receipt_prefilled_from_integrations_page_1d9e8a84()}
              </p>
            ) : null}
            {receipt && form.formState.errors.secureWriteReceiptId ? (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.secureWriteReceiptId.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {actionId === 'candidate_config_save' ? (
          <div>
            <input
              aria-label={admin_supply_candidate_revision_id_e2433ed4()}
              className="mt-2 h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
              placeholder="route-policy:rN"
              type="text"
              {...form.register('candidateRevisionId')}
            />
            <input
              aria-label={admin_supply_candidate_deployment_ids_bc4efa40()}
              className="mt-2 h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
              placeholder="deployment-a, deployment-b"
              type="text"
              {...form.register('candidateDeploymentIds')}
            />
          </div>
        ) : null}
      </TableCell>
      <TableCell>
        <input
          aria-label={admin_supply_label_reason({ label })}
          className="mb-2 h-9 min-w-56 rounded-md border bg-background px-2 text-xs"
          placeholder={admin_supply_audit_reason_of_at_least_8_characters_49450638()}
          type="text"
          {...form.register('reason')}
        />
        <Button
          aria-label={label}
          disabled={disabled || !form.formState.isValid}
          onClick={() => void form.handleSubmit(onSubmit)()}
          size="sm"
          type="button"
          variant="outline"
        >
          {label}
        </Button>
      </TableCell>
    </>
  );
}

function publishRouteSimulatorUpdate(
  actionId: GovernedQuickActionId,
  payload: unknown,
  onRouteSimulatorUpdate?: (state: LiveRouteSimulatorState) => void
) {
  if (actionId !== 'route_simulate' || !onRouteSimulatorUpdate) return;
  const panel = projectLiveRouteDecision(payload);
  if (panel) {
    onRouteSimulatorUpdate({ status: 'ready', view: panel });
  }
}

function publishRouteSimulatorError(
  actionId: GovernedQuickActionId,
  message: string,
  onRouteSimulatorUpdate?: (state: LiveRouteSimulatorState) => void
) {
  if (actionId !== 'route_simulate' || !onRouteSimulatorUpdate) return;
  onRouteSimulatorUpdate({ status: 'error', message });
}

export function SupplyGovernedActionsPanel({
  view,
  targets,
  onPreview,
  onExecute,
  onRouteSimulatorUpdate,
}: {
  view: GovernedActionsPanelView;
  targets: Partial<Record<GovernedQuickActionId, GovernedExecutionTarget[]>>;
  onPreview?: (input: GovernedActionDraft) => Promise<GovernedActionReview>;
  onExecute?: (input: GovernedActionExecution) => Promise<unknown>;
  /** F-J-02: lift Core route_simulate projections into the simulator panel. */
  onRouteSimulatorUpdate?: (state: LiveRouteSimulatorState) => void;
}) {
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const [outcome, setOutcome] = useState<ActionOutcome>();

  const reviewAction = async (
    actionId: GovernedQuickActionId,
    values: GovernedActionFormValues
  ) => {
    const definition = getGovernedQuickAction(actionId);
    const target = targets[actionId]?.find(
      (candidate) =>
        (candidate.selectionId ?? candidate.resourceId) === values.targetId
    );
    const reason = values.reason.trim();
    if (!target || !onPreview || !onExecute) {
      return;
    }
    const secureWriteReceiptId = values.secureWriteReceiptId?.trim();
    if (
      actionId === 'credential_rotate' &&
      !isSecureWriteReceiptId(secureWriteReceiptId)
    ) {
      return;
    }
    if (actionId === 'credential_rotate' && secureWriteReceiptId) {
      // Re-bind to current platform workspace + selected account before Core.
      // Mismatch / expiry / missing handoff for this receipt clears memory when
      // the field still holds the staged receipt id.
      const staged = peekCredentialRotationHandoff();
      if (staged && staged.receiptId === secureWriteReceiptId) {
        const bound = consumeCredentialRotationHandoff(
          {
            workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
            accountId: target.resourceId,
          },
          { clearOnReady: false }
        );
        if (bound.status !== 'ready') {
          setOutcome({
            actionId,
            message:
              bound.status === 'expired'
                ? admin_supply_credential_rotate_receipt_expired_restag_b8643321()
                : bound.status === 'account_mismatch' ||
                    bound.status === 'workspace_mismatch'
                  ? admin_supply_credential_rotate_receipt_does_not_match_ef599ff8()
                  : admin_supply_credential_rotate_receipt_is_no_longer_a_b9f0f544(),
            status: 'failed',
          });
          return;
        }
      }
    }
    setOutcome({
      actionId,
      message: admin_supply_impact_preview_loading({ label: definition.label }),
      status: 'pending',
    });
    try {
      const candidate =
        actionId === 'candidate_config_save' && target.routePolicy
          ? (() => {
              const { publishedAt: _publishedAt, ...base } = target.routePolicy;
              return {
                ...base,
                candidateDeploymentIds: (values.candidateDeploymentIds ?? '')
                  .split(',')
                  .map((deploymentId) => deploymentId.trim())
                  .filter(Boolean),
                revisionId: values.candidateRevisionId?.trim() ?? '',
              };
            })()
          : undefined;
      const review = await onPreview({
        actionId,
        ...(candidate ? { candidate } : {}),
        reason,
        ...(secureWriteReceiptId ? { secureWriteReceiptId } : {}),
        target,
      });
      publishRouteSimulatorUpdate(
        actionId,
        review.preview.routeDecision,
        onRouteSimulatorUpdate
      );
      const routeDecision = projectRouteDecision(review.preview.routeDecision);
      setOutcome(undefined);
      setImpactReview({
        title: definition.label,
        description: admin_supply_preview_from_core({
          description: definition.description,
        }),
        scope: review.preview.scope,
        changes: [
          ...review.preview.changes,
          admin_supply_reversibility({
            value: review.preview.reversible
              ? admin_supply_reversible_16954c95()
              : admin_supply_irreversible_0235ca64(),
          }),
          ...review.preview.warnings.map((warning) =>
            admin_supply_constraint({ warning })
          ),
          ...(routeDecision ?? []).map(
            (detail) => `${detail.label}：${detail.value}`
          ),
        ],
        confirmLabel: admin_supply_confirm_label({ label: definition.label }),
        initialReason: reason,
        onConfirm: async (confirmedReason) => {
          setOutcome({
            actionId,
            message: admin_supply_action_executing({ label: definition.label }),
            status: 'pending',
          });
          try {
            const result = await onExecute({ reason: confirmedReason, review });
            if (actionId === 'credential_rotate' && secureWriteReceiptId) {
              // One-shot: success always drops the SPA handoff for this receipt.
              clearCredentialRotationHandoff(secureWriteReceiptId);
            }
            const resultRecord =
              result && typeof result === 'object'
                ? (result as Record<string, unknown>)
                : undefined;
            publishRouteSimulatorUpdate(
              actionId,
              resultRecord?.routeDecision ?? review.preview.routeDecision,
              onRouteSimulatorUpdate
            );
            setOutcome({
              actionId,
              details: projectActionResult(result),
              message: admin_supply_action_success({ label: definition.label }),
              status: 'succeeded',
            });
          } catch (error) {
            if (
              actionId === 'credential_rotate' &&
              secureWriteReceiptId &&
              isTerminalRotationReceiptError(error)
            ) {
              clearCredentialRotationHandoff(secureWriteReceiptId);
            }
            const message =
              error instanceof Error
                ? error.message
                : admin_supply_unknown_error_5f76edc5();
            publishRouteSimulatorError(
              actionId,
              message,
              onRouteSimulatorUpdate
            );
            setOutcome({
              actionId,
              message: admin_supply_action_failed({
                label: definition.label,
                message,
              }),
              status: 'failed',
            });
            throw error;
          }
        },
      });
    } catch (error) {
      if (
        actionId === 'credential_rotate' &&
        secureWriteReceiptId &&
        isTerminalRotationReceiptError(error)
      ) {
        clearCredentialRotationHandoff(secureWriteReceiptId);
      }
      const message =
        error instanceof Error
          ? error.message
          : admin_supply_unknown_error_5f76edc5();
      publishRouteSimulatorError(actionId, message, onRouteSimulatorUpdate);
      setOutcome({
        actionId,
        message: admin_supply_preview_failed({
          label: definition.label,
          message,
        }),
        status: 'failed',
      });
    }
  };

  return (
    <section
      data-testid="supply-governed-actions-panel"
      data-action-count={String(view.count)}
      data-forbid-secret-echo={String(view.forbids.secretEcho)}
      data-forbid-direct-db={String(view.forbids.directDbWrite)}
      data-forbid-bypass-publish={String(view.forbids.bypassPublishGate)}
      data-forbid-blind-retry={String(
        view.forbids.blindRetryAcceptedUnknownMedia
      )}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">
          {admin_supply_governed_quick_actions_2029dea2()}
        </h2>
        <p className="text-xs text-muted-foreground">
          {admin_supply_all_via_core_typed_commands_capability_p_13b9729e()}
        </p>
      </header>

      {/* Constraint legend, not health words — these stay neutral by design. */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {admin_supply_no_secret_echo_1d752c89()}
        </Badge>
        <Badge variant="outline">
          {admin_supply_no_direct_db_writes_65c80a14()}
        </Badge>
        <Badge variant="outline">
          {admin_supply_no_publish_gate_bypass_69d56aff()}
        </Badge>
        <Badge variant="outline">
          {admin_supply_no_blind_retry_of_accepted_unknown_5ca78898()}
        </Badge>
      </div>

      <Frame dense>
        <FramePanel className="p-0!">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{admin_supply_action_d9d98278()}</TableHead>
                <TableHead>{admin_supply_permission_560165a6()}</TableHead>
                <TableHead>{admin_supply_preview_de61aa8e()}</TableHead>
                <TableHead>{admin_supply_reason_1ff9c3d0()}</TableHead>
                <TableHead>{admin_supply_cas_idempotency_4f4772a6()}</TableHead>
                <TableHead>
                  {admin_supply_reversible_drain_a1d54996()}
                </TableHead>
                <TableHead>{admin_supply_target_941f0831()}</TableHead>
                <TableHead>
                  {admin_supply_reason_and_execute_287aa02e()}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.actions.map((action) => (
                <TableRow
                  key={action.id}
                  data-testid="supply-governed-action-row"
                  data-action-id={action.id}
                  data-permission={action.permission}
                  data-requires-preview="true"
                  data-requires-reason="true"
                  data-cas="true"
                  data-reversible-drain={String(action.reversibleDrain)}
                >
                  <TableCell>
                    <p className="font-medium">{action.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {action.description}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {action.id}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {action.permission}
                  </TableCell>
                  <TableCell>{admin_supply_yes_30160a21()}</TableCell>
                  <TableCell>{admin_supply_yes_30160a21()}</TableCell>
                  <TableCell>{admin_supply_yes_30160a21()}</TableCell>
                  <TableCell>
                    {action.reversibleDrain
                      ? admin_supply_yes_30160a21()
                      : admin_supply_no_8bf5c10a()}
                  </TableCell>
                  <GovernedActionFormCells
                    actionId={action.id}
                    label={action.label}
                    targets={targets[action.id] ?? []}
                    disabled={
                      !onPreview ||
                      !onExecute ||
                      (outcome?.actionId === action.id &&
                        outcome.status === 'pending')
                    }
                    onSubmit={(values) => reviewAction(action.id, values)}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      {outcome ? (
        <Frame
          dense
          data-action-id={outcome.actionId}
          data-testid="supply-governed-action-result"
          role={outcome.status === 'failed' ? 'alert' : 'status'}
        >
          <FramePanel className={cn('text-sm', outcomeTone(outcome.status))}>
            <p>{outcome.message}</p>
            {outcome.details ? (
              <dl
                className="mt-2 grid gap-1 rounded bg-muted p-2 text-xs"
                data-testid="supply-governed-action-details"
              >
                {outcome.details.map((detail) => (
                  <div className="flex gap-2" key={detail.label}>
                    <dt className="font-medium">{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {outcome.status === 'succeeded' ? (
              <a className="mt-1 inline-block underline" href="/admin/audit">
                {admin_supply_view_audit_0cdc970f()}
              </a>
            ) : null}
          </FramePanel>
        </Frame>
      ) : null}

      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </section>
  );
}
