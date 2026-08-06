import { InventoryStatusBadge } from '@/components/admin/capability/capability-status-badge';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import type { CapabilityCatalogView } from '@/p1/admin-capability-catalog-model';

/**
 * Two-level capability catalog (J3).
 * L1 = operator domains; L2 = technical deps + evidence drilldowns.
 * Daily ops path: no code/SQL/env/raw JSON/CLI controls (D-048).
 *
 * 呈现走 surge 的 panel 行式语言：每个 L1 域一个 Frame，域内三段（能力项 /
 * 技术依赖 / 证据下钻）各占一个 FramePanel，行与行之间由 border-b 分隔而不是
 * 一堆各自带边框的卡片。
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
          一级按能力域组织（能力 / 功能 /
          用户影响）；二级下钻到技术依赖与既有管理页证据。
          底层隔离键不进入一级信息架构。日常运营路径不提供 code / SQL / env /
          原始 JSON / CLI 编辑控件；复杂修复生成可移交脱敏上下文。
        </AlertDescription>
      </Alert>

      <p
        className="text-muted-foreground text-sm"
        data-testid="catalog-revision"
      >
        revision {view.revision} · 捕获 {view.capturedAt} · L1{' '}
        {view.domains.length} 域 · 证据下钻 {view.drilldownPages.length} 页
      </p>

      {view.domains.map((section) => (
        <Frame
          key={section.domain}
          data-testid="catalog-l1-section"
          data-domain={section.domain}
        >
          <FrameHeader className="gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <FrameTitle className="text-base">{section.title}</FrameTitle>
              <Badge variant="secondary" data-testid="catalog-l1-badge">
                L1 能力域
              </Badge>
            </div>
            <FrameDescription className="space-y-1">
              <p data-testid="catalog-function-summary">
                <span className="text-foreground font-medium">功能：</span>
                {section.functionSummary}
              </p>
              <p data-testid="catalog-user-impact">
                <span className="text-foreground font-medium">用户影响：</span>
                {section.userImpact}
              </p>
            </FrameDescription>
          </FrameHeader>

          <FramePanel
            className="flex flex-col gap-0 p-0!"
            data-testid="catalog-l2-capabilities"
          >
            <div className="text-muted-foreground flex items-center gap-3 px-4 py-2 text-sm font-medium">
              <span className="flex-1">能力项</span>
              <span className="shrink-0">插桩状态</span>
            </div>
            <Separator />
            {section.capabilities.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                本域暂无登记能力
              </p>
            ) : (
              section.capabilities.map((cap) => (
                <div
                  key={cap.id}
                  className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
                  data-testid="catalog-capability-row"
                  data-capability-id={cap.id}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-foreground text-sm font-medium">
                      {cap.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {cap.purpose}
                    </span>
                  </div>
                  <InventoryStatusBadge status={cap.status} />
                </div>
              ))
            )}
          </FramePanel>

          <FramePanel data-testid="catalog-l2-dependencies">
            <h3 className="text-sm font-semibold">二级 · 技术依赖</h3>
            {section.technicalDependencies.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                无关键技术依赖
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
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
          </FramePanel>

          <FramePanel
            className="flex flex-col gap-0 p-0!"
            data-testid="catalog-l2-evidence"
          >
            <div className="text-muted-foreground px-4 py-2 text-sm font-medium">
              二级 · 证据下钻
            </div>
            <Separator />
            {section.evidenceDrilldowns.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                本域暂无既有管理页下钻（后续纵向回填）
              </p>
            ) : (
              section.evidenceDrilldowns.map((drill) => (
                <a
                  key={drill.pageId}
                  href={drill.path}
                  className="hover:bg-muted/40 flex flex-col gap-0.5 border-b px-4 py-3 transition-colors last:border-b-0"
                  data-testid="catalog-evidence-drilldown"
                  data-page-id={drill.pageId}
                  data-hosts-health={
                    drill.hostsOperationsHealth ? 'true' : 'false'
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{drill.title}</span>
                    {drill.hostsOperationsHealth ? (
                      <Badge
                        variant="info-outline"
                        data-testid="catalog-health-block-badge"
                      >
                        含运行健康
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {drill.functionSummary}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    用户影响：{drill.userImpact}
                  </p>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    {drill.path}
                  </p>
                </a>
              ))
            )}
          </FramePanel>
        </Frame>
      ))}

      <Frame variant="ghost" data-testid="catalog-handoff-note">
        <FramePanel className="border-dashed shadow-none">
          <h3 className="text-sm font-semibold">复杂修复 · 技术移交</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            需要代码级、SQL、环境变量或基础设施变更时，生成脱敏移交上下文交给技术同学；
            不在运营界面伪装成一键修复。
          </p>
        </FramePanel>
      </Frame>
    </div>
  );
}
