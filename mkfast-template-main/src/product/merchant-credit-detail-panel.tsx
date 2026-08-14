import type { MerchantCreditDetail } from '@meiye/contracts';
import { IconRefresh } from '@tabler/icons-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SettingsRow,
  SettingsRowHeader,
  useSettingsHeadingLevel,
} from '@/components/settings/settings-section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  credit_detail_batch_balance,
  credit_detail_batch_expiry,
  credit_detail_batch_source,
  credit_detail_batch_status,
  credit_detail_batch_status_active,
  credit_detail_batch_status_depleted,
  credit_detail_batch_status_expired,
  credit_detail_batches_title,
  credit_detail_description,
  credit_detail_load_error,
  credit_detail_load_error_title,
  credit_detail_refund_expired_uncredited,
  credit_detail_retry,
  credit_detail_source_booster,
  credit_detail_source_redemption,
  credit_detail_source_subscription,
  credit_detail_source_trial,
  credit_detail_title,
  credit_detail_transaction_batch,
  credit_detail_transaction_credits,
  credit_detail_transaction_operation,
  credit_detail_transaction_operation_account_credit,
  credit_detail_transaction_operation_creation,
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
} from '@/locale/paraglide/messages';
import { formatLocaleDate, formatLocaleDateTime } from '@/lib/locale';
import {
  creditDetailEmptyFallback,
  expiredUncreditedRefund,
} from '@/product/merchant-credit-detail';
import { useMerchantCreditDetail } from '@/product/use-merchant-credit-detail';

type MerchantCreditTransaction = MerchantCreditDetail['transactions'][number];

const BATCH_SOURCE_LABELS: Record<
  MerchantCreditDetail['batches'][number]['source'],
  () => string
> = {
  booster: credit_detail_source_booster,
  redemption: credit_detail_source_redemption,
  subscription: credit_detail_source_subscription,
  trial: credit_detail_source_trial,
};

const BATCH_STATUS_LABELS: Record<
  MerchantCreditDetail['batches'][number]['status'],
  () => string
> = {
  active: credit_detail_batch_status_active,
  depleted: credit_detail_batch_status_depleted,
  expired: credit_detail_batch_status_expired,
};

const TRANSACTION_STATUS_LABELS: Record<
  MerchantCreditTransaction['status'],
  () => string
> = {
  not_applicable: credit_detail_transaction_status_not_applicable,
  partially_refunded: credit_detail_transaction_status_partially_refunded,
  refunded: credit_detail_transaction_status_refunded,
  reserved: credit_detail_transaction_status_reserved,
  settled: credit_detail_transaction_status_settled,
};

const TRANSACTION_TYPE_LABELS: Record<
  MerchantCreditTransaction['type'],
  () => string
> = {
  expire: credit_detail_transaction_type_expire,
  grant: credit_detail_transaction_type_grant,
  refund: credit_detail_transaction_type_refund,
  reserve: credit_detail_transaction_type_reserve,
};

const TRANSACTION_OPERATION_LABELS: Record<
  MerchantCreditTransaction['operation'],
  () => string
> = {
  account_credit: credit_detail_transaction_operation_account_credit,
  creation: credit_detail_transaction_operation_creation,
};

export function MerchantCreditDetailPanel() {
  const query = useMerchantCreditDetail();
  /*
   * These two tables are named one rank below whatever names this group, which
   * moves with the section: the phone renders the credits section alone and
   * lets the page h1 title it, so the group is an h2 there and an h3 elsewhere.
   */
  const TableHeading = useSettingsHeadingLevel() === 2 ? 'h3' : 'h4';

  if (query.isPending) {
    return (
      <SettingsRow data-testid="merchant-credit-detail-loading">
        <SettingsRowHeader
          description={credit_detail_description()}
          title={credit_detail_title()}
        />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </SettingsRow>
    );
  }

  if (query.error || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{credit_detail_load_error_title()}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          {credit_detail_load_error()}
          <Button
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            <IconRefresh />
            {credit_detail_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <SettingsRow data-testid="merchant-credit-detail">
      <SettingsRowHeader
        description={credit_detail_description()}
        title={credit_detail_title()}
      />
      <div className="space-y-8">
        <section aria-labelledby="merchant-credit-batches">
          <TableHeading
            className="mb-3 font-medium"
            id="merchant-credit-batches"
          >
            {credit_detail_batches_title()}
          </TableHeading>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{credit_detail_batch_source()}</TableHead>
                <TableHead>{credit_detail_batch_balance()}</TableHead>
                <TableHead>{credit_detail_batch_expiry()}</TableHead>
                <TableHead>{credit_detail_batch_status()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="text-muted-foreground"
                    colSpan={4}
                    data-testid="credit-detail-empty-batches"
                  >
                    {creditDetailEmptyFallback(query.data)}
                  </TableCell>
                </TableRow>
              ) : null}
              {query.data.batches.map((batch) => (
                <TableRow key={batch.batchNumber}>
                  <TableCell>{BATCH_SOURCE_LABELS[batch.source]()}</TableCell>
                  <TableCell className="tabular-nums">
                    {batch.remainingCredits}
                  </TableCell>
                  <TableCell>
                    {batch.expiresAt ? formatLocaleDate(batch.expiresAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {BATCH_STATUS_LABELS[batch.status]()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section aria-labelledby="merchant-credit-transactions">
          <TableHeading
            className="mb-3 font-medium"
            id="merchant-credit-transactions"
          >
            {credit_detail_transactions_title()}
          </TableHeading>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{credit_detail_transaction_time()}</TableHead>
                <TableHead>{credit_detail_transaction_operation()}</TableHead>
                <TableHead>{credit_detail_transaction_type()}</TableHead>
                <TableHead>{credit_detail_transaction_credits()}</TableHead>
                <TableHead>{credit_detail_transaction_batch()}</TableHead>
                <TableHead>{credit_detail_transaction_status()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.transactions.map((transaction, index) => {
                const expiredRefund = expiredUncreditedRefund(transaction);
                return (
                  <TableRow
                    key={`${transaction.occurredAt}-${transaction.batchNumber}-${index}`}
                  >
                    <TableCell>
                      {formatLocaleDateTime(transaction.occurredAt)}
                    </TableCell>
                    <TableCell>
                      {TRANSACTION_OPERATION_LABELS[transaction.operation]()}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{TRANSACTION_TYPE_LABELS[transaction.type]()}</div>
                        {expiredRefund ? (
                          <p className="text-xs text-muted-foreground">
                            {credit_detail_refund_expired_uncredited({
                              count: expiredRefund.credits,
                            })}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {transaction.credits}
                    </TableCell>
                    <TableCell>#{transaction.batchNumber}</TableCell>
                    <TableCell>
                      {TRANSACTION_STATUS_LABELS[transaction.status]()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </div>
    </SettingsRow>
  );
}
