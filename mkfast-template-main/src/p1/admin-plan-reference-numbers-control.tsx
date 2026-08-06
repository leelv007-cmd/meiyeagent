import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import { SettingField } from '@/components/admin/shared/setting-field';
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
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  normalizeAdminCatalogControl,
  type AdminCatalogControl,
} from '@/p1/admin-view-model';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

const REFERENCE_NUMBERS_KEY = 'plan.credits.reference_numbers';
export const MODEL_CATALOG_REFRESH_MS = 5_000;
const planIds = ['trial', 'starter', 'growth', 'pro'] as const;
const categories = ['copy', 'image', 'video'] as const;

type PlanId = (typeof planIds)[number];
type ReferenceCategory = (typeof categories)[number];
type ReferenceOutputs = Record<ReferenceCategory, number>;

interface ReferenceNumbers {
  published: Record<PlanId, ReferenceOutputs>;
  referenceModels: Record<ReferenceCategory, string>;
}

interface AdminConfigItem {
  effectiveValue: unknown;
  key: string;
  revision: number | null;
  storedValue: unknown;
}

interface PlanCredits {
  credits: number;
  id: PlanId;
}

function isReferenceNumbers(value: unknown): value is ReferenceNumbers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!record.referenceModels || !record.published) return false;
  const models = record.referenceModels as Record<string, unknown>;
  const published = record.published as Record<string, unknown>;
  return (
    categories.every(
      (category) =>
        typeof models[category] === 'string' && models[category].trim() !== ''
    ) &&
    planIds.every((planId) => {
      const outputs = published[planId];
      if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
        return false;
      }
      const values = outputs as Record<string, unknown>;
      return categories.every(
        (category) =>
          typeof values[category] === 'number' &&
          Number.isSafeInteger(values[category]) &&
          values[category] >= 0
      );
    })
  );
}

function planCredits(items: readonly AdminConfigItem[]) {
  return planIds.flatMap((id) => {
    const item = items.find(
      (candidate) => candidate.key === `plan.credits.${id}`
    );
    const value = item?.storedValue ?? item?.effectiveValue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const credits = (value as Record<string, unknown>).credits;
    if (!Number.isSafeInteger(credits) || typeof credits !== 'number')
      return [];
    return [{ credits, id } satisfies PlanCredits];
  });
}

function operationFor(category: ReferenceCategory) {
  if (category === 'copy') return 'copy.generate';
  if (category === 'image') return 'image.generate';
  return 'video.generate';
}

function modelCost(
  model: AdminCatalogControl['catalog']['models'][number] | undefined,
  category: ReferenceCategory
) {
  const pricing = model?.creditPricing?.[operationFor(category)];
  if (!pricing) return null;
  if (category === 'video') return pricing.videoCreditCosts?.['15'] ?? null;
  return pricing.creditCost;
}

export function suggestedReferenceOutputs(
  referenceNumbers: ReferenceNumbers,
  plans: readonly PlanCredits[],
  models: readonly AdminCatalogControl['catalog']['models'][number][]
) {
  const suggestions = {} as Record<PlanId, ReferenceOutputs>;
  for (const plan of plans) {
    const outputs = {} as ReferenceOutputs;
    for (const category of categories) {
      const model = models.find(
        (candidate) =>
          candidate.id === referenceNumbers.referenceModels[category]
      );
      const cost = modelCost(model, category);
      if (!cost || cost < 1)
        throw new Error(
          `${category} reference model has no valid credit price.`
        );
      outputs[category] = Math.floor(plan.credits / cost);
    }
    suggestions[plan.id] = outputs;
  }
  return suggestions;
}

export function referenceStatus(published: number, suggested: number) {
  if (published === suggested) return '一致';
  if (suggested === 0) return '偏离 —';
  return `偏离 ${Math.round((Math.abs(published - suggested) / suggested) * 100)}%`;
}

function categoryLabel(category: ReferenceCategory) {
  return category === 'copy'
    ? '文案'
    : category === 'image'
      ? '图片'
      : '视频（15 秒）';
}

function updatePublished(
  draft: ReferenceNumbers,
  planId: PlanId,
  category: ReferenceCategory,
  value: number
) {
  return {
    ...draft,
    published: {
      ...draft.published,
      [planId]: { ...draft.published[planId], [category]: value },
    },
  };
}

