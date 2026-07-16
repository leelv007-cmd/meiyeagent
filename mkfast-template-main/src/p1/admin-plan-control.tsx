import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  admin_plan_add_ons,
  admin_plan_audio,
  admin_plan_audio_quantity,
  admin_plan_catalog_description,
  admin_plan_catalog_error,
  admin_plan_catalog_error_description,
  admin_plan_catalog_title,
  admin_plan_copy,
  admin_plan_copy_quantity,
  admin_plan_image,
  admin_plan_image_quantity,
  admin_plan_priority_support,
  admin_plan_published,
  admin_plan_refresh,
  admin_plan_standard_support,
  admin_plan_summary,
  admin_plan_video,
  admin_plan_video_quantity,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

interface PlanCatalog {
  mode: 'disabled' | 'recorded';
  plans: Array<{
    id: 'starter' | 'growth' | 'pro';
    allowance: { audio: number; copy: number; image: number; video: number };
    concurrencyLimit: number;
    queuePriority: number;
    supportLabel: 'standard' | 'priority';
  }>;
  addOns: Array<{
    id: string;
    resource: 'copy' | 'image' | 'video' | 'audio';
    quantity: number;
    amountMicros: number;
    currency: string;
  }>;
}

export function AdminPlanControl() {
  const query = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'catalog'),
    queryFn: ({ signal }) =>
      queryP1<PlanCatalog>(
        'entitlements',
        { action: 'catalog', payload: {} },
        signal
      ),
  });
  return (
    <div className="space-y-5">
      <Alert>
        <IconShieldCheck />
        <AlertTitle>{admin_plan_catalog_title()}</AlertTitle>
        <AlertDescription>{admin_plan_catalog_description()}</AlertDescription>
      </Alert>
      {query.error ? (
        <Alert variant="destructive">
          <AlertTitle>{admin_plan_catalog_error()}</AlertTitle>
          <AlertDescription>
            {admin_plan_catalog_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          variant="outline"
        >
          <IconRefresh />
          {admin_plan_refresh()}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {(query.data?.plans ?? []).map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="capitalize">{plan.id}</CardTitle>
                <Badge variant="outline">{admin_plan_published()}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{admin_plan_copy()}</dt>
                  <dd className="font-semibold">
                    {admin_plan_copy_quantity({
                      count: plan.allowance.copy,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_audio()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_audio_quantity({
                      count: plan.allowance.audio,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_image()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_image_quantity({
                      count: plan.allowance.image,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {admin_plan_video()}
                  </dt>
                  <dd className="font-semibold">
                    {admin_plan_video_quantity({
                      count: plan.allowance.video,
                    })}
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
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{admin_plan_add_ons()}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(query.data?.addOns ?? []).map((offer) => (
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
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <AdminRuntimeConfigControl
        keys={[
          'plan.allowances.starter',
          'plan.allowances.growth',
          'plan.allowances.pro',
          'plan.addons',
          'compliance.watermark.default',
          'compliance.aigc_label.default',
          'compliance.regulated_mode.default',
        ]}
      />
    </div>
  );
}
