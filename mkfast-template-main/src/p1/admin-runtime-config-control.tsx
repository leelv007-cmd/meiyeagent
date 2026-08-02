import { IconRefresh, IconRestore, IconSettings } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
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
  admin_runtime_config_activation,
  admin_runtime_config_activation_configured,
  admin_runtime_config_activation_disabled,
  admin_runtime_config_activation_fixture,
  admin_runtime_config_activation_live,
  admin_runtime_config_activation_recorded,
  admin_runtime_config_activation_unknown,
  admin_runtime_config_actor,
  admin_runtime_config_apply_change,
  admin_runtime_config_apply_confirm,
  admin_runtime_config_apply_description,
  admin_runtime_config_apply_scope,
  admin_runtime_config_apply_success,
  admin_runtime_config_apply_title,
  admin_runtime_config_correlation,
  admin_runtime_config_current_effective,
  admin_runtime_config_edit_description,
  admin_runtime_config_edit_title,
  admin_runtime_config_effective,
  admin_runtime_config_history,
  admin_runtime_config_history_empty,
  admin_runtime_config_hot_read_description,
  admin_runtime_config_hot_read_effective,
  admin_runtime_config_key,
  admin_runtime_config_legacy_fallback_notice,
  admin_runtime_config_load_error,
  admin_runtime_config_not_set,
  admin_runtime_config_note_style_hot_read_description,
  admin_runtime_config_notice_description,
  admin_runtime_config_notice_title,
  admin_runtime_config_process_http,
  admin_runtime_config_process_worker,
  admin_runtime_config_reason,
  admin_runtime_config_refresh,
  admin_runtime_config_restart_pending,
  admin_runtime_config_revision,
  admin_runtime_config_rollback_change,
  admin_runtime_config_rollback_confirm,
  admin_runtime_config_rollback_description,
  admin_runtime_config_rollback_scope,
  admin_runtime_config_rollback_source,
  admin_runtime_config_rollback_success,
  admin_runtime_config_rollback_title,
  admin_runtime_config_save,
  admin_runtime_config_status_applied,
  admin_runtime_config_status_rolled_back,
  admin_runtime_config_stored,
  admin_runtime_config_time,
  admin_runtime_config_unwired,
  admin_runtime_config_validation_error,
  admin_runtime_config_value,
  admin_runtime_mode_missing_requirements,
} from '@/locale/paraglide/messages';
import {
  CREDIT_PLAN_CONFIG_KEYS,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  adminConfigKeyLabel,
  defaultAdminConfigValue,
  isInlineConfigKey,
} from '@/p1/admin-config-field-model';
import { AdminConfigForm } from '@/p1/admin-config-form';
import {
  formatAdminConfigValue,
  parseAdminConfigDraft,
  runtimeSnapshotStatus,
} from '@/p1/admin-config-view-model';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

interface AdminConfigItem {
  key: string;
  scope: 'global' | 'workspace';
  storedValue: unknown;
  effectiveValue: unknown;
  effectiveSnapshots?: Array<{
    bootedAt: string;
    effectiveValue: unknown;
    fallbackReason: string | null;
    processKind: 'http' | 'job-worker';
    source:
      | { source: 'db_revision'; revision: number }
      | { source: 'env_fallback' };
  }>;
  modeAvailability?: Array<{
    assemblable: boolean;
    missingRequirements: string[];
    value: string;
  }>;
  wired: boolean;
  activationEvidenceStatus: string | null;
  revision: number | null;
  status: 'applied' | 'rolled_back' | null;
  rolledBackToRevision: number | null;
  actorId: string | null;
  reason: string | null;
  correlationId: string | null;
  createdAt: string | null;
}

const HOT_READ_KEYS = new Set([
  // 笔记风格集合每次编译都现读，保存即生效——这里不登记，界面就会告诉运营
  // 「重启后生效」，与实际行为相反（D-116）。与 core 的 hotReadKeys 对齐。
  NOTE_STYLE_CONFIG_KEY,
  'harness.confirmation_card.hold_timeout_seconds',
  ...CREDIT_PLAN_CONFIG_KEYS,
  'plan.addons',
  'plan.allowances.trial',
  'plan.allowances.starter',
  'plan.allowances.growth',
  'plan.allowances.pro',
  'plan.payment-mapping',
  'platform.defaultModel.copy',
  'platform.defaultModel.image',
  'platform.defaultModel.video',
  'platform.defaultModel.audio',
  'compliance.watermark.default',
  'compliance.aigc_label.default',
  'compliance.regulated_mode.default',
]);

