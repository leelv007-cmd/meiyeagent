import { useQuery } from '@tanstack/react-query';

import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  credit_detail_transaction_batch,
  credit_detail_transaction_credits,
  credit_detail_transaction_status,
  credit_detail_transaction_status_not_applicable,
  credit_detail_transaction_status_partially_refunded,
  credit_detail_transaction_status_refunded,
  credit_detail_transaction_status_reserved,
  credit_detail_transaction_status_settled,
  credit_detail_transaction_time,
  credit_detail_transaction_type,
  credit_detail_transaction_type_expire,
  credit_detail_transaction_type_grant,
  credit_detail_transaction_type_refund,
  credit_detail_transaction_type_reserve,
  credit_detail_transactions_title,
  merchant_support_actual,
  merchant_support_credit_evidence,
  merchant_support_credit_summary,
  merchant_support_description,
  merchant_support_empty,
  merchant_support_estimated,
  merchant_support_job,
  merchant_support_load_error,
  merchant_support_loading,
  merchant_support_no_credit_transactions,
  merchant_support_reason,
  merchant_support_refunded,
  merchant_support_title,
  merchant_support_unknown,
} from '@/locale/paraglide/messages';
import { operationsQuery, queryP1 } from '@/p1/client';
import {
  buildMerchantSupportDiagnostic,
  type MerchantSupportDiagnosticInput,
} from '@/p1/merchant-support-diagnostic';
import { p1QueryKeys } from '@/p1/query-keys';

type Diagnostic = ReturnType<typeof buildMerchantSupportDiagnostic>;
type CreditTransaction =
  Diagnostic['creditEvidence']['recentTransactions'][number];

const TRANSACTION_STATUS_LABELS: Record<
  CreditTransaction['status'],
  () => string
> = {
  not_applicable: credit_detail_transaction_status_not_applicable,
  partially_refunded: credit_detail_transaction_status_partially_refunded,
  refunded: credit_detail_transaction_status_refunded,
  reserved: credit_detail_transaction_status_reserved,
  settled: credit_detail_transaction_status_settled,
};

const TRANSACTION_TYPE_LABELS: Record<CreditTransaction['type'], () => string> =
  {
    expire: credit_detail_transaction_type_expire,
    grant: credit_detail_transaction_type_grant,
    refund: credit_detail_transaction_type_refund,
    reserve: credit_detail_transaction_type_reserve,
  };

function amount(value: { amount: number; currency: string } | null) {
  return value
    ? `${value.amount.toFixed(4)} ${value.currency}`
    : merchant_support_unknown();
}

export function MerchantSupportDiagnosticTable({
  diagnostic,
}: {
  diagnostic: Diagnostic;
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="font-medium">{merchant_support_credit_evidence()}</h3>
        <p className="text-sm text-muted-foreground">
          {merchant_support_credit_summary({
            activeBatchCount: diagnostic.creditEvidence.activeBatchCount,
            availableCredits: diagnostic.creditEvidence.availableCredits,
            transactionCount:
              diagnostic.creditEvidence.recentTransactions.length,
          })}
        </p>
        <h4 className="font-medium text-sm">
          {credit_detail_transactions_title()}
        </h4>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{credit_detail_transaction_time()}</TableHead>
                <TableHead>{credit_detail_transaction_type()}</TableHead>
                <TableHead>{credit_detail_transaction_credits()}</TableHead>
                <TableHead>{credit_detail_transaction_batch()}</TableHead>
                <TableHead>{credit_detail_transaction_status()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diagnostic.creditEvidence.recentTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    {merchant_support_no_credit_transactions()}
                  </TableCell>
                </TableRow>
              ) : (
                diagnostic.creditEvidence.recentTransactions.map(
                  (transaction) => (
                    <TableRow
                      key={`${transaction.occurredAt}:${transaction.batchNumber}:${transaction.type}`}
                    >
                      <TableCell>{transaction.occurredAt}</TableCell>
                      <TableCell>
                        {TRANSACTION_TYPE_LABELS[transaction.type]()}
                      </TableCell>
                      <TableCell>{transaction.credits}</TableCell>
                      <TableCell>{transaction.batchNumber}</TableCell>
                      <TableCell>
                        {TRANSACTION_STATUS_LABELS[transaction.status]()}
                      </TableCell>
                    </TableRow>
                  )
                )
              )}
            </TableBody>
          </Table>
        </div>
      </section>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{merchant_support_job()}</TableHead>
              <TableHead>{merchant_support_estimated()}</TableHead>
              <TableHead>{merchant_support_actual()}</TableHead>
              <TableHead>{merchant_support_reason()}</TableHead>
              <TableHead>{merchant_support_refunded()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diagnostic.jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>{merchant_support_empty()}</TableCell>
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
      const [workbench, contentPackages, creditDetail] = await Promise.all([
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
        queryP1<MerchantSupportDiagnosticInput['creditDetail']>(
          'entitlements',
          { action: 'credit_detail', payload: {} },
          signal
        ),
      ]);
      return buildMerchantSupportDiagnostic({
        contentPackages,
        creditDetail,
        jobs: workbench.jobs,
      });
    },
  });
  return (
    <Frame dense>
      <FrameHeader>
        <FrameTitle>{merchant_support_title()}</FrameTitle>
        <FrameDescription>{merchant_support_description()}</FrameDescription>
      </FrameHeader>
      <FramePanel>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">
            {merchant_support_loading()}
          </p>
        ) : query.isError || !query.data ? (
          <p className="text-sm text-destructive">
            {merchant_support_load_error()}
          </p>
        ) : (
          <MerchantSupportDiagnosticTable diagnostic={query.data} />
        )}
      </FramePanel>
    </Frame>
  );
}
