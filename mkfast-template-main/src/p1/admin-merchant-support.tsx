import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { m } from '@/locale/paraglide/messages';
import { operationsQuery, queryP1 } from '@/p1/client';
import {
  buildMerchantSupportDiagnostic,
  type MerchantSupportDiagnosticInput,
} from '@/p1/merchant-support-diagnostic';
import { p1QueryKeys } from '@/p1/query-keys';

type Diagnostic = ReturnType<typeof buildMerchantSupportDiagnostic>;

function amount(value: { amount: number; currency: string } | null) {
  return value
    ? `${value.amount.toFixed(4)} ${value.currency}`
    : m.merchant_support_unknown();
}

export function MerchantSupportDiagnosticTable({
  diagnostic,
}: {
  diagnostic: Diagnostic;
}) {
  return (
    <div className="space-y-4">
      <Badge
        variant={diagnostic.ledgerConsistent ? 'secondary' : 'destructive'}
      >
        {diagnostic.ledgerConsistent
          ? m.merchant_support_ledger_consistent()
          : m.merchant_support_ledger_mismatch()}
      </Badge>
      <section className="space-y-2">
        <h3 className="font-medium">{m.merchant_support_quota()}</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {Object.entries(diagnostic.quota).map(([resource, usage]) => (
            <li key={resource}>
              {m.merchant_support_quota_line({ resource, ...usage })}
            </li>
          ))}
        </ul>
      </section>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m.merchant_support_job()}</TableHead>
              <TableHead>{m.merchant_support_estimated()}</TableHead>
              <TableHead>{m.merchant_support_actual()}</TableHead>
              <TableHead>{m.merchant_support_reason()}</TableHead>
              <TableHead>{m.merchant_support_refunded()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diagnostic.jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{m.merchant_support_empty()}</TableCell>
              </TableRow>
            ) : (
              diagnostic.jobs.slice(0, 20).map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <p className="font-mono text-xs">{job.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.operation} · {job.status}
                    </p>
                  </TableCell>
                  <TableCell>{amount(job.estimated)}</TableCell>
                  <TableCell>{amount(job.actual)}</TableCell>
                  <TableCell>{job.reason}</TableCell>
                  <TableCell>{job.refunded.quantity}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function AdminMerchantSupport() {
  const query = useQuery({
    queryKey: p1QueryKeys.request('operations', 'merchant_support_diagnostic'),
    queryFn: async ({ signal }) => {
      const [workbench, contentPackages, entitlement] = await Promise.all([
        operationsQuery<{ jobs: MerchantSupportDiagnosticInput['jobs'] }>(
          'creative_workbench',
          {},
          signal
        ),
        operationsQuery<MerchantSupportDiagnosticInput['contentPackages']>(
          'content_packages',
          {},
          signal
        ),
        queryP1<MerchantSupportDiagnosticInput['entitlement']>(
          'entitlements',
          { action: 'projection', payload: {} },
          signal
        ),
      ]);
      return buildMerchantSupportDiagnostic({
        contentPackages,
        entitlement,
        jobs: workbench.jobs,
      });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.merchant_support_title()}</CardTitle>
        <CardDescription>{m.merchant_support_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">
            {m.merchant_support_loading()}
          </p>
        ) : query.isError || !query.data ? (
          <p className="text-sm text-destructive">
            {m.merchant_support_load_error()}
          </p>
        ) : (
          <MerchantSupportDiagnosticTable diagnostic={query.data} />
        )}
      </CardContent>
    </Card>
  );
}
