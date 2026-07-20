/**
 * EntitlementPolicy / AccountAllocation / SupplyPool status surfaces (J4 ← H1).
 */
import { Badge } from '@/components/ui/badge';
import {
  allocationStatusLabel,
  entitlementPolicyStageLabel,
  type EntitlementStatusView,
} from '@/p1/admin-entitlement-status-model';

export function EntitlementStatusPanel({
  view,
}: {
  view: EntitlementStatusView;
}) {
  return (
    <section
      data-testid="entitlement-status-panel"
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">权益 / 池状态面</h2>
        <p className="text-xs text-muted-foreground" data-testid="entitlement-dual-truth">
          {view.dualTruthNote}
        </p>
        <p className="text-xs">
          已发布策略 {view.publishedPolicyCount} · 生效分配{' '}
          {view.activeAllocationCount}
        </p>
      </header>

      <section data-testid="entitlement-policies" className="space-y-2">
        <h3 className="text-sm font-semibold">EntitlementPolicy</h3>
        <ul className="space-y-2">
          {view.policies.map((policy) => (
            <li
              key={`${policy.id}-${policy.revision}`}
              data-testid="entitlement-policy-row"
              data-stage={policy.stage}
              data-tier={policy.tier}
              className="rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {policy.tier} · r{policy.revision}
                </span>
                <Badge variant="outline">
                  {entitlementPolicyStageLabel(policy.stage)}
                </Badge>
                <span className="font-mono text-muted-foreground">
                  {policy.revisionId}
                </span>
              </div>
              <p className="mt-1">
                并发 {policy.concurrencyLimit} · 队列优先级{' '}
                {policy.queuePriority} · {policy.supportLabel}
              </p>
              <p className="text-muted-foreground">{policy.allowanceSummary}</p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="entitlement-allocations" className="space-y-2">
        <h3 className="text-sm font-semibold">AccountAllocation</h3>
        <ul className="space-y-2">
          {view.allocations.map((alloc) => (
            <li
              key={alloc.id}
              data-testid="entitlement-allocation-row"
              data-status={alloc.status}
              data-kind={alloc.kind}
              className="rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {alloc.kind} · {alloc.targetLabel}
                </span>
                <Badge variant="secondary">
                  {allocationStatusLabel(alloc.status)}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-muted-foreground">
                acct {alloc.accountId} · ws {alloc.workspaceId} · {alloc.source}
              </p>
              <p>{alloc.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="entitlement-pools" className="space-y-2">
        <h3 className="text-sm font-semibold">SupplyPool</h3>
        <ul className="space-y-2">
          {view.pools.map((pool) => (
            <li
              key={pool.id}
              data-testid="entitlement-pool-row"
              data-pool-kind={pool.kind}
              data-status={pool.status}
              className="rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{pool.displayName}</span>
                <Badge variant="outline">{pool.kind}</Badge>
                <Badge variant="secondary">{pool.status}</Badge>
              </div>
              <p className="mt-1 font-mono text-muted-foreground">
                {pool.revisionId}
              </p>
              <p>
                deployments {pool.deploymentCount} · credentials{' '}
                {pool.credentialCount} · {pool.capacityLabel}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
