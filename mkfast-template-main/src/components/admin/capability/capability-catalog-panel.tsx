import { InventoryStatusBadge } from '@/components/admin/capability/capability-status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CapabilityCatalogView } from '@/p1/admin-capability-catalog-model';

/**
 * Two-level capability catalog (J3).
 * L1 = operator domains; L2 = technical deps + evidence drilldowns.
 * Daily ops path: no code/SQL/env/raw JSON/CLI controls (D-048).
 */
export function CapabilityCatalogPanel({
  view,
}: {
  view: CapabilityCatalogView;
}) {
  return (
    <div
      className="space-y-6"
      data-testid="capability-catalog-panel"
      data-ops-path="daily"
      data-l1-excludes-workspace-id={
        view.l1ExcludesWorkspaceId ? 'true' : 'false'
      }
    >
      <Alert>
        <AlertTitle>能力目录（两层 IA）</AlertTitle>
        <AlertDescription>
          一级按能力域组织（能力 / 功能 / 用户影响）；二级下钻到技术依赖与既有管理页证据。
          底层隔离键不进入一级信息架构。日常运营路径不提供 code / SQL / env /
          原始 JSON / CLI 编辑控件；复杂修复生成可移交脱敏上下文。
        </AlertDescription>
      </Alert>

      <p
        className="text-sm text-muted-foreground"
        data-testid="catalog-revision"
      >
        revision {view.revision} · 捕获 {view.capturedAt} · L1{' '}
        {view.domains.length} 域 · 证据下钻 {view.drilldownPages.length} 页
      </p>

      {view.domains.map((section) => (
        <Card
          key={section.domain}
          data-testid="catalog-l1-section"
          data-domain={section.domain}
        >
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{section.title}</CardTitle>
              <Badge variant="secondary" data-testid="catalog-l1-badge">
                L1 能力域
              </Badge>
            </div>
            <CardDescription className="space-y-1">
              <p data-testid="catalog-function-summary">
                <span className="font-medium text-foreground">功能：</span>
                {section.functionSummary}
              </p>
              <p data-testid="catalog-user-impact">
                <span className="font-medium text-foreground">用户影响：</span>
                {section.userImpact}
              </p>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <section className="space-y-2" data-testid="catalog-l2-capabilities">
              <h3 className="text-sm font-semibold">能力项</h3>
              {section.capabilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">本域暂无登记能力</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {section.capabilities.map((cap) => (
                    <li
                      key={cap.id}
                      className="rounded-lg border p-3"
                      data-testid="catalog-capability-row"
                      data-capability-id={cap.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{cap.name}</span>
                        <InventoryStatusBadge status={cap.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cap.purpose}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="space-y-2"
              data-testid="catalog-l2-dependencies"
            >
              <h3 className="text-sm font-semibold">
                二级 · 技术依赖
              </h3>
              {section.technicalDependencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">无关键技术依赖</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {section.technicalDependencies.map((dep) => (
                    <li key={dep.id}>
                      <Badge
                        variant="outline"
                        data-testid="catalog-tech-dep"
                        data-dep-id={dep.id}
                      >
                        {dep.label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="space-y-2"
              data-testid="catalog-l2-evidence"
            >
              <h3 className="text-sm font-semibold">
                二级 · 证据下钻
              </h3>
              {section.evidenceDrilldowns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  本域暂无既有管理页下钻（后续纵向回填）
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {section.evidenceDrilldowns.map((drill) => (
                    <li key={drill.pageId}>
                      <a
                        href={drill.path}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted/40"
                        data-testid="catalog-evidence-drilldown"
                        data-page-id={drill.pageId}
                        data-hosts-health={
                          drill.hostsOperationsHealth ? 'true' : 'false'
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {drill.title}
                          </span>
                          {drill.hostsOperationsHealth ? (
                            <Badge
                              variant="secondary"
                              data-testid="catalog-health-block-badge"
                            >
                              含运行健康
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {drill.functionSummary}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          用户影响：{drill.userImpact}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {drill.path}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </CardContent>
        </Card>
      ))}

      <section
        className="rounded-lg border border-dashed p-4"
        data-testid="catalog-handoff-note"
      >
        <h3 className="text-sm font-semibold">复杂修复 · 技术移交</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          需要代码级、SQL、环境变量或基础设施变更时，生成脱敏移交上下文交给技术同学；
          不在运营界面伪装成一键修复。
        </p>
      </section>
    </div>
  );
}
