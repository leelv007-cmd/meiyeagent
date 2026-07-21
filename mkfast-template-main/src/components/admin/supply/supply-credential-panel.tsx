/**
 * CredentialAccount management panel (J5 / D-060).
 * Metadata / binding / version / 3-state + tested gate + draining /
 * probe results / rotate-drain notes. Secrets never rendered.
 */
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CredentialUiPanelView } from '@/p1/admin-supply-credential-model';

export function SupplyCredentialPanel({
  view,
}: {
  view: CredentialUiPanelView;
}) {
  return (
    <section
      data-testid="supply-credential-panel"
      data-secret-never-echoed={String(view.secretNeverEchoed)}
      data-env-fallback-risk-always-visible={String(
        view.envFallbackRiskAlwaysVisible
      )}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">凭据账户</h2>
        <p className="text-xs text-muted-foreground">
          三态主干 pending→active→retired；tested 为激活门；draining
          为异步媒体子状态。密钥永不回显。
          {view.envFallbackCount > 0
            ? ` · ${view.envFallbackCount} 个环境变量回退风险`
            : ''}
        </p>
      </header>

      {view.envFallbackCount > 0 ? (
        <div
          data-testid="supply-credential-env-fallback-banner"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          环境变量回退（保险箱未接管）持续可见：请尽快迁移到 CredentialAccount
          保险箱写入，重启后生效。
        </div>
      ) : (
        <div
          data-testid="supply-credential-env-fallback-banner"
          data-empty="true"
          className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
        >
          无 env_fallback 风险账户；风险与迁移入口在出现时将持续可见。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {view.accounts.map((account) => (
          <Card
            key={account.id}
            data-testid="supply-credential-card"
            data-credential-id={account.id}
            data-status={account.status}
            data-drain={account.drainSubstate}
            data-source={account.source}
            data-env-fallback-risk={String(account.envFallbackRisk)}
          >
            <CardHeader className="space-y-2 pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{account.label}</CardTitle>
                <Badge variant="outline">{account.statusLabel}</Badge>
              </div>
              <CardDescription className="font-mono text-xs">
                {account.id} · v{account.version}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant={
                    account.source === 'env_fallback'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {account.sourceLabel}
                </Badge>
                <Badge variant="outline">{account.drainLabel}</Badge>
                <Badge
                  variant={
                    account.activationGate.satisfied ? 'secondary' : 'outline'
                  }
                  data-testid="supply-credential-activation-gate"
                  data-satisfied={String(account.activationGate.satisfied)}
                >
                  激活门：
                  {account.activationGate.satisfied ? '满足' : '未满足'}
                </Badge>
              </div>

              <p>
                提供方：
                {account.providerDisplayName ?? account.providerProfileId}
              </p>
              <p className="font-mono text-muted-foreground">
                ref {account.secretReference}
              </p>
              <p>
                探针：{account.activationGate.probe.label}
                {account.activationGate.probe.testedAt
                  ? ` · ${account.activationGate.probe.testedAt}`
                  : ''}
              </p>
              {account.activationGate.probe.errorCode ? (
                <p className="text-destructive">
                  错误码 {account.activationGate.probe.errorCode}
                </p>
              ) : null}

              <div data-testid="supply-credential-binding">
                <p className="font-medium">绑定</p>
                <p>
                  部署 {account.binding.deploymentIds.length} · 池{' '}
                  {account.binding.poolIds.length} · 渠道{' '}
                  {account.binding.executionChannelIds.length}
                </p>
              </div>

              <div data-testid="supply-credential-versions">
                <p className="font-medium">版本历史（仅 mask）</p>
                <ul className="list-disc pl-4">
                  {account.versionHistory.map((row) => (
                    <li key={`${account.id}-${row.version}`}>
                      {row.mask} · {row.version} · {row.source}
                    </li>
                  ))}
                </ul>
              </div>

              {account.migrationEntryVisible ? (
                <p
                  data-testid="supply-credential-migration-entry"
                  className="rounded border border-destructive/30 p-2 text-destructive"
                >
                  {account.migrationEntryLabel}
                </p>
              ) : null}

              <div data-testid="supply-credential-rotate-drain">
                <p className="font-medium">轮换 / 排空流程</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {account.rotateDrainFlow.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  可轮换 {String(account.rotateDrainFlow.canRotate)} · 可激活{' '}
                  {String(account.rotateDrainFlow.canActivate)} · 可排空{' '}
                  {String(account.rotateDrainFlow.canStartDrain)} · 可撤销{' '}
                  {String(account.rotateDrainFlow.canRevoke)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
