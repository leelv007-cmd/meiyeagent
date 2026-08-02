import { useQuery } from '@tanstack/react-query';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
} from '@/components/admin/shell/admin-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  admin_plan_credit_booster_unit_price_hint,
  admin_plan_credit_booster_unit_price_warning,
  admin_plan_credit_catalog_description,
  admin_plan_credit_catalog_title,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { p1QueryKeys } from '@/p1/query-keys';

export const CREDIT_PLAN_CONFIG_KEYS = [
  'plan.credits.trial',
  'plan.credits.starter',
  'plan.credits.growth',
  'plan.credits.pro',
  'plan.credits.addons',
  'plan.credits.cycle_coefficients',
  'plan.credits.trial.enabled',
] as const;

/**
 * Keep the pre-existing governed controls reachable while #311 owns their
 * retirement. This panel itself only adds the new credit-plan surface.
 */
export const PLAN_CONTROL_CONFIG_KEYS = [
  ...CREDIT_PLAN_CONFIG_KEYS,
  'harness.confirmation_card.hold_timeout_seconds',
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

interface AdminConfigItem {
  effectiveValue: unknown;
  key: string;
  storedValue: unknown;
}

interface CreditPlanValue {
  credits: number;
  monthlyPriceMicros: number;
}

interface CreditAddOnValue {
  amountMicros: number;
  credits: number;
}

function isCreditPlanValue(value: unknown): value is CreditPlanValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.credits === 'number' &&
    Number.isSafeInteger(plan.credits) &&
    plan.credits > 0 &&
    typeof plan.monthlyPriceMicros === 'number' &&
    Number.isSafeInteger(plan.monthlyPriceMicros) &&
    plan.monthlyPriceMicros >= 0
  );
}

function isCreditAddOnValue(value: unknown): value is CreditAddOnValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const addOn = value as Record<string, unknown>;
  return (
    typeof addOn.credits === 'number' &&
    Number.isSafeInteger(addOn.credits) &&
    addOn.credits > 0 &&
    typeof addOn.amountMicros === 'number' &&
    Number.isSafeInteger(addOn.amountMicros) &&
    addOn.amountMicros >= 0
  );
}

export function hasCreditBoosterUnitPriceWarning(
  configs: readonly AdminConfigItem[]
) {
  const planUnitPrices = configs
    .filter((item) =>
      [
        'plan.credits.starter',
        'plan.credits.growth',
        'plan.credits.pro',
      ].includes(item.key)
    )
    .map((item) => item.storedValue ?? item.effectiveValue)
    .filter(isCreditPlanValue)
    .map((plan) => plan.monthlyPriceMicros / plan.credits);
  const addOnItem = configs.find((item) => item.key === 'plan.credits.addons');
  const addOnValue = addOnItem?.storedValue ?? addOnItem?.effectiveValue;
  const addOns: CreditAddOnValue[] = Array.isArray(addOnValue)
    ? addOnValue.filter(isCreditAddOnValue)
    : [];
  const highestPlanUnitPrice = Math.max(...planUnitPrices);
  return (
    Number.isFinite(highestPlanUnitPrice) &&
    addOns.some(
      (addOn) => addOn.amountMicros / addOn.credits <= highestPlanUnitPrice
    )
  );
}

export function AdminPlanControl() {
  const configQuery = useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'config_list'),
    queryFn: ({ signal }) =>
      queryP1<AdminConfigItem[]>(
        'admin-config',
        { action: 'config_list', payload: {} },
        signal
      ),
  });
  const hasWarning = hasCreditBoosterUnitPriceWarning(configQuery.data ?? []);

  return (
    <div className="space-y-5">
      <Alert>
        <AlertTitle>{admin_plan_credit_catalog_title()}</AlertTitle>
        <AlertDescription>
          {admin_plan_credit_catalog_description()}
        </AlertDescription>
      </Alert>
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_plan_credit_catalog_title()}</AdminPanelTitle>
          <AdminPanelDescription data-testid="credit-booster-unit-price-hint">
            {hasWarning
              ? admin_plan_credit_booster_unit_price_warning()
              : admin_plan_credit_booster_unit_price_hint()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent>
          <AdminRuntimeConfigControl keys={[...PLAN_CONTROL_CONFIG_KEYS]} />
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}
