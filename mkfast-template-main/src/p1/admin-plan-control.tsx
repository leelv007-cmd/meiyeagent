import { zodResolver } from '@hookform/resolvers/zod';
import { IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  admin_plan_add_on_currency,
  admin_plan_add_on_price,
  admin_plan_add_ons,
  admin_plan_advanced_config,
  admin_plan_aigc_default,
  admin_plan_apply_change,
  admin_plan_apply_confirm,
  admin_plan_apply_description,
  admin_plan_apply_scope,
  admin_plan_apply_success,
  admin_plan_audio,
  admin_plan_audio_quantity,
  admin_plan_catalog_description,
  admin_plan_catalog_error,
  admin_plan_catalog_error_description,
  admin_plan_catalog_title,
  admin_plan_compliance_description,
  admin_plan_compliance_title,
  admin_plan_concurrency,
  admin_plan_config_unavailable,
  admin_plan_copy,
  admin_plan_copy_quantity,
  admin_plan_edit_plan,
  admin_plan_expire_days,
  admin_plan_image,
  admin_plan_image_quantity,
  admin_plan_partial_wiring,
  admin_plan_priority_support,
  admin_plan_published,
  admin_plan_queue_priority,
  admin_plan_refresh,
  admin_plan_regulated_default,
  admin_plan_revision_meta,
  admin_plan_save_add_on,
  admin_plan_save_plan,
  admin_plan_standard_support,
  admin_plan_summary,
  admin_plan_support,
  admin_plan_trial_description,
  admin_plan_trial_enabled,
  admin_plan_validation_currency,
  admin_plan_validation_nonnegative,
  admin_plan_validation_positive,
  admin_plan_video,
  admin_plan_video_quantity,
  admin_plan_watermark_default,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import {
  MAX_ADD_ON_AMOUNT_MICROS,
  MAX_PLAN_CONCURRENCY,
  MAX_PLAN_RESOURCE_ALLOWANCE,
  MAX_QUEUE_PRIORITY,
} from '@/p1/admin-config-view-model';

type PlanId = 'trial' | 'starter' | 'growth' | 'pro';
type ComplianceKey =
  | 'compliance.watermark.default'
  | 'compliance.aigc_label.default'
  | 'compliance.regulated_mode.default';

interface PlanOffer {
  allowance: { audio: number; copy: number; image: number; video: number };
  concurrencyLimit: number;
  expireDays?: number;
  id: PlanId;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

interface AddOnOffer {
  amountMicros: number;
  currency: string;
  id: string;
  quantity: number;
  resource: 'copy' | 'image' | 'video' | 'audio';
}

interface PlanCatalog {
  addOns: AddOnOffer[];
  mode: 'disabled' | 'recorded';
  plans: PlanOffer[];
  trialEnabled: boolean;
}

interface AdminConfigItem {
  actorId: string | null;
  createdAt: string | null;
  effectiveValue: unknown;
  key: string;
  revision: number | null;
  storedValue: unknown;
}

const CONFIG_KEYS = [
  'plan.trial.enabled',
  'plan.allowances.trial',
  'plan.allowances.starter',
  'plan.allowances.growth',
  'plan.allowances.pro',
  'plan.addons',
  'plan.payment-mapping',
  'compliance.watermark.default',
  'compliance.aigc_label.default',
  'compliance.regulated_mode.default',
] as const;

const nonnegativeInteger = z
  .number()
  .int()
  .nonnegative(admin_plan_validation_nonnegative())
  .max(MAX_PLAN_RESOURCE_ALLOWANCE);
const planFormSchema = z.object({
  allowance: z.object({
    audio: nonnegativeInteger,
    copy: nonnegativeInteger,
    image: nonnegativeInteger,
    video: nonnegativeInteger,
  }),
  concurrencyLimit: z
    .number()
    .int()
    .positive(admin_plan_validation_positive())
    .max(MAX_PLAN_CONCURRENCY),
  expireDays: z.number().int().positive().max(366).optional(),
  queuePriority: z
    .number()
    .int()
    .positive(admin_plan_validation_positive())
    .max(MAX_QUEUE_PRIORITY),
  supportLabel: z.enum(['standard', 'priority']),
});
const addOnPriceSchema = z.object({
  amount: z
    .number()
    .nonnegative(admin_plan_validation_nonnegative())
    .max(MAX_ADD_ON_AMOUNT_MICROS / 1_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/u, admin_plan_validation_currency()),
});

type PlanFormValues = z.infer<typeof planFormSchema>;
type AddOnPriceValues = z.infer<typeof addOnPriceSchema>;

export function adminPlanConfigApplyRequest(
  item: Pick<AdminConfigItem, 'key' | 'revision'>,
  value: unknown,
  reason: string
) {
  return {
    action: 'config_apply' as const,
    payload: {
      expectedRevision: item.revision,
      key: item.key,
      reason,
      value,
    },
  };
}

export function replaceAddOnPrice(
  offers: AddOnOffer[],
  offerId: string,
  price: Pick<AddOnOffer, 'amountMicros' | 'currency'>
) {
  return offers.map((offer) =>
    offer.id === offerId ? { ...offer, ...price } : offer
  );
}

function storedPlan(item: AdminConfigItem | undefined, fallback: PlanOffer) {
  const parsed = planFormSchema.safeParse(item?.storedValue);
  return planEditorConfigValue(
    fallback.id,
    parsed.success ? parsed.data : fallback
  );
}

export function planEditorConfigValue(planId: PlanId, value: PlanFormValues) {
  if (planId === 'trial') return value;
  const { expireDays: _expireDays, ...calendarMonthValue } = value;
  return calendarMonthValue;
}

function storedAddOns(
  item: AdminConfigItem | undefined,
  fallback: AddOnOffer[]
) {
  return Array.isArray(item?.storedValue)
    ? (item.storedValue as AddOnOffer[])
    : fallback;
}

function auditMeta(item: AdminConfigItem | undefined) {
  if (!item) return admin_plan_config_unavailable();
  const createdAt = item.createdAt ? new Date(item.createdAt) : undefined;
  return admin_plan_revision_meta({
    actor: item.actorId ?? '—',
    revision: item.revision ?? 0,
    time:
      createdAt && !Number.isNaN(createdAt.getTime())
        ? formatLocaleDateTime(createdAt)
        : '—',
  });
}

function PlanEditor({
  config,
  onReview,
  plan,
}: {
  config?: AdminConfigItem;
  onReview: (item: AdminConfigItem, value: unknown, label: string) => void;
  plan: PlanOffer;
}) {
  const form = useForm<PlanFormValues>({
    defaultValues: storedPlan(config, plan),
    resolver: zodResolver(planFormSchema),
  });
  useEffect(() => {
    form.reset(storedPlan(config, plan));
  }, [config, form, plan]);
  const field = (
    name:
      | 'allowance.copy'
      | 'allowance.image'
      | 'allowance.video'
      | 'allowance.audio'
      | 'concurrencyLimit'
      | 'queuePriority',
    label: string,
    id: string
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        max={
          name === 'concurrencyLimit'
            ? MAX_PLAN_CONCURRENCY
            : name === 'queuePriority'
              ? MAX_QUEUE_PRIORITY
              : MAX_PLAN_RESOURCE_ALLOWANCE
        }
        min={name === 'concurrencyLimit' || name === 'queuePriority' ? 1 : 0}
        type="number"
        {...form.register(name, { valueAsNumber: true })}
      />
    </div>
  );
  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={form.handleSubmit((value) => {
        if (config) {
          onReview(config, planEditorConfigValue(plan.id, value), plan.id);
        }
      })}
    >
      <p className="font-medium">{admin_plan_edit_plan({ plan: plan.id })}</p>
      <div className="grid grid-cols-2 gap-3">
        {field('allowance.copy', admin_plan_copy(), `plan-${plan.id}-copy`)}
        {field('allowance.image', admin_plan_image(), `plan-${plan.id}-image`)}
        {field('allowance.video', admin_plan_video(), `plan-${plan.id}-video`)}
        {field('allowance.audio', admin_plan_audio(), `plan-${plan.id}-audio`)}
        {field(
          'concurrencyLimit',
          admin_plan_concurrency(),
          `plan-${plan.id}-concurrency`
        )}
        {field(
          'queuePriority',
          admin_plan_queue_priority(),
          `plan-${plan.id}-priority`
        )}
        {plan.id === 'trial' ? (
          <div className="space-y-1.5">
            <Label htmlFor="plan-trial-expire-days">
              {admin_plan_expire_days()}
            </Label>
            <Input
              id="plan-trial-expire-days"
              max={366}
              min={1}
              type="number"
              {...form.register('expireDays', { valueAsNumber: true })}
            />
          </div>
        ) : null}
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`plan-${plan.id}-support`}>
            {admin_plan_support()}
          </Label>
          <select
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            id={`plan-${plan.id}-support`}
            {...form.register('supportLabel')}
          >
            <option value="standard">{admin_plan_standard_support()}</option>
            <option value="priority">{admin_plan_priority_support()}</option>
          </select>
        </div>
      </div>
      {Object.values(form.formState.errors).length > 0 ? (
        <p className="text-xs text-destructive" role="alert">
          {admin_plan_validation_nonnegative()}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{auditMeta(config)}</p>
      <Button disabled={!config} size="sm" type="submit">
        {admin_plan_save_plan()}
      </Button>
    </form>
  );
}

function AddOnPriceEditor({
  allOffers,
  config,
  offer,
  onReview,
}: {
  allOffers: AddOnOffer[];
  config?: AdminConfigItem;
  offer: AddOnOffer;
  onReview: (item: AdminConfigItem, value: unknown, label: string) => void;
}) {
  const form = useForm<AddOnPriceValues>({
    defaultValues: {
      amount: offer.amountMicros / 1_000_000,
      currency: offer.currency,
    },
    resolver: zodResolver(addOnPriceSchema),
  });
  useEffect(() => {
    form.reset({
      amount: offer.amountMicros / 1_000_000,
      currency: offer.currency,
    });
  }, [form, offer]);
  return (
    <form
      className="mt-3 grid grid-cols-2 gap-2 border-t pt-3"
      onSubmit={form.handleSubmit((value) => {
        if (!config) return;
        onReview(
          config,
          replaceAddOnPrice(allOffers, offer.id, {
            amountMicros: Math.round(value.amount * 1_000_000),
            currency: value.currency,
          }),
          offer.id
        );
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`addon-${offer.id}-price`}>
          {admin_plan_add_on_price()}
        </Label>
        <Input
          id={`addon-${offer.id}-price`}
          max={MAX_ADD_ON_AMOUNT_MICROS / 1_000_000}
          min={0}
          step="0.01"
          type="number"
          {...form.register('amount', { valueAsNumber: true })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`addon-${offer.id}-currency`}>
          {admin_plan_add_on_currency()}
        </Label>
        <Input
          id={`addon-${offer.id}-currency`}
          maxLength={3}
          {...form.register('currency')}
        />
      </div>
      <p className="col-span-2 text-xs text-muted-foreground">
        {auditMeta(config)}
      </p>
      <Button className="col-span-2" disabled={!config} size="sm" type="submit">
        {admin_plan_save_add_on()}
      </Button>
    </form>
  );
}

function ComplianceToggle({
  config,
  fallbackChecked = false,
  id,
  label,
  onReview,
}: {
  config?: AdminConfigItem;
  fallbackChecked?: boolean;
  id: string;
  label: string;
  onReview: (item: AdminConfigItem, value: unknown, label: string) => void;
}) {
  const checked = Boolean(
    config?.storedValue ?? config?.effectiveValue ?? fallbackChecked
  );
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {auditMeta(config)}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={!config}
        id={id}
        onCheckedChange={(value) => {
          if (config) onReview(config, value, label);
        }}
      />
    </div>
  );
}

export function AdminPlanControl() {
  const queryClient = useQueryClient();
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'catalog'),
    queryFn: ({ signal }) =>
      queryP1<PlanCatalog>(
        'entitlements',
        { action: 'catalog', payload: {} },
        signal
      ),
  });
  const configQuery = useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'config_list'),
    queryFn: ({ signal }) =>
      queryP1<AdminConfigItem[]>(
        'admin-config',
        { action: 'config_list', payload: {} },
        signal
      ),
  });
  const configFor = (key: string) =>
    configQuery.data?.find((item) => item.key === key);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('admin-config'),
      }),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('entitlements'),
      }),
    ]);
  const reviewChange = (
    item: AdminConfigItem,
    value: unknown,
    label: string
  ) => {
    setImpactReview({
      changes: [
        admin_plan_apply_change({
          after: JSON.stringify(value),
          before: JSON.stringify(item.storedValue),
        }),
      ],
      confirmLabel: admin_plan_apply_confirm(),
      description: admin_plan_apply_description(),
      onConfirm: async (reason) => {
        await commandP1(
          'admin-config',
          adminPlanConfigApplyRequest(item, value, reason)
        );
        await refresh();
        toast.success(admin_plan_apply_success());
      },
      scope: admin_plan_apply_scope({ key: item.key }),
      title: label,
    });
  };
  const addOnConfig = configFor('plan.addons');
  const trialEnabledConfig = configFor(TRIAL_ENABLED_KEY);
  const allAddOns = storedAddOns(addOnConfig, catalogQuery.data?.addOns ?? []);
  const compliance: Array<{
    id: string;
    key: ComplianceKey;
    label: string;
  }> = [
    {
      id: 'compliance-watermark-default',
      key: 'compliance.watermark.default',
      label: admin_plan_watermark_default(),
    },
    {
      id: 'compliance-aigc-label-default',
      key: 'compliance.aigc_label.default',
      label: admin_plan_aigc_default(),
    },
    {
      id: 'compliance-regulated-mode-default',
      key: 'compliance.regulated_mode.default',
      label: admin_plan_regulated_default(),
    },
  ];

  return (
    <div className="space-y-5">
      <Alert>
        <IconShieldCheck />
        <AlertTitle>{admin_plan_catalog_title()}</AlertTitle>
        <AlertDescription>{admin_plan_catalog_description()}</AlertDescription>
      </Alert>
      <Alert>
        <IconShieldCheck />
        <AlertTitle>{admin_plan_partial_wiring()}</AlertTitle>
        <AlertDescription>{admin_plan_apply_description()}</AlertDescription>
      </Alert>
      {catalogQuery.error || configQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>{admin_plan_catalog_error()}</AlertTitle>
          <AlertDescription>
            {admin_plan_catalog_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={catalogQuery.isFetching || configQuery.isFetching}
          onClick={() => void refresh()}
          variant="outline"
        >
          <IconRefresh />
          {admin_plan_refresh()}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {(catalogQuery.data?.plans ?? []).map((plan) => (
          <AdminPanel key={plan.id}>
            <AdminPanelHeader>
              <div className="flex w-full items-center justify-between gap-3">
                <AdminPanelTitle className="capitalize">
                  {plan.id}
                </AdminPanelTitle>
                <AdminStatusChip variant="outline">
                  {admin_plan_published()}
                </AdminStatusChip>
              </div>
            </AdminPanelHeader>
            <AdminPanelContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{admin_plan_copy()}</dt>
                  <dd className="font-semibold">
                    {admin_plan_copy_quantity({ count: plan.allowance.copy })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_audio()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_audio_quantity({ count: plan.allowance.audio })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_image()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_image_quantity({ count: plan.allowance.image })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_video()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_video_quantity({ count: plan.allowance.video })}
                  </dd>
                </div>
              </dl>
              <p className="border-t pt-3 text-muted-foreground">
                {admin_plan_summary({
                  concurrency: plan.concurrencyLimit,
                  priority: plan.queuePriority,
                  support:
                    plan.supportLabel === 'priority'
                      ? admin_plan_priority_support()
                      : admin_plan_standard_support(),
                })}
              </p>
              <PlanEditor
                config={configFor(`plan.allowances.${plan.id}`)}
                onReview={reviewChange}
                plan={plan}
              />
            </AdminPanelContent>
          </AdminPanel>
        ))}
      </div>
      <AdminPanel data-testid="admin-plan-trial-switch">
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_plan_trial_enabled()}</AdminPanelTitle>
          <AdminPanelDescription>
            {admin_plan_trial_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent>
          <ComplianceToggle
            config={configFor('plan.trial.enabled')}
            fallbackChecked={catalogQuery.data?.trialEnabled ?? true}
            id="plan-trial-enabled"
            label={admin_plan_trial_enabled()}
            onReview={reviewChange}
          />
        </AdminPanelContent>
      </AdminPanel>
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_plan_add_ons()}</AdminPanelTitle>
        </AdminPanelHeader>
        <AdminPanelContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(catalogQuery.data?.addOns ?? []).map((offer) => (
              <li className="rounded-lg border p-3 text-sm" key={offer.id}>
                <p className="font-medium">{offer.id}</p>
                <p className="mt-1 text-muted-foreground">
                  {offer.resource === 'copy'
                    ? admin_plan_copy()
                    : offer.resource === 'image'
                      ? admin_plan_image()
                      : offer.resource === 'video'
                        ? admin_plan_video()
                        : admin_plan_audio()}{' '}
                  +{offer.quantity} ·{' '}
                  {(offer.amountMicros / 1_000_000).toFixed(2)} {offer.currency}
                </p>
                <AddOnPriceEditor
                  allOffers={allAddOns}
                  config={addOnConfig}
                  offer={offer}
                  onReview={reviewChange}
                />
              </li>
            ))}
          </ul>
        </AdminPanelContent>
      </AdminPanel>
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_plan_compliance_title()}</AdminPanelTitle>
          <AdminPanelDescription>
            {admin_plan_compliance_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="grid gap-3 lg:grid-cols-3">
          {compliance.map((item) => (
            <ComplianceToggle
              config={configFor(item.key)}
              id={item.id}
              key={item.key}
              label={item.label}
              onReview={reviewChange}
            />
          ))}
        </AdminPanelContent>
      </AdminPanel>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          {admin_plan_advanced_config()}
        </summary>
        <div className="mt-4">
          <AdminRuntimeConfigControl keys={[...CONFIG_KEYS]} />
        </div>
      </details>
      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </div>
  );
}
