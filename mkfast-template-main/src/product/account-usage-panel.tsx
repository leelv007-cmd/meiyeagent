import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  account_usage_allowance,
  account_usage_available,
  account_usage_copy,
  account_usage_description,
  account_usage_expiry,
  account_usage_expiry_unavailable,
  account_usage_image,
  account_usage_load_error,
  account_usage_load_error_title,
  account_usage_loading,
  account_usage_no_plan,
  account_usage_released,
  account_usage_reserved,
  account_usage_retry,
  account_usage_settled,
  account_usage_terms_explanation,
  account_usage_title,
  account_usage_video,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  projectAccountUsage,
  type AccountUsageProjection,
} from './account-usage';

export function AccountUsagePanel() {
  const query = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
  });

  if (query.isPending) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {account_usage_loading()}
        </CardContent>
      </Card>
    );
  }
  if (query.error || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{account_usage_load_error_title()}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          {account_usage_load_error()}
          <Button
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            <IconRefresh />
            {account_usage_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const projection = projectAccountUsage(query.data);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{account_usage_title()}</CardTitle>
          <Badge className="capitalize" variant="secondary">
            {projection.summary.tier ?? account_usage_no_plan()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {account_usage_description()}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          {account_usage_terms_explanation()}
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {projection.resources.map((resource) => (
            <section
              className="overflow-hidden rounded-lg bg-card px-4 py-5 shadow-sm ring-1 ring-foreground/10 sm:p-6"
              key={resource.resource}
            >
              <h3 className="text-sm font-medium text-muted-foreground">
                {resource.resource === 'copy'
                  ? account_usage_copy()
                  : resource.resource === 'image'
                    ? account_usage_image()
                    : account_usage_video()}
              </h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
                <div>
                  <dt className="truncate text-xs font-medium text-muted-foreground">
                    {account_usage_available()}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                    {resource.available}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-xs font-medium text-muted-foreground">
                    {account_usage_reserved()}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                    {resource.reserved}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-xs font-medium text-muted-foreground">
                    {account_usage_settled()}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                    {resource.settled}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-xs font-medium text-muted-foreground">
                    {account_usage_released()}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                    {resource.released}
                  </dd>
                </div>
              </dl>
              <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">
                {account_usage_allowance({ count: resource.allowance })}
              </p>
            </section>
          ))}
        </div>
        <p className="border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            {account_usage_expiry()}
          </span>
          {projection.summary.expiresAt
            ? formatLocaleDateTime(projection.summary.expiresAt)
            : account_usage_expiry_unavailable()}
        </p>
      </CardContent>
    </Card>
  );
}
