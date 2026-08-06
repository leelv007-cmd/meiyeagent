import { useQuery } from '@tanstack/react-query';
import { CREDIT_PLAN_CONFIG_KEYS } from '@meiye/contracts';

import { SettingField } from '@/components/admin/shared/setting-field';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { FieldGroup } from '@/components/ui/field';
import {
  admin_plan_add_ons,
  admin_plan_add_ons_needs_review,
  admin_plan_add_ons_pricing_ok,
  admin_plan_credit_booster_unit_price_hint,
  admin_plan_credit_booster_unit_price_warning,
  admin_plan_credit_catalog_description,
  admin_plan_credit_catalog_title,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { AdminPlanReferenceNumbersControl } from '@/p1/admin-plan-reference-numbers-control';
import { p1QueryKeys } from '@/p1/query-keys';

/** Re-export contracts authority — no local handwritten key list (Spec G / #390). */
export { CREDIT_PLAN_CONFIG_KEYS };

/**
 * Credit-plan catalogue plus non-billing governed plan controls.
 * Pre-credit multi-bucket plan dials are retired (#311) — do not re-add them.
 * `plan.credits.*` keys come only from @meiye/contracts.
 */
export const PLAN_CONTROL_CONFIG_KEYS = [
  ...CREDIT_PLAN_CONFIG_KEYS,
  'harness.confirmation_card.hold_timeout_seconds',
  'plan.trial.enabled',
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
      <Frame className="w-full" dense>
        <FrameHeader>
          <FrameTitle>{admin_plan_credit_catalog_title()}</FrameTitle>
          <FrameDescription>
            {admin_plan_credit_catalog_description()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0">
          <FieldGroup className="gap-0">
            <SettingField
              badge={
                hasWarning
                  ? {
                      label: admin_plan_add_ons_needs_review(),
                      variant: 'warning-light',
                    }
                  : {
                      label: admin_plan_add_ons_pricing_ok(),
                      variant: 'success-light',
                    }
              }
              contentClassName="@md/field-group:w-[26rem]"
              last
              title={admin_plan_add_ons()}
            >
              <p
                className="text-muted-foreground text-sm"
                data-testid="credit-booster-unit-price-hint"
              >
                {hasWarning
                  ? admin_plan_credit_booster_unit_price_warning()
                  : admin_plan_credit_booster_unit_price_hint()}
              </p>
            </SettingField>
          </FieldGroup>
        </FramePanel>
      </Frame>
      <AdminRuntimeConfigControl keys={[...PLAN_CONTROL_CONFIG_KEYS]} />
      <AdminPlanReferenceNumbersControl />
    </div>
  );
}
