import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  assertReferenceOnlySkillPayload,
  redactSkillCommandResult,
} from '@/p1/admin-skills-contract';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

/** Operator-facing labels for the source column (a hard catalog requirement). */
const SOURCE_LABELS = {
  harvested: '收割转译',
  authored: '手写',
  induced: '归纳',
} as const;

const TIER_LABELS = {
  platform: '平台层',
  industry: '行业层',
  store: '门店层',
} as const;

type SourceKind = keyof typeof SOURCE_LABELS;
type Tier = keyof typeof TIER_LABELS;

export interface SkillCatalogRow {
  skillId: string;
  name: string;
  description: string;
  sourceKind: SourceKind;
  sourceRef?: {
    externalUrl?: string;
    harvestedAt?: string;
  } | null;
  tier: Tier;
  presentationPolicy: string;
  activeRevisionRef: string | null;
  publicationGeneration: number;
  updatedAt: string;
}

interface SkillCatalogPage {
  items: SkillCatalogRow[];
  stats: {
    total: number;
    industryTierTotal: number;
    industryTierCorroborated: number;
  };
}

interface CurrentSkillPromptReference {
  contentHash: string;
  eligibleForAcceptance: boolean;
  isFallback: boolean;
  label: string;
  name: string;
  reasonCode?: string;
  source: 'langfuse' | 'builtin';
  version: string;
}

interface SkillCommandAuthorities {
  promptReference?: CurrentSkillPromptReference;
}

interface SkillGovernanceFormValues {
  baseSkillRevisionRef: string;
  description: string;
  expectedHeadRevision: string;
  instruction: string;
  runId: string;
}

interface SkillPublishFormValues {
  expectedPublicationGeneration: string;
  expectedPublishedRevisionRef: string;
  runId: string;
  skillId: string;
  targetSkillRevisionRef: string;
}

interface SkillReverseDependency {
  consumerId: string;
  consumerKind: string;
  consumerLabel: string;
  scopeKind: 'global' | 'workspace';
}

interface SkillReverseDependencyResult {
  blocked: boolean;
  hiddenCount: number;
  targetSkillRevisionRef: string;
  visibleDependencies: SkillReverseDependency[];
}

interface SkillGovernanceRunState {
  runId: string;
  state?: {
    result?: SkillGovernanceResult | null;
    status: string;
  } | null;
  run?: {
    result: SkillGovernanceResult;
    status: string;
  } | null;
  status?: string;
  workflowStatus?: string | null;
}

interface SkillGovernanceResult {
  applied: boolean;
  success: boolean;
  validationResults: Array<{
    fieldPath: string;
    reasonCode: string;
    status: string;
  }>;
}

type FieldKind = 'text' | 'select' | 'textarea';

interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
}

/**
 * Every command is a labelled form rather than a JSON box: a raw JSON editor
 * is a banned ops control, and an operator should not have to hand-assemble a
 * payload to publish a Skill.
 */
