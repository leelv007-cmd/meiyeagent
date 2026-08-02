import { IconFilePlus } from '@tabler/icons-react';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  p1_admin_model_catalog_create_draft,
  p1_admin_model_catalog_validating,
  p1_admin_model_credit_pricing_cost,
  p1_admin_model_credit_pricing_description,
  p1_admin_model_credit_pricing_failure_refund,
  p1_admin_model_credit_pricing_title,
  p1_admin_model_credit_pricing_video_duration,
} from '@/locale/paraglide/messages';
import {
  CREDIT_PRICING_OPERATIONS,
  type AdminCatalogControl,
  type CreditPricingOperation,
} from '@/p1/admin-view-model';

export interface CreditPricingEntry {
  creditCost: number;
  failureRefundsCredits: boolean;
  videoCreditCosts?: Partial<Record<'15' | '30' | '60', number>>;
}

export type CreditPricingDraft = Partial<
  Record<CreditPricingOperation, CreditPricingEntry>
>;

export function replaceCatalogModelCreditPricing<
  T extends {
    models: ReadonlyArray<{
      creditPricing?: CreditPricingDraft;
      id: string;
    }>;
  },
>(catalog: T, modelId: string, creditPricing: CreditPricingDraft): T {
  let found = false;
  const models = catalog.models.map((model) => {
    if (model.id !== modelId) return model;
    found = true;
    return { ...model, creditPricing };
  });
  if (!found) throw new Error(`Catalog model ${modelId} does not exist.`);
  return { ...catalog, models } as T;
}

function isCreditPricingOperation(
  value: string
): value is CreditPricingOperation {
  return CREDIT_PRICING_OPERATIONS.includes(value as CreditPricingOperation);
}

function supportedPricingOperations(
  model: AdminCatalogControl['catalog']['models'][number]
) {
  const operations = model.operations.reduce<CreditPricingOperation[]>(
    (current, operation) => {
      if (isCreditPricingOperation(operation)) current.push(operation);
      return current;
    },
    []
  );
  if (
    model.operations.includes('image.edit') &&
    !operations.includes('image.reference_transform')
  ) {
    operations.push('image.reference_transform');
  }
  return operations;
}

function positiveInteger(value: FormDataEntryValue | null, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

function pricingFromForm(
  formData: FormData,
  modelId: string,
  operations: readonly CreditPricingOperation[]
): CreditPricingDraft {
  return Object.fromEntries(
    operations.map((operation) => {
      const creditCost = positiveInteger(
        formData.get(`${modelId}:${operation}:creditCost`),
        `${operation} credit cost`
      );
      const entry: CreditPricingEntry = {
        creditCost,
        failureRefundsCredits:
          formData.get(`${modelId}:${operation}:failureRefundsCredits`) ===
          'on',
      };
      if (operation === 'video.generate') {
        entry.videoCreditCosts = {
          '15': positiveInteger(
            formData.get(`${modelId}:${operation}:15`),
            '15 second video credit cost'
          ),
          '30': positiveInteger(
            formData.get(`${modelId}:${operation}:30`),
            '30 second video credit cost'
          ),
          '60': positiveInteger(
            formData.get(`${modelId}:${operation}:60`),
            '60 second video credit cost'
          ),
        };
      }
      return [operation, entry];
    })
  );
}

export function AdminModelCreditPricingControl({
  busy,
  catalog,
  onCreateDraft,
}: {
  busy: boolean;
  catalog: AdminCatalogControl['catalog'];
  onCreateDraft: (catalog: AdminCatalogControl['catalog']) => Promise<void>;
}) {
  return (
    <AdminPanel>
      <AdminPanelHeader>
        <AdminPanelTitle>
          {p1_admin_model_credit_pricing_title()}
        </AdminPanelTitle>
        <AdminPanelDescription>
          {p1_admin_model_credit_pricing_description()}
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent className="space-y-6">
        {catalog.models.map((model) => {
          const operations = supportedPricingOperations(model);
          if (operations.length === 0) return null;
          return (
            <form
              className="space-y-4 rounded-lg border p-4"
              key={model.id}
              onSubmit={(event) => {
                event.preventDefault();
                const creditPricing = pricingFromForm(
                  new FormData(event.currentTarget),
                  model.id,
                  operations
                );
                void onCreateDraft(
                  replaceCatalogModelCreditPricing(
                    catalog,
                    model.id,
                    creditPricing
                  )
                );
              }}
            >
              <h3 className="font-medium">{model.displayName}</h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {operations.map((operation) => {
                  const pricing = model.creditPricing?.[operation] as
                    | CreditPricingEntry
                    | undefined;
                  return (
                    <div
                      className="space-y-3 rounded-md bg-muted/30 p-3"
                      data-testid={`model-credit-pricing-${model.id}-${operation}`}
                      key={operation}
                    >
                      <p className="font-medium text-sm">{operation}</p>
                      <div className="space-y-2">
                        <Label htmlFor={`${model.id}-${operation}-credit-cost`}>
                          {p1_admin_model_credit_pricing_cost()}
                        </Label>
                        <Input
                          defaultValue={pricing?.creditCost ?? 1}
                          id={`${model.id}-${operation}-credit-cost`}
                          min={1}
                          name={`${model.id}:${operation}:creditCost`}
                          type="number"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          defaultChecked={
                            pricing?.failureRefundsCredits ?? true
                          }
                          name={`${model.id}:${operation}:failureRefundsCredits`}
                          type="checkbox"
                        />
                        {p1_admin_model_credit_pricing_failure_refund()}
                      </label>
                      {operation === 'video.generate' ? (
                        <div className="grid gap-3 sm:grid-cols-3">
                          {(['15', '30', '60'] as const).map((seconds) => (
                            <div className="space-y-2" key={seconds}>
                              <Label
                                htmlFor={`${model.id}-${operation}-${seconds}`}
                              >
                                {p1_admin_model_credit_pricing_video_duration({
                                  seconds,
                                })}
                              </Label>
                              <Input
                                defaultValue={
                                  pricing?.videoCreditCosts?.[seconds] ??
                                  pricing?.creditCost ??
                                  1
                                }
                                id={`${model.id}-${operation}-${seconds}`}
                                min={1}
                                name={`${model.id}:${operation}:${seconds}`}
                                type="number"
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <Button disabled={busy} type="submit">
                <IconFilePlus />
                {busy
                  ? p1_admin_model_catalog_validating()
                  : p1_admin_model_catalog_create_draft()}
              </Button>
            </form>
          );
        })}
      </AdminPanelContent>
    </AdminPanel>
  );
}