/**
 * 编辑器的起点：写过就从写过的那份开始，没写过就从此刻真正在用的那份开始。
 * 空着起步会让运营以为「现在什么都没有」，那是假的。
 */
function startingDraft(
  item: Pick<AdminConfigItem, 'effectiveValue' | 'key' | 'storedValue'>
) {
  const current = item.storedValue ?? item.effectiveValue;
  if (current !== null && current !== undefined) {
    return formatAdminConfigValue(current);
  }
  return formatAdminConfigValue(defaultAdminConfigValue(item.key));
}

export function adminConfigApplyRequest(
  item: Pick<AdminConfigItem, 'key' | 'revision'>,
  draft: string,
  reason: string
) {
  return {
    action: 'config_apply' as const,
    payload: {
      key: item.key,
      value: parseAdminConfigDraft(item.key, draft),
      expectedRevision: item.revision,
      reason,
    },
  };
}

function isCommerceKey(key: string) {
  return (
    key.startsWith('plan.credits.') ||
    key === 'plan.addons' ||
    key === 'plan.payment-mapping' ||
    key.startsWith('plan.allowances.')
  );
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) {
    return admin_runtime_config_not_set();
  }
  return formatAdminConfigValue(value).replace(/\s+/g, ' ');
}

function displayTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatLocaleDateTime(date);
}

function statusLabel(status: AdminConfigItem['status']) {
  if (status === 'rolled_back') {
    return admin_runtime_config_status_rolled_back();
  }
  if (status === 'applied') return admin_runtime_config_status_applied();
  return admin_runtime_config_not_set();
}

/**
 * 热加载这句话对每个键说的是同一件事，落到运营眼里却不是。
 * 讲套餐的那句「只影响新结账、新门店登记」，配在笔记风格上就答非所问——
 * 风格改完影响的是下一篇笔记怎么写，不是谁下一次付钱（D-116）。
 */
function hotReadDescription(key: string) {
  return key === NOTE_STYLE_CONFIG_KEY
    ? admin_runtime_config_note_style_hot_read_description()
    : admin_runtime_config_hot_read_description();
}

function wiringLabel(item: AdminConfigItem) {
  if (!item.wired) return admin_runtime_config_unwired();
  if (
    HOT_READ_KEYS.has(item.key) &&
    JSON.stringify(item.storedValue) === JSON.stringify(item.effectiveValue)
  ) {
    return admin_runtime_config_hot_read_effective();
  }
  if (item.effectiveSnapshots?.length) {
    return item.effectiveSnapshots.every(
      (snapshot) =>
        runtimeSnapshotStatus(item.storedValue, snapshot.effectiveValue) ===
        'current'
    )
      ? admin_runtime_config_current_effective()
      : admin_runtime_config_restart_pending();
  }
  return JSON.stringify(item.storedValue) ===
    JSON.stringify(item.effectiveValue)
    ? admin_runtime_config_current_effective()
    : admin_runtime_config_restart_pending();
}

function processLabel(processKind: 'http' | 'job-worker') {
  return processKind === 'http'
    ? admin_runtime_config_process_http()
    : admin_runtime_config_process_worker();
}

/**
 * 常驻展开那几项的当前值：正在编辑的那一项看草稿，其余看已存的值。
 * 草稿此刻还不合法（运营刚点开还没选完）就退回已存值，不让界面闪成空。
 */
function inlineValueOf(
  item: AdminConfigItem,
  selectedKey: string,
  draft: string
) {
  const stored = item.storedValue ?? item.effectiveValue;
  if (selectedKey !== item.key) return stored;
  try {
    return JSON.parse(draft) as unknown;
  } catch {
    return stored;
  }
}

/**
 * 选项在当下的运行时状态。契约只说得出「有哪些值」，说不出
 * 「哪个正在跑」「哪个因为缺凭据装不起来」——那些从配置行上读。
 */