const COMMAND_FORMS = {
  skill_define: {
    label: '新建做法',
    fields: [
      { key: 'skillId', label: 'Skill 标识', kind: 'text' },
      { key: 'name', label: '名称', kind: 'text' },
      { key: 'packageName', label: '标准包名', kind: 'text' },
      { key: 'description', label: '一句话说明', kind: 'text' },
      {
        key: 'instruction',
        label: '受控做法正文',
        kind: 'textarea',
      },
      {
        key: 'expectedRevision',
        label: '当前版本号（首版留空）',
        kind: 'text',
      },
      {
        key: 'sourceKind',
        label: '来源',
        kind: 'select',
        options: [
          { value: 'harvested', label: '收割转译' },
          { value: 'authored', label: '手写' },
          { value: 'induced', label: '归纳' },
        ],
      },
      {
        key: 'tier',
        label: '层级',
        kind: 'select',
        options: [
          { value: 'platform', label: '平台层' },
          { value: 'industry', label: '行业层' },
        ],
      },
      {
        key: 'sourceExternalUrl',
        label: '收割来源链接（仅收割转译）',
        kind: 'text',
      },
      {
        key: 'sourceHarvestedAt',
        label: '收割时间（ISO 8601，仅收割转译）',
        kind: 'text',
      },
      {
        key: 'presentationPolicy',
        label: '展示策略',
        kind: 'select',
        options: [
          { value: 'backend_only', label: '仅后台使用' },
          { value: 'explainable', label: '可解释' },
          { value: 'user_selectable', label: '可由商家选用' },
        ],
      },
    ],
  },
  skill_accept: {
    label: '受理并冻结',
    fields: [
      { key: 'skillRevisionRef', label: '版本引用', kind: 'text' },
      { key: 'evalRunId', label: '评测运行号', kind: 'text' },
    ],
  },
  skill_bind: {
    label: '绑定阶段',
    fields: [
      { key: 'bindingId', label: '绑定标识', kind: 'text' },
      { key: 'workflowRevisionRef', label: '工作流版本', kind: 'text' },
      { key: 'skillRevisionRef', label: '版本引用', kind: 'text' },
      {
        key: 'harnessStage',
        label: '生效阶段',
        kind: 'select',
        options: [
          { value: 'intent_naming', label: '意图命名' },
          { value: 'context_injection', label: '上下文注入' },
          { value: 'brief_compilation', label: '简报编译' },
          { value: 'execution_selection', label: '执行选择' },
          { value: 'assembly_delivery', label: '装配交付' },
        ],
      },
      {
        key: 'mode',
        label: '绑定模式',
        kind: 'select',
        options: [
          { value: 'required', label: '必用' },
          { value: 'user_selected', label: '商家可选' },
          { value: 'disabled', label: '停用' },
        ],
      },
    ],
  },
  skill_rollback: {
    label: '回滚绑定',
    fields: [
      { key: 'bindingId', label: '新绑定标识', kind: 'text' },
      { key: 'sourceBindingId', label: '被回滚的绑定', kind: 'text' },
      { key: 'targetSkillRevisionRef', label: '回到哪个版本', kind: 'text' },
      { key: 'workflowRevisionRef', label: '工作流版本', kind: 'text' },
    ],
  },
  skill_deployment: {
    label: '登记部署',
    fields: [
      { key: 'deploymentId', label: '部署标识', kind: 'text' },
      { key: 'skillRevisionRef', label: '版本引用', kind: 'text' },
      { key: 'provider', label: '供应方', kind: 'text' },
      { key: 'channel', label: '渠道', kind: 'text' },
      { key: 'nativeSkillId', label: '对端 Skill 标识', kind: 'text' },
      { key: 'nativeVersion', label: '对端版本', kind: 'text' },
    ],
  },
} as const satisfies Record<
  string,
  { label: string; fields: readonly FieldSpec[] }
>;

type SkillAction = keyof typeof COMMAND_FORMS;

const ACTION_ORDER = [
  'skill_define',
  'skill_accept',
  'skill_bind',
  'skill_rollback',
  'skill_deployment',
] as const satisfies readonly SkillAction[];

const GOVERNANCE_RUN_ACTIONS = [
  'skill_governance_approve',
  'skill_governance_business_cancel',
  'skill_governance_cancel',
  'skill_governance_resume',
] as const;

type GovernanceRunAction = (typeof GOVERNANCE_RUN_ACTIONS)[number];
type GovernanceIntentAction = GovernanceRunAction | 'skill_governance_start';

export function createGovernanceActionIntentRegistry(
  createIdempotencyKey: () => string = () => crypto.randomUUID()
) {
  const pendingKeys = new Map<string, string>();
  return {
    async execute<T>(
      runAction: GovernanceIntentAction,
      runId: string,
      submit: (idempotencyKey: string) => Promise<T>
    ) {
      const fingerprint = `${runAction}:${runId}`;
      const idempotencyKey =
        pendingKeys.get(fingerprint) ??
        `${runAction}:${createIdempotencyKey()}`;
      pendingKeys.set(fingerprint, idempotencyKey);
      const result = await submit(idempotencyKey);
      if (pendingKeys.get(fingerprint) === idempotencyKey) {
        pendingKeys.delete(fingerprint);
      }
      return result;
    },
  };
}

const ADMIN_SKILL_GOVERNANCE = {
  budget: {
    maxChildEffects: 0,
    maxCostCents: 0,
    timeoutMs: 10_000,
  },
  contextScopes: [],
  executionMode: 'prompt_materialized',
  fallback: 'fail_closed',
  inputSchemaRef: 'skill-input.daily-industry@1',
  outputSchemaRef: 'skill-output.intent-decision@1',
  requiredModelCapabilities: ['structured_output'],
  sideEffectClass: 'none',
  workflowRevisionRefs: ['workflow.copy@1'],
} as const;