export function AdminPlanReferenceNumbersControl() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ReferenceNumbers>();
  const [error, setError] = useState<string>();
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const configQuery = useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'config_list'),
    queryFn: ({ signal }) =>
      queryP1<AdminConfigItem[]>(
        'admin-config',
        { action: 'config_list', payload: {} },
        signal
      ),
  });
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'admin_catalog_control'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'admin_catalog_control', payload: {} },
        signal
      ),
    refetchInterval: MODEL_CATALOG_REFRESH_MS,
    refetchIntervalInBackground: true,
    select: normalizeAdminCatalogControl,
  });
  const items = configQuery.data ?? [];
  const referenceItem = items.find(
    (item) => item.key === REFERENCE_NUMBERS_KEY
  );
  const stored = referenceItem?.storedValue ?? referenceItem?.effectiveValue;
  const plans = useMemo(() => planCredits(items), [items]);

  useEffect(() => {
    if (!isReferenceNumbers(stored)) return;
    setDraft(structuredClone(stored));
  }, [referenceItem?.revision, stored]);

  const models = catalogQuery.data?.catalog.models ?? [];
  const suggestions = useMemo(() => {
    if (!draft || plans.length !== planIds.length) return null;
    try {
      return suggestedReferenceOutputs(draft, plans, models);
    } catch {
      return null;
    }
  }, [draft, models, plans]);

  const publish = () => {
    if (!draft || !referenceItem?.revision || !suggestions) {
      setError('参考模型或套餐积分尚未准备好，不能发布。');
      return;
    }
    const published = structuredClone(draft);
    setImpactReview({
      changes: ['前台价格页只会读取此次确认的已发布参考数字。'],
      confirmLabel: '确认发布',
      description: '建议数字只是后台草稿；确认后才会替换前台已发布数字。',
      scope: REFERENCE_NUMBERS_KEY,
      title: '确认发布参考数字',
      onConfirm: async (reason) => {
        await commandP1('admin-config', {
          action: 'config_apply',
          payload: {
            expectedRevision: referenceItem.revision,
            key: REFERENCE_NUMBERS_KEY,
            reason,
            value: published,
          },
        });
        await queryClient.invalidateQueries({
          queryKey: p1QueryKeys.module('admin-config'),
        });
      },
    });
  };

  if (!draft || !referenceItem || plans.length !== planIds.length) {
    return (
      <Frame
        className="w-full"
        data-testid="admin-plan-reference-numbers"
        dense
      >
        <FrameHeader>
          <FrameTitle>价格页参考数字</FrameTitle>
          <FrameDescription>正在读取已发布的参考数字配置。</FrameDescription>
        </FrameHeader>
      </Frame>
    );
  }

  return (
    <div className="space-y-5" data-testid="admin-plan-reference-numbers">
      <Frame className="w-full" dense>
        <FrameHeader>
          <FrameTitle>价格页参考数字</FrameTitle>
          <FrameDescription>
            建议值按套餐月积分与参考模型积分价实时换算；前台只读取确认发布后的数字。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0">
          <FieldGroup className="gap-0">
            {categories.map((category, index) => (
              <SettingField
                key={category}
                labelFor={`reference-model-${category}`}
                last={index === categories.length - 1}
                title={`${categoryLabel(category)}参考模型`}
              >
                <select
                  className="h-touch-target w-full rounded-lg border border-divider bg-surface-1 px-2.5 text-sm"
                  id={`reference-model-${category}`}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      referenceModels: {
                        ...draft.referenceModels,
                        [category]: event.target.value,
                      },
                    });
                    setError(undefined);
                  }}
                  value={draft.referenceModels[category]}
                >
                  {models
                    .filter((model) =>
                      model.operations.includes(operationFor(category))
                    )
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                </select>
              </SettingField>
            ))}
          </FieldGroup>
        </FramePanel>
        <FramePanel className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>套餐</TableHead>
                {categories.map((category) => (
                  <TableHead key={`${category}-suggestion`}>
                    {categoryLabel(category)}建议值
                  </TableHead>
                ))}
                {categories.map((category) => (
                  <TableHead key={`${category}-published`}>
                    {categoryLabel(category)}已发布值
                  </TableHead>
                ))}
                {categories.map((category) => (
                  <TableHead key={`${category}-status`}>
                    {categoryLabel(category)}状态
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>{plan.id}</TableCell>
                  {categories.map((category) => (
                    <TableCell
                      data-testid={`reference-suggestion-${plan.id}-${category}`}
                      key={`${category}-suggestion`}
                    >
                      {suggestions?.[plan.id]?.[category] ?? '—'}
                    </TableCell>
                  ))}
                  {categories.map((category) => (
                    <TableCell key={`${category}-published`}>
                      <Input
                        data-testid={`reference-published-${plan.id}-${category}`}
                        min={0}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setDraft(
                            updatePublished(
                              draft,
                              plan.id,
                              category,
                              Number.isSafeInteger(value) && value >= 0
                                ? value
                                : 0
                            )
                          );
                          setError(undefined);
                        }}
                        type="number"
                        value={draft.published[plan.id][category]}
                      />
                    </TableCell>
                  ))}
                  {categories.map((category) => {
                    const status = suggestions
                      ? referenceStatus(
                          draft.published[plan.id][category],
                          suggestions[plan.id][category]
                        )
                      : '参考模型不可用';
                    return (
                      <TableCell
                        data-testid={`reference-status-${plan.id}-${category}`}
                        key={`${category}-status`}
                      >
                        <Badge
                          variant={
                            suggestions
                              ? status === '一致'
                                ? 'success-light'
                                : 'warning-light'
                              : 'secondary'
                          }
                        >
                          {status}
                        </Badge>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
        <FrameFooter className="flex flex-row justify-end gap-3">
          <div className="mr-auto flex flex-col justify-center gap-1 text-destructive text-sm">
            {suggestions ? null : (
              <p role="alert">
                所选参考模型必须有对应的已发布积分价；视频固定读取 15 秒档。
              </p>
            )}
            {error ? <p role="alert">{error}</p> : null}
          </div>
          <Button
            disabled={!suggestions}
            onClick={() => {
              if (!suggestions) return;
              setDraft({ ...draft, published: suggestions });
              setError(undefined);
            }}
            type="button"
            variant="outline"
          >
            全部采用建议值
          </Button>
          <Button disabled={!suggestions} onClick={publish} type="button">
            确认发布
          </Button>
        </FrameFooter>
      </Frame>
      <ImpactReviewDialog
        onOpenChange={(open) => {
          if (!open) setImpactReview(undefined);
        }}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </div>
  );
}