function optionMetaOf(item: AdminConfigItem, optionValue: string) {
  const availability = item.modeAvailability?.find(
    (candidate) => candidate.value === optionValue
  );
  const effectiveProcesses =
    item.effectiveSnapshots?.filter(
      (snapshot) => snapshot.effectiveValue === optionValue
    ) ?? [];
  const chips =
    effectiveProcesses.length > 0
      ? effectiveProcesses.map(
          (snapshot) =>
            `${processLabel(snapshot.processKind)} · ${admin_runtime_config_current_effective()}`
        )
      : item.effectiveValue === optionValue
        ? [admin_runtime_config_current_effective()]
        : [];
  return {
    blockedReason:
      availability?.assemblable === false
        ? admin_runtime_mode_missing_requirements({
            requirements: availability.missingRequirements.join(', '),
          })
        : undefined,
    chips,
  };
}

function activationEvidenceLabel(status: string | null | undefined) {
  if (status === 'disabled') {
    return admin_runtime_config_activation_disabled();
  }
  if (status === 'recorded_only') {
    return admin_runtime_config_activation_recorded();
  }
  if (status === 'local_fixture_verified') {
    return admin_runtime_config_activation_fixture();
  }
  if (status === 'configured_unverified') {
    return admin_runtime_config_activation_configured();
  }
  if (status === 'live_verified') {
    return admin_runtime_config_activation_live();
  }
  return admin_runtime_config_activation_unknown();
}

