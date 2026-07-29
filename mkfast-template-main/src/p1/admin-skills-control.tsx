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
  tier: Tier;
  presentationPolicy: string;
  activeRevisionRef: string | null;
  updatedAt: string;
}

type FieldKind = 'text' | 'select';

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
      { key: 'description', label: '一句话说明', kind: 'text' },
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
          { value: 'store', label: '门店层' },
        ],
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

/**
 * Assembles the nested command payload from flat form values. Shapes the
 * caller should not have to know (trigger conditions, execution mode) are
 * derived here rather than typed by hand.
 */
function buildPayload(
  action: SkillAction,
  values: Record<string, string>
): Record<string, unknown> {
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
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('skills', 'skill_catalog_list', {
      tier: tierFilter,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillCatalogRow[]>(
        'skills',
        {
          action: 'skill_catalog_list',
          payload: tierFilter ? { tier: tierFilter } : {},
        },
        signal
      ),
  });

  const form = COMMAND_FORMS[action];

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = buildPayload(action, values);
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

  const rows = catalogQuery.data ?? [];
  const industry = rows.filter((row) => row.tier === 'industry');
  const corroborated = industry.filter((row) => row.sourceKind === 'induced');

  return (
    <div className="space-y-6" data-testid="admin-skills-control">
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>Skill 目录</AdminPanelTitle>
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
                <option value="store">门店层</option>
              </select>
            </div>
            {industry.length ? (
              <p className="pb-2 text-sm text-muted-foreground">
                行业层第二来源交叉验证占比：
                {Math.round((corroborated.length / industry.length) * 100)}%（
                {corroborated.length}/{industry.length}）
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
                    </TableCell>
                    <TableCell>{TIER_LABELS[row.tier] ?? row.tier}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.activeRevisionRef ?? '尚未受理'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.updatedAt}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                ) : (
                  <Input
                    id={`skills-field-${field.key}`}
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
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中…' : '提交受控命令'}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {result ? (
            <pre className="max-h-72 overflow-auto rounded-lg border p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}
