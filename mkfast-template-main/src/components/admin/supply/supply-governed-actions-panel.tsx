/**
 * Governed quick actions panel (J5 / D-070 ③).
 * Lists the full action set with permission / preview / CAS flags.
 * Execution goes through ImpactReviewDialog + Core typed commands (no secrets).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
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
            message: '请输入候选 Revision ID',
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
            message: '请输入至少一个 Deployment ID',
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
          message: '请输入安全写入回执 ID，不要粘贴密钥',
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
      label: '硬过滤',
      value: `通过 ${stringList(hardFilter?.passedDeploymentIds).join('、') || '无'}；排除 ${exclusions(hardFilter?.excluded) || '无'}`,
    },
    {
      label: '三层排序',
      value: `${stringList(sort?.layerOrder).join(' → ') || '无'}；${ranked || '无候选'}`,
    },
    {
      label: '实时排除',
      value: exclusions(explanation.liveExclusions) || '无',
    },
    {
      label: '最大成本',
      value:
        typeof maxCost?.amountMicros === 'number' &&
        typeof maxCost.currency === 'string'
          ? `${maxCost.amountMicros} μ${maxCost.currency}（${String(maxCost.evidenceSource ?? 'unknown')}）`
          : '未知',
    },
    {
      label: '接受态',
      value: `${String(acceptance?.decision ?? 'unknown')}（${String(acceptance?.reason ?? 'unknown')}）`,
    },
    {
      label: '未选原因',
      value: exclusions(explanation.notSelectedReasons) || '无',
    },
    { label: '证据新鲜度', value: freshness || '无证据' },
    { label: '成本证据来源', value: costEvidence || '未知' },
    {
      label: '数据处理等级',
      value:
        typeof dataProcessing?.copy === 'string'
          ? dataProcessing.copy
          : `${String(dataProcessing?.level ?? 'unknown')}；受保护通道 ${dataProcessing?.protectedChannel === true ? '是' : '否'}`,
    },
    {
      label: 'Fail closed',
      value:
        explanation.failClosed === true
          ? String(explanation.failClosedReason ?? '是')
          : '否',
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
        <select
          aria-label={`${label}目标`}
          className="h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
          {...form.register('targetId')}
        >
          <option value="">选择目标</option>
          {targets.map((target) => (
            <option
              key={target.selectionId ?? target.resourceId}
              value={target.selectionId ?? target.resourceId}
            >
              {target.label ?? target.resourceId}
            </option>
          ))}
        </select>
        {actionId === 'credential_rotate' ? (
          <div>
            <input
              aria-label="凭据轮换安全写入回执"
              autoComplete="off"
              className="mt-2 h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
              data-handoff-prefill={String(handoffPrefillActive)}
              data-testid="supply-credential-rotate-receipt"
              placeholder="安全写入回执 ID"
              type="text"
              {...form.register('secureWriteReceiptId')}
            />
            {handoffPrefillActive ? (
              <p
                className="mt-1 text-xs text-muted-foreground"
                data-testid="supply-credential-rotate-handoff-hint"
              >
                已从集成页会话交接预填回执（可手改；刷新后仅可手工输入）。
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
              aria-label="候选 Revision ID"
              className="mt-2 h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
              placeholder="route-policy:rN"
              type="text"
              {...form.register('candidateRevisionId')}
            />
            <input
              aria-label="候选 Deployment IDs"
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
          aria-label={`${label}原因`}
          className="mb-2 h-9 min-w-56 rounded-md border bg-background px-2 text-xs"
          placeholder="至少 8 个字符的审计原因"
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
                ? '凭据轮换回执已过期，请回到集成页重新暂存。'
                : bound.status === 'account_mismatch' ||
                    bound.status === 'workspace_mismatch'
                  ? '凭据轮换回执与当前账户/工作区绑定不匹配。'
                  : '凭据轮换回执已不可用，请手工输入或重新暂存。',
            status: 'failed',
          });
          return;
        }
      }
    }
    setOutcome({
      actionId,
      message: `${definition.label}影响预览生成中…`,
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
        description: `${definition.description}。本预览由 Core 生成。`,
        scope: review.preview.scope,
        changes: [
          ...review.preview.changes,
          `可逆性：${review.preview.reversible ? '可逆' : '不可逆'}`,
          ...review.preview.warnings.map((warning) => `约束：${warning}`),
          ...(routeDecision ?? []).map(
            (detail) => `${detail.label}：${detail.value}`
          ),
        ],
        confirmLabel: `确认${definition.label}`,
        initialReason: reason,
        onConfirm: async (confirmedReason) => {
          setOutcome({
            actionId,
            message: `${definition.label}执行中…`,
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
              message: `${definition.label}执行成功`,
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
            const message = error instanceof Error ? error.message : '未知错误';
            publishRouteSimulatorError(
              actionId,
              message,
              onRouteSimulatorUpdate
            );
            setOutcome({
              actionId,
              message: `${definition.label}执行失败：${message}`,
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
      const message = error instanceof Error ? error.message : '未知错误';
      publishRouteSimulatorError(actionId, message, onRouteSimulatorUpdate);
      setOutcome({
        actionId,
        message: `${definition.label}预览失败：${message}`,
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
        <h2 className="text-base font-semibold">受治理快捷动作</h2>
        <p className="text-xs text-muted-foreground">
          全部走 Core 类型化命令 + capability permission + 影响预览 + 原因 +
          CAS/幂等 + 可逆排空 +
          不可变审计。不暴露密钥、不直写库、不绕发布门、不对 accepted/unknown
          媒体盲目重试。
        </p>
      </header>

      {/* Constraint legend, not health words — these stay neutral by design. */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">禁止密钥回显</Badge>
        <Badge variant="outline">禁止直写库</Badge>
        <Badge variant="outline">禁止绕发布门</Badge>
        <Badge variant="outline">禁止盲目重试 accepted/unknown</Badge>
      </div>

      <Frame dense>
        <FramePanel className="p-0!">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>动作</TableHead>
                <TableHead>权限</TableHead>
                <TableHead>预览</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>CAS/幂等</TableHead>
                <TableHead>可逆排空</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>原因与执行</TableHead>
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
                  <TableCell>是</TableCell>
                  <TableCell>是</TableCell>
                  <TableCell>是</TableCell>
                  <TableCell>{action.reversibleDrain ? '是' : '否'}</TableCell>
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
                查看审计
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
