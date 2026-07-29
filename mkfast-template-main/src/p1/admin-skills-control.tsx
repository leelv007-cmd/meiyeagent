import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export function AdminSkillsControl() {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SkillAction>('skill_define');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tierFilter, setTierFilter] = useState('');
  const [historySkillId, setHistorySkillId] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const rows = catalogQuery.data?.items ?? [];
  const stats = catalogQuery.data?.stats;

  return (
    <div className="space-y-6" data-testid="admin-skills-control">
      <AdminPanel>
        <AdminPanelHeader>
          <h2 className="widget__title" data-slot="widget-title">
            Skill 目录
          </h2>
          <AdminPanelDescription>
            平台层、行业层与门店层的场景配方与行业话术。「来源」列区分收割转译、手写与归纳。
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
          <div className="flex items-end gap-3">
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
          {catalogQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              目录读取失败，请重试。
            </p>
          ) : null}
          {!catalogQuery.isLoading && !rows.length ? (
            <p className="text-sm text-muted-foreground">
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
                    <TableCell className="max-w-96 text-muted-foreground">
                      {row.description}
                    </TableCell>
                    <TableCell>
                      <AdminStatusChip variant="secondary">
                        {SOURCE_LABELS[row.sourceKind] ?? row.sourceKind}
                      </AdminStatusChip>
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
          {historySkillId ? (
            <div className="space-y-2" data-testid="skills-revision-history">
              <p className="font-medium text-sm">{historySkillId} 的版本记录</p>
              {historyQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">读取中…</p>
              ) : null}
              {historyQuery.data?.map((revision) => (
                <div
                  className="flex justify-between rounded-md border px-3 py-2 text-sm"
                  key={revision.skillRevisionRef}
                >
                  <span>{revision.skillRevisionRef}</span>
                  <span>{revision.status}</span>
                </div>
              ))}
            </div>
          ) : null}
        </AdminPanelContent>
      </AdminPanel>

      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>生命周期操作</AdminPanelTitle>
          <AdminPanelDescription>
            定义、受理、绑定、回滚与部署走同一条治理链；版本引用必须精确，不能使用
            latest。
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
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
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}