export function AdminRuntimeConfigControl({
  keys,
}: {
  keys?: readonly string[];
} = {}) {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState('');
  const [draft, setDraft] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const listQuery = useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'config_list'),
    queryFn: ({ signal }) =>
      queryP1<AdminConfigItem[]>(
        'admin-config',
        { action: 'config_list', payload: {} },
        signal
      ),
  });
  const items = (listQuery.data ?? []).filter(
    (item) => !keys || keys.includes(item.key)
  );
  // 常驻展开还是藏在下拉后面，由字段树的形态决定（整项就是一个单选枚举的常驻），
  // 不再是一张硬编码键名清单——两条通道渲染的都是同一个 schema renderer。
  const selectableItems = items.filter((item) => isInlineConfigKey(item.key));
  const genericItems = items.filter((item) => !isInlineConfigKey(item.key));
  const activeGenericKey = genericItems.some((item) => item.key === selectedKey)
    ? selectedKey
    : selectableItems.length === 0
      ? (genericItems[0]?.key ?? '')
      : '';
  // 表单吃结构值，草稿仍以配置契约的规范 JSON 存放：写入路径一点没变。
  const draftValue = useMemo(() => {
    if (!activeGenericKey) return undefined;
    try {
      return JSON.parse(draft) as unknown;
    } catch {
      return defaultAdminConfigValue(activeGenericKey);
    }
  }, [activeGenericKey, draft]);
  const hotReadItem = items.find((item) => HOT_READ_KEYS.has(item.key));
  const hasCommerceConfig = items.some((item) => isCommerceKey(item.key));
  const selectedItem = useMemo(
    () => items.find((item) => item.key === selectedKey),
    [items, selectedKey]
  );
  const activeItem = selectedItem ?? items[0];
  const historyQuery = useQuery({
    enabled: selectedKey.length > 0,
    queryKey: p1QueryKeys.request('admin-config', 'config_history', {
      key: selectedKey,
    }),
    queryFn: ({ signal }) =>
      queryP1<AdminConfigItem[]>(
        'admin-config',
        { action: 'config_history', payload: { key: selectedKey } },
        signal
      ),
  });

  useEffect(() => {
    if (selectedKey || !items[0]) return;
    setSelectedKey(items[0].key);
    setDraft(startingDraft(items[0]));
  }, [items, selectedKey]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('admin-config'),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('entitlements'),
      }),
    ]);
  };

  const selectKey = (key: string) => {
    const item = items.find((candidate) => candidate.key === key);
    setSelectedKey(key);
    setDraft(item ? startingDraft(item) : '');
    setValidationError(undefined);
  };

  const reviewApply = () => {
    if (!activeItem) return;
    try {
      const sourceDraft =
        selectedKey.length > 0
          ? draft
          : formatAdminConfigValue(
              activeItem.storedValue ?? activeItem.effectiveValue
            );
      const value = parseAdminConfigDraft(activeItem.key, sourceDraft);
      setValidationError(undefined);
      setImpactReview({
        title: admin_runtime_config_apply_title(),
        description: HOT_READ_KEYS.has(activeItem.key)
          ? hotReadDescription(activeItem.key)
          : admin_runtime_config_apply_description(),
        scope: admin_runtime_config_apply_scope({ key: activeItem.key }),
        changes: [
          admin_runtime_config_apply_change({
            before: displayValue(activeItem.storedValue),
            after: displayValue(value),
          }),
          wiringLabel(activeItem),
        ],
        confirmLabel: admin_runtime_config_apply_confirm(),
        onConfirm: async (reason) => {
          const result = await commandP1<AdminConfigItem>(
            'admin-config',
            adminConfigApplyRequest(activeItem, sourceDraft, reason)
          );
          setDraft(formatAdminConfigValue(result.storedValue));
          await refresh();
          toast.success(admin_runtime_config_apply_success());
        },
      });
    } catch {
      setValidationError(admin_runtime_config_validation_error());
    }
  };

  const reviewRollback = (target: AdminConfigItem) => {
    if (!selectedItem?.revision || !target.revision) return;
    setImpactReview({
      title: admin_runtime_config_rollback_title(),
      description: admin_runtime_config_rollback_description(),
      scope: admin_runtime_config_rollback_scope({
        key: selectedItem.key,
        revision: target.revision,
      }),
      changes: [
        admin_runtime_config_rollback_change({
          revision: target.revision,
        }),
        wiringLabel(selectedItem),
      ],
      confirmLabel: admin_runtime_config_rollback_confirm(),
      onConfirm: async (reason) => {
        const result = await commandP1<AdminConfigItem>('admin-config', {
          action: 'config_rollback',
          payload: {
            key: selectedItem.key,
            targetRevision: target.revision,
            expectedRevision: selectedItem.revision,
            reason,
          },
        });
        setDraft(formatAdminConfigValue(result.storedValue));
        await refresh();
        toast.success(admin_runtime_config_rollback_success());
      },
    });
  };

  return (
    <div className="space-y-6">
      <Alert>
        <IconSettings />
        <AlertTitle>{admin_runtime_config_notice_title()}</AlertTitle>
        <AlertDescription>
          <div className="space-y-2">
            <p>{admin_runtime_config_notice_description()}</p>
            {hotReadItem ? <p>{hotReadDescription(hotReadItem.key)}</p> : null}
            {hasCommerceConfig ? (
              <p>{admin_runtime_config_legacy_fallback_notice()}</p>
            ) : null}
            <AdminStatusChip variant="outline">
              {admin_runtime_config_activation({
                status: activationEvidenceLabel(
                  items[0]?.activationEvidenceStatus
                ),
              })}
            </AdminStatusChip>
          </div>
        </AlertDescription>
      </Alert>
      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>{admin_runtime_config_load_error()}</AlertTitle>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={listQuery.isFetching}
          onClick={() => void refresh()}
          variant="outline"
        >
          <IconRefresh />
          {admin_runtime_config_refresh()}
        </Button>
      </div>
      <AdminPanel>
        <AdminPanelContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{admin_runtime_config_key()}</TableHead>
                <TableHead>{admin_runtime_config_stored()}</TableHead>
                <TableHead>{admin_runtime_config_effective()}</TableHead>
                <TableHead>{admin_runtime_config_revision()}</TableHead>
                <TableHead>{admin_runtime_config_actor()}</TableHead>
                <TableHead>{admin_runtime_config_time()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="font-mono text-xs">
                    {item.key}
                  </TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs">
                    {displayValue(item.storedValue)}
                  </TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs">
                    {item.effectiveSnapshots?.length ? (
                      <div className="flex flex-col items-start gap-1 font-sans">
                        {item.effectiveSnapshots.map((snapshot) => (
                          <div
                            className="flex flex-wrap items-center gap-1"
                            key={snapshot.processKind}
                          >
                            <AdminStatusChip variant="outline">
                              {processLabel(snapshot.processKind)}
                            </AdminStatusChip>
                            <span className="font-mono">
                              {displayValue(snapshot.effectiveValue)}
                            </span>
                            <AdminStatusChip variant="secondary">
                              {runtimeSnapshotStatus(
                                item.storedValue,
                                snapshot.effectiveValue
                              ) === 'current'
                                ? admin_runtime_config_current_effective()
                                : admin_runtime_config_restart_pending()}
                            </AdminStatusChip>
                            {snapshot.fallbackReason ? (
                              <span className="whitespace-normal text-destructive">
                                {snapshot.fallbackReason}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      displayValue(item.effectiveValue)
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <span>{item.revision ?? '—'}</span>
                      <AdminStatusChip variant="outline">
                        {statusLabel(item.status)}
                      </AdminStatusChip>
                      <AdminStatusChip variant="secondary">
                        {wiringLabel(item)}
                      </AdminStatusChip>
                    </div>
                  </TableCell>
                  <TableCell>{item.actorId ?? '—'}</TableCell>
                  <TableCell>{displayTime(item.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminPanelContent>
      </AdminPanel>
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_runtime_config_edit_title()}</AdminPanelTitle>
          <AdminPanelDescription>
            {admin_runtime_config_edit_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
          {selectableItems.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {selectableItems.map((item) => (
                <div
                  className="rounded-lg border p-4"
                  data-testid={`admin-runtime-config-inline-${item.key}`}
                  key={item.key}
                >
                  <AdminConfigForm
                    configKey={item.key}
                    onChange={(next) => {
                      setSelectedKey(item.key);
                      setDraft(formatAdminConfigValue(next));
                      setValidationError(undefined);
                    }}
                    optionMeta={(optionValue) =>
                      optionMetaOf(item, optionValue)
                    }
                    value={inlineValueOf(item, selectedKey, draft)}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {genericItems.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="admin-runtime-config-key">
                  {admin_runtime_config_key()}
                </Label>
                <select
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  id="admin-runtime-config-key"
                  onChange={(event) => selectKey(event.target.value)}
                  value={activeGenericKey}
                >
                  <option disabled value="" />
                  {genericItems.map((item) => (
                    <option key={item.key} value={item.key}>
                      {adminConfigKeyLabel(item.key)}
                    </option>
                  ))}
                </select>
              </div>
              {activeGenericKey ? (
                <div className="space-y-2" id="admin-runtime-config-value">
                  <p className="font-medium text-sm">
                    {admin_runtime_config_value()}
                  </p>
                  <AdminConfigForm
                    configKey={activeGenericKey}
                    onChange={(next) => {
                      setDraft(formatAdminConfigValue(next));
                      setValidationError(undefined);
                    }}
                    value={draftValue}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {validationError ? (
            <p className="text-sm text-destructive" role="alert">
              {validationError}
            </p>
          ) : null}
          <Button disabled={!activeItem} onClick={reviewApply}>
            {admin_runtime_config_save()}
          </Button>
        </AdminPanelContent>
      </AdminPanel>
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_runtime_config_history()}</AdminPanelTitle>
        </AdminPanelHeader>
        <AdminPanelContent>
          {(historyQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              {admin_runtime_config_history_empty()}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{admin_runtime_config_revision()}</TableHead>
                  <TableHead>{admin_runtime_config_stored()}</TableHead>
                  <TableHead>{admin_runtime_config_actor()}</TableHead>
                  <TableHead>{admin_runtime_config_reason()}</TableHead>
                  <TableHead>{admin_runtime_config_correlation()}</TableHead>
                  <TableHead>{admin_runtime_config_time()}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyQuery.data?.map((item) => (
                  <TableRow key={item.revision}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{item.revision}</span>
                        <AdminStatusChip variant="outline">
                          {statusLabel(item.status)}
                        </AdminStatusChip>
                        {item.rolledBackToRevision ? (
                          <span className="text-xs text-muted-foreground">
                            {admin_runtime_config_rollback_source({
                              revision: item.rolledBackToRevision,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-96 truncate font-mono text-xs">
                      {displayValue(item.storedValue)}
                    </TableCell>
                    <TableCell>{item.actorId ?? '—'}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      {item.reason ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.correlationId ?? '—'}
                    </TableCell>
                    <TableCell>{displayTime(item.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {item.revision !== selectedItem?.revision ? (
                        <Button
                          onClick={() => reviewRollback(item)}
                          size="sm"
                          variant="outline"
                        >
                          <IconRestore />
                          {admin_runtime_config_rollback_title()}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminPanelContent>
      </AdminPanel>
      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </div>
  );
}