/**
 * Assembles the nested command payload from flat form values. Shapes the
 * caller should not have to know (trigger conditions, execution mode) are
 * derived here rather than typed by hand.
 */
export function buildSkillCommandPayload(
  action: SkillAction,
  values: Record<string, string>,
  authorities: SkillCommandAuthorities = {}
): Record<string, unknown> {
  if (action === 'skill_define') {
    const promptReference = authorities.promptReference;
    if (!promptReference?.eligibleForAcceptance) {
      throw new Error('当前 production prompt 引用尚未就绪。');
    }
    const expectedRevision = values.expectedRevision?.trim();
    if (
      expectedRevision &&
      (!/^\d+$/u.test(expectedRevision) || Number(expectedRevision) < 1)
    ) {
      throw new Error('当前版本号必须是正整数；首版请留空。');
    }
    return {
      description: values.description,
      expectedRevision: expectedRevision ? Number(expectedRevision) : null,
      frontmatter: {
        description: values.description,
        name: values.packageName,
      },
      governance: ADMIN_SKILL_GOVERNANCE,
      instruction: values.instruction,
      name: values.name,
      packagePaths: ['SKILL.md'],
      presentationPolicy: values.presentationPolicy,
      promptReference: {
        contentHash: promptReference.contentHash,
        name: promptReference.name,
        version: promptReference.version,
      },
      skillId: values.skillId,
      sourceKind: values.sourceKind,
      ...(values.sourceKind === 'harvested'
        ? {
            sourceRef: {
              externalUrl: values.sourceExternalUrl,
              harvestedAt: values.sourceHarvestedAt,
            },
          }
        : {}),
      tier: values.tier,
    };
  }
  if (action === 'skill_accept') {
    return {
      evalRunId: values.evalRunId,
      skillRevisionRef: values.skillRevisionRef,
    };
  }
  if (action === 'skill_bind') {
    return {
      bindingId: values.bindingId,
      workflowRevisionRef: values.workflowRevisionRef,
      skillRevisionRef: values.skillRevisionRef,
      mode: values.mode,
      triggerCondition: {
        harnessStage: values.harnessStage,
        industryCategory: null,
        tenantId: null,
      },
    };
  }
  if (action === 'skill_deployment') {
    return {
      ...values,
      // Only prompt-materialised first deployments clear the gate without an
      // experimental waiver, so that is what this surface offers.
      executionMode: 'prompt_materialized',
      packagePaths: ['SKILL.md'],
    };
  }
  return { ...values };
}

export function buildSkillGovernanceStartPayload(
  values: SkillGovernanceFormValues
) {
  const expectedHeadRevision = Number(values.expectedHeadRevision);
  if (!Number.isInteger(expectedHeadRevision) || expectedHeadRevision < 1) {
    throw new Error('当前版本号必须是正整数。');
  }
  return {
    baseSkillRevisionRef: requiredFormValue(
      values.baseSkillRevisionRef,
      '基础版本引用'
    ),
    expectedHeadRevision,
    patch: {
      instruction: requiredFormValue(values.instruction, '受控做法正文'),
      'manifest.description': requiredFormValue(
        values.description,
        '一句话说明'
      ),
    },
    runId: requiredFormValue(values.runId, '治理运行号'),
  };
}

export function buildSkillPublishPayload(values: SkillPublishFormValues) {
  const expectedPublicationGeneration = Number(
    values.expectedPublicationGeneration
  );
  if (
    !Number.isInteger(expectedPublicationGeneration) ||
    expectedPublicationGeneration < 0
  ) {
    throw new Error('Published 代数必须是非负整数。');
  }
  return {
    expectedPublicationGeneration,
    expectedPublishedRevisionRef:
      values.expectedPublishedRevisionRef.trim() || null,
    runId: requiredFormValue(values.runId, '发布运行号'),
    skillId: requiredFormValue(values.skillId, 'Skill 标识'),
    targetSkillRevisionRef: requiredFormValue(
      values.targetSkillRevisionRef,
      '目标版本引用'
    ),
  };
}

