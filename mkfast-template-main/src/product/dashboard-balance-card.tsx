import { useQuery } from '@tanstack/react-query';

import { p1QueryKeys } from '@/p1/query-keys';

import {
  dashboardBalanceRows,
  readDashboardBalance,
} from './dashboard-balance';

export function DashboardBalanceCard() {
  const balance = useQuery({
    queryFn: ({ signal }) => readDashboardBalance(signal),
    queryKey: p1QueryKeys.request('entitlements', 'balance'),
    retry: false,
  });

  return (
    <section
      aria-labelledby="dashboard-balance-title"
      className="meiye-porcelain rounded-2xl p-4"
      data-testid="dashboard-balance"
    >
      <div>
        <h2 className="text-sm font-semibold" id="dashboard-balance-title">
          创作余额
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          每次创作前都按这里的三类余量确认。
        </p>
      </div>

      {balance.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">正在读取余额…</p>
      ) : balance.isError || !balance.data ? (
        <p className="mt-4 text-sm text-muted-foreground" role="alert">
          余额暂时没取回来，稍后刷新再看。
        </p>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {dashboardBalanceRows(balance.data).map((bucket) => (
            <div
              className="rounded-xl border border-divider bg-surface-1 p-3"
              data-bucket={bucket.id}
              key={bucket.id}
            >
              <dt className="text-xs text-muted-foreground">{bucket.label}</dt>
              <dd className="mt-1 text-lg font-semibold">
                {bucket.available}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  / {bucket.allowance} 可用
                </span>
              </dd>
              {bucket.reserved > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  进行中占用 {bucket.reserved}
                </p>
              ) : null}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