function requiredFormValue(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空。`);
  return normalized;
}

function governanceWorkflowStatus(run: SkillGovernanceRunState | undefined) {
  return run?.workflowStatus?.toLowerCase();
}

function governanceRunStatus(run: SkillGovernanceRunState | undefined) {
  const workflowStatus = run?.workflowStatus?.toLowerCase();
  if (workflowStatus === 'cancelled' || workflowStatus === 'canceled') {
    return 'administrative_cancelled';
  }
  if (
    workflowStatus === 'error' ||
    workflowStatus === 'max_recovery_attempts_exceeded'
  ) {
    return 'failed';
  }
  const stateStatus = run?.state?.status ?? run?.run?.status ?? run?.status;
  if (stateStatus === 'cancelled' || stateStatus === 'canceled') {
    return 'business_cancelled';
  }
  return stateStatus ?? workflowStatus ?? undefined;
}

const GOVERNANCE_RUN_TERMINAL_STATUSES = [
  'administrative_cancelled',
  'business_cancelled',
  'completed',
  'failed',
];

/**
 * Poll a governance run until it reaches a terminal status.
 *
 * An unknown status keeps polling on purpose. Every run action is disabled
 * while the status is unreadable, so a read that was aborted or failed would
 * otherwise strand the panel: no poll to recover it, and no enabled control to
 * act on. Only a terminal run has nothing left to observe.
 */
export function governanceRunPollInterval(
  run: SkillGovernanceRunState | undefined
) {
  const status = governanceRunStatus(run);
  return status && GOVERNANCE_RUN_TERMINAL_STATUSES.includes(status)
    ? false
    : 2_000;
}

function governanceRunStatusLabel(status: string | undefined) {
  if (status === 'administrative_cancelled') {
    return '管理取消（可恢复）';
  }
  if (status === 'business_cancelled') {
    return '业务终止（不可恢复）';
  }
  return status;
}

function governanceRunResult(run: SkillGovernanceRunState | undefined) {
  return run?.state?.result ?? run?.run?.result ?? null;
}

function GovernanceResultView({ result }: { result: SkillGovernanceResult }) {
  return (
    <div className="space-y-2 text-sm" data-testid="skill-governance-result">
      <p>
        success={String(result.success)}
        {' · '}applied={String(result.applied)}
      </p>
      {result.validationResults.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground">
          {result.validationResults.map((validation) => (
            <li key={`${validation.fieldPath}:${validation.reasonCode}`}>
              {validation.fieldPath} · {validation.reasonCode} ·{' '}
              {validation.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AdminSkillsControl() {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SkillAction>('skill_define');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tierFilter, setTierFilter] = useState('');
  const [historySkillId, setHistorySkillId] = useState('');
  const [governanceValues, setGovernanceValues] =
    useState<SkillGovernanceFormValues>({
      baseSkillRevisionRef: '',
      description: '',
      expectedHeadRevision: '',
      instruction: '',
      runId: '',
    });
  const [governanceRunId, setGovernanceRunId] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (window.localStorage.getItem('admin-skill-governance-run-id') ?? '')
  );
  const [governanceError, setGovernanceError] = useState('');
  const [governanceBusy, setGovernanceBusy] = useState(false);
  const [governanceActionIntents] = useState(() =>
    createGovernanceActionIntentRegistry()
  );
  const [publishValues, setPublishValues] = useState<SkillPublishFormValues>({
    expectedPublicationGeneration: '',
    expectedPublishedRevisionRef: '',
    runId: '',
    skillId: '',
    targetSkillRevisionRef: '',
  });
  const [publishError, setPublishError] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] =
    useState<SkillGovernanceResult | null>(null);
  const [dependencyInput, setDependencyInput] = useState('');
  const [dependencyTarget, setDependencyTarget] = useState('');
  const [retireRunId, setRetireRunId] = useState('');
  const [retireError, setRetireError] = useState('');
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireResult, setRetireResult] =
    useState<SkillGovernanceResult | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!governanceRunId) {
      window.localStorage.removeItem('admin-skill-governance-run-id');
      return;
    }
    window.localStorage.setItem(
      'admin-skill-governance-run-id',
      governanceRunId
    );
  }, [governanceRunId]);

  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('skills', 'skill_catalog_list', {
      tier: tierFilter,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillCatalogPage>(
        'skills',
        {
          action: 'skill_catalog_list',
          payload: tierFilter ? { tier: tierFilter } : {},
        },
        signal
      ),
  });
  const historyQuery = useQuery({
    enabled: Boolean(historySkillId),
    queryKey: p1QueryKeys.request('skills', 'skill_revision_history', {
      skillId: historySkillId,
    }),
    queryFn: ({ signal }) =>
      queryP1<
        Array<{
          skillRevisionRef: string;
          status: string;
          createdAt: string;
        }>
      >(
        'skills',
        {
          action: 'skill_revision_history',
          payload: { skillId: historySkillId },
        },
        signal
      ),
  });
  const promptReferenceQuery = useQuery({
    queryKey: p1QueryKeys.request('skills', 'skill_prompt_reference', {
      slot: 'intentNaming',
    }),
    queryFn: ({ signal }) =>
      queryP1<CurrentSkillPromptReference>(
        'skills',
        {
          action: 'skill_prompt_reference',
          payload: { slot: 'intentNaming' },
        },
        signal
      ),
  });
  const governanceRunQuery = useQuery({
    enabled: Boolean(governanceRunId),
    queryKey: p1QueryKeys.request('skills', 'skill_governance_run_get', {
      runId: governanceRunId,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillGovernanceRunState>(
        'skills',
        {
          action: 'skill_governance_run_get',
          payload: { runId: governanceRunId },
        },
        signal
      ),
    refetchInterval: (query) => governanceRunPollInterval(query.state.data),
  });
  const dependencyQuery = useQuery({
    enabled: Boolean(dependencyTarget),
    queryKey: p1QueryKeys.request('skills', 'skill_reverse_dependencies', {
      skillRevisionRef: dependencyTarget,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillReverseDependencyResult>(
        'skills',
        {
          action: 'skill_reverse_dependencies',
          payload: { skillRevisionRef: dependencyTarget },
        },
        signal
      ),
  });
  const form = COMMAND_FORMS[action];
  const authorityUnavailable =
    !promptReferenceQuery.data?.eligibleForAcceptance;

  const submit = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload = buildSkillCommandPayload(action, values, {
        promptReference: promptReferenceQuery.data,
      });
      assertReferenceOnlySkillPayload(payload);
      setResult(
        redactSkillCommandResult(
          await commandP1(
            'skills',
            { action, payload },
            `${action}:${crypto.randomUUID()}`
          )
        )
      );
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Skill 操作失败，请重试。'
      );
    } finally {
      setBusy(false);
    }
  };

  const startGovernanceRun = async () => {
    setGovernanceBusy(true);
    setGovernanceError('');
    try {
      const payload = buildSkillGovernanceStartPayload(governanceValues);
      await governanceActionIntents.execute(
        'skill_governance_start',
        payload.runId,
        (idempotencyKey) =>
          commandP1(
            'skills',
            { action: 'skill_governance_start', payload },
            idempotencyKey
          )
      );
      setGovernanceRunId(payload.runId);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setGovernanceError(
        cause instanceof Error ? cause.message : '受控修订启动失败，请重试。'
      );
    } finally {
      setGovernanceBusy(false);
    }
  };

  const actOnGovernanceRun = async (runAction: GovernanceRunAction) => {
    if (!governanceRunId) return;
    setGovernanceBusy(true);
    setGovernanceError('');
    try {
      await governanceActionIntents.execute(
        runAction,
        governanceRunId,
        (idempotencyKey) =>
          commandP1(
            'skills',
            {
              action: runAction,
              payload: { runId: governanceRunId },
            },
            idempotencyKey
          )
      );
      await governanceRunQuery.refetch();
    } catch (cause) {
      setGovernanceError(
        cause instanceof Error ? cause.message : '治理运行操作失败，请重试。'
      );
    } finally {
      setGovernanceBusy(false);
    }
  };

  const publishRevision = async () => {
    setPublishBusy(true);
    setPublishError('');
    try {
      const catalog = rows.find(
        (row) => row.skillId === publishValues.skillId.trim()
      );
      if (!catalog) {
        throw new Error('请先从当前目录选择有效 Skill 标识。');
      }
      const payload = buildSkillPublishPayload({
        ...publishValues,
        expectedPublicationGeneration: String(catalog.publicationGeneration),
        expectedPublishedRevisionRef: catalog.activeRevisionRef ?? '',
      });
      const response = await commandP1<SkillGovernanceResult>(
        'skills',
        { action: 'skill_publish', payload },
        `skill_publish:${payload.runId}`
      );
      setPublishResult(response);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setPublishError(
        cause instanceof Error ? cause.message : 'Published 切换失败，请重试。'
      );
    } finally {
      setPublishBusy(false);
    }
  };

  const inspectDependencies = () => {
    const target = dependencyInput.trim();
    setRetireResult(null);
    if (!target) {
      setRetireError('版本引用不能为空。');
      return;
    }
    setRetireError('');
    if (target === dependencyTarget) {
      void dependencyQuery.refetch();
      return;
    }
    setDependencyTarget(target);
  };

  const visibleDependencies = dependencyQuery.data?.visibleDependencies ?? [];
  const retirementBlocked =
    !dependencyQuery.data ||
    dependencyQuery.data.blocked === true ||
    dependencyQuery.data.hiddenCount > 0 ||
    visibleDependencies.length > 0;

  const retireRevision = async () => {
    setRetireBusy(true);
    setRetireError('');
    setRetireResult(null);
    try {
      const runId = requiredFormValue(retireRunId, '退役运行号');
      const skillRevisionRef = requiredFormValue(dependencyTarget, '版本引用');
      if (retirementBlocked) {
        throw new Error('仍有反向依赖，当前版本不能退役。');
      }
      const response = await commandP1<SkillGovernanceResult>(
        'skills',
        {
          action: 'skill_retire',
          payload: { runId, skillRevisionRef },
        },
        `skill_retire:${runId}`
      );
      setRetireResult(response);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setRetireError(
        cause instanceof Error ? cause.message : '版本退役失败，请重试。'
      );
    } finally {
      setRetireBusy(false);
    }
  };

  const rows = catalogQuery.data?.items ?? [];
  const stats = catalogQuery.data?.stats;

  return (
    <div className="space-y-6" data-testid="admin-skills-control">
      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>Skill 目录</FrameTitle>
          <FrameDescription>
            当前承载平台层与行业层的场景配方与行业话术。「来源」列区分收割转译、手写与归纳。
          </FrameDescription>
        </FrameHeader>
        {/* 目录面板的节奏：工具条 → Separator → 表格，版本记录落在 FrameFooter。 */}
        <FramePanel className="flex flex-col gap-0 p-0!">
          <div className="flex items-end gap-3 px-4 py-3">
            <div className="space-y-2">
              <Label htmlFor="skills-tier-filter">按层级筛选</Label>
              <select
                id="skills-tier-filter"
                data-ops-control="select"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={tierFilter}
                onChange={(event) => setTierFilter(event.target.value)}
              >
                <option value="">全部</option>
                <option value="platform">平台层</option>
                <option value="industry">行业层</option>
              </select>
            </div>
            {stats?.industryTierTotal ? (
              <p className="pb-2 text-sm text-muted-foreground">
                行业层第二来源交叉验证占比：
                {Math.round(
                  (stats.industryTierCorroborated / stats.industryTierTotal) *
                    100
                )}
                %（{stats.industryTierCorroborated}/{stats.industryTierTotal}）
              </p>
            ) : null}
          </div>
          <Separator />
          {catalogQuery.isError ? (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              目录读取失败，请重试。
            </p>
          ) : null}
          {!catalogQuery.isLoading && !rows.length ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              还没有任何 Skill。用下面的「新建做法」建第一条。
            </p>
          ) : null}
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>一句话说明</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>层级</TableHead>
                  <TableHead>当前版本</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead>版本记录</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.skillId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div
                        className="max-w-96 truncate"
                        title={row.description}
                      >
                        {row.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {SOURCE_LABELS[row.sourceKind] ?? row.sourceKind}
                      </Badge>
                      {row.sourceRef?.externalUrl ? (
                        <a
                          className="ml-2 text-xs underline"
                          href={row.sourceRef.externalUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          查看出处
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>{TIER_LABELS[row.tier] ?? row.tier}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.activeRevisionRef ?? '尚未受理'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.updatedAt}
                    </TableCell>
                    <TableCell>
                      <Button
                        data-ops-control="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setHistorySkillId(row.skillId)}
                      >
                        查看版本
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </FramePanel>
        {historySkillId ? (
          <FrameFooter
            className="gap-2 py-3"
            data-testid="skills-revision-history"
          >
            <p className="font-medium text-sm">{historySkillId} 的版本记录</p>
            {historyQuery.isLoading ? (
              <p className="text-muted-foreground text-sm">读取中…</p>
            ) : null}
            {historyQuery.data?.map((revision) => (
              <div
                className="flex justify-between rounded-lg border px-3 py-2 text-sm"
                key={revision.skillRevisionRef}
              >
                <span>{revision.skillRevisionRef}</span>
                <span>{revision.status}</span>
              </div>
            ))}
          </FrameFooter>
        ) : null}
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>受控修订</FrameTitle>
          <FrameDescription>
            只有“受控做法正文”和“一句话说明”可修改。名称、来源、层级、治理预算、schema
            与 prompt 引用保持只读。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div
            className="rounded-md border bg-muted/30 p-3 text-muted-foreground text-sm"
            data-testid="skills-readonly-declaration"
          >
            不可覆盖：名称、来源、层级、治理预算、schema、prompt
            引用、版本号与审计归属。
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="skills-governance-run-id">治理运行号</Label>
              <Input
                id="skills-governance-run-id"
                data-ops-control="text"
                value={governanceValues.runId}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    runId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-base-ref">基础版本引用</Label>
              <Input
                id="skills-governance-base-ref"
                data-ops-control="text"
                value={governanceValues.baseSkillRevisionRef}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    baseSkillRevisionRef: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-head">当前版本号</Label>
              <Input
                id="skills-governance-head"
                data-ops-control="text"
                inputMode="numeric"
                value={governanceValues.expectedHeadRevision}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    expectedHeadRevision: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-description">一句话说明</Label>
              <Input
                id="skills-governance-description"
                data-ops-control="text"
                value={governanceValues.description}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="skills-governance-instruction">
                受控做法正文
              </Label>
              <Textarea
                id="skills-governance-instruction"
                data-ops-control="text"
                value={governanceValues.instruction}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    instruction: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <Button
            data-ops-control="button"
            disabled={governanceBusy}
            onClick={() => void startGovernanceRun()}
          >
            {governanceBusy ? '处理中…' : '启动修订运行'}
          </Button>
          {governanceError ? (
            <p role="alert" className="text-sm text-destructive">
              {governanceError}
            </p>
          ) : null}
          <div
            className="space-y-3 rounded-md border p-3"
            data-testid="skills-governance-run"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm">治理运行</p>
                <p className="text-muted-foreground text-sm">
                  {governanceRunId
                    ? `${governanceRunId} · ${
                        governanceRunStatusLabel(
                          governanceRunStatus(governanceRunQuery.data)
                        ) ?? '读取中'
                      }`
                    : '启动后会在这里恢复运行状态。'}
                </p>
              </div>
              {governanceRunQuery.isFetching ? (
                <Badge variant="secondary">刷新中</Badge>
              ) : null}
            </div>
            {governanceRunResult(governanceRunQuery.data) ? (
              <GovernanceResultView
                result={governanceRunResult(governanceRunQuery.data)!}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceRunStatus(governanceRunQuery.data) !==
                    'awaiting_approval'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_approve')
                }
                size="sm"
                variant="outline"
              >
                批准并继续
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  !governanceRunId ||
                  !['awaiting_approval', 'applying'].includes(
                    governanceRunStatus(governanceRunQuery.data) ?? ''
                  )
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_cancel')
                }
                size="sm"
                variant="outline"
              >
                管理取消（可恢复）
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceRunStatus(governanceRunQuery.data) !==
                    'awaiting_approval'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_business_cancel')
                }
                size="sm"
                variant="outline"
              >
                业务终止（不可恢复）
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceWorkflowStatus(governanceRunQuery.data) !==
                    'cancelled'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_resume')
                }
                size="sm"
                variant="outline"
              >
                恢复管理取消
              </Button>
              <Button
                data-ops-control="button"
                disabled={!governanceRunId}
                onClick={() => void governanceRunQuery.refetch()}
                size="sm"
                variant="ghost"
              >
                刷新状态
              </Button>
            </div>
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>Published（唯一）</FrameTitle>
          <FrameDescription>
            Published 是每个 Skill
            唯一的生命周期指针。切换它不会改动流量目标，也不会让历史版本变成第二个
            Published。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['runId', '发布运行号'],
              ['skillId', 'Skill 标识'],
              ['targetSkillRevisionRef', '目标版本引用'],
            ].map(([key, label]) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`skills-publish-${key}`}>{label}</Label>
                <Input
                  id={`skills-publish-${key}`}
                  data-ops-control="text"
                  value={publishValues[key as keyof SkillPublishFormValues]}
                  onChange={(event) =>
                    setPublishValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <Button
            data-ops-control="button"
            disabled={publishBusy}
            onClick={() => void publishRevision()}
          >
            {publishBusy ? '切换中…' : '切换 Published'}
          </Button>
          {publishError ? (
            <p role="alert" className="text-sm text-destructive">
              {publishError}
            </p>
          ) : null}
          {publishResult ? (
            <GovernanceResultView result={publishResult} />
          ) : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>反向依赖与退役</FrameTitle>
          <FrameDescription>
            退役前必须读取精确版本的反向依赖。本工作区与全局依赖显示明细，其他工作区只显示数量。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="skills-dependency-ref">版本引用</Label>
              <Input
                id="skills-dependency-ref"
                data-ops-control="text"
                value={dependencyInput}
                onChange={(event) => setDependencyInput(event.target.value)}
              />
            </div>
            <Button
              data-ops-control="button"
              onClick={inspectDependencies}
              variant="outline"
            >
              查看反向依赖
            </Button>
          </div>
          {dependencyQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              依赖读取失败，退役保持阻断。
            </p>
          ) : null}
          {dependencyQuery.data ? (
            <div
              className="space-y-3 rounded-md border p-3"
              data-testid="skills-reverse-dependencies"
            >
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    retirementBlocked
                      ? 'destructive-outline'
                      : 'success-outline'
                  }
                >
                  {retirementBlocked ? '退役已阻断' : '未发现依赖'}
                </Badge>
                <Badge variant="secondary">
                  其他工作区依赖 {dependencyQuery.data.hiddenCount}
                </Badge>
              </div>
              {visibleDependencies.map((dependency, index) => (
                <div
                  className="flex items-center justify-between gap-3 text-sm"
                  key={`${dependency.consumerKind}:${dependency.consumerId || index}`}
                >
                  <span>{dependency.consumerLabel}</span>
                  <span className="text-muted-foreground">
                    {dependency.scopeKind === 'global' ? '全局' : '本工作区'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="skills-retire-run-id">退役运行号</Label>
              <Input
                id="skills-retire-run-id"
                data-ops-control="text"
                value={retireRunId}
                onChange={(event) => setRetireRunId(event.target.value)}
              />
            </div>
            <Button
              data-ops-control="button"
              disabled={retireBusy || retirementBlocked}
              onClick={() => void retireRevision()}
              variant="outline"
            >
              {retireBusy ? '退役中…' : '退役这个版本'}
            </Button>
          </div>
          {retireError ? (
            <p role="alert" className="text-sm text-destructive">
              {retireError}
            </p>
          ) : null}
          {retireResult ? <GovernanceResultView result={retireResult} /> : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>流量目标（新请求）与基础生命周期</FrameTitle>
          <FrameDescription>
            “绑定阶段”和“回滚绑定”只切换随后接纳的新请求；已接纳运行继续使用冻结的精确版本。定义、受理与部署不改变这个边界。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skills-action">操作</Label>
            <select
              id="skills-action"
              data-ops-control="select"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={action}
              onChange={(event) => {
                setAction(event.target.value as SkillAction);
                setValues({});
                setError('');
                setResult(null);
              }}
            >
              {ACTION_ORDER.map((value) => (
                <option key={value} value={value}>
                  {COMMAND_FORMS[value].label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`skills-field-${field.key}`}>
                  {field.label}
                </Label>
                {field.kind === 'select' ? (
                  <select
                    id={`skills-field-${field.key}`}
                    data-ops-control="select"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">请选择</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === 'textarea' ? (
                  <Textarea
                    id={`skills-field-${field.key}`}
                    data-ops-control="text"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`skills-field-${field.key}`}
                    data-ops-control="text"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {promptReferenceQuery.data ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="skills-current-prompt-reference"
            >
              当前 prompt：
              {promptReferenceQuery.data.name}@
              {promptReferenceQuery.data.version} ·{' '}
              {promptReferenceQuery.data.source} ·{' '}
              {promptReferenceQuery.data.label} · fallback=
              {String(promptReferenceQuery.data.isFallback)} · eligible=
              {String(promptReferenceQuery.data.eligibleForAcceptance)}
            </p>
          ) : null}
          {promptReferenceQuery.isError ||
          (promptReferenceQuery.data &&
            !promptReferenceQuery.data.eligibleForAcceptance) ? (
            <p role="alert" className="text-sm text-destructive">
              当前 production prompt 引用不可用，生命周期操作已禁用。
            </p>
          ) : null}
          <Button
            data-ops-control="button"
            disabled={busy || authorityUnavailable}
            onClick={() => void submit()}
          >
            {busy ? '提交中…' : '提交受控命令'}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {result ? (
            <div
              className="rounded-lg border p-3 text-sm"
              data-testid="skills-operation-result"
            >
              操作已完成：{action}
            </div>
          ) : null}
        </FramePanel>
      </Frame>
    </div>
  );
}
