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
import {
  admin_capability_capabilities_e2db9f83,
  admin_capability_capability_catalog_two_level_ia_6a9c70b1,
  admin_capability_captured_d98892e9,
  admin_capability_complex_fix_technical_handoff_9ce0f3b1,
  admin_capability_domain_evidence_drill_down_98f9d0c6,
  admin_capability_feature_909b78d7,
  admin_capability_includes_runtime_health_ac069faa,
  admin_capability_instrumentation_status_06b0af95,
  admin_capability_l1_capability_domain_04163a50,
  admin_capability_l2_evidence_drill_down_9963fcdd,
  admin_capability_l2_technical_dependencies_53cc5cff,
  admin_capability_no_existing_admin_page_drill_downs_in_th_6015c80c,
  admin_capability_no_registered_capabilities_in_this_domai_adcbbb76,
  admin_capability_no_related_technical_dependencies_19492803,
  admin_capability_organized_by_capability_domain_at_l1_cap_e1bb0cc4,
  admin_capability_page_73422182,
  admin_capability_user_impact_528f48c3,
  admin_capability_when_code_level_sql_env_or_infrastructur_8158d0d4,
} from '@/locale/paraglide/messages';

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
        <AlertTitle>
          {admin_capability_capability_catalog_two_level_ia_6a9c70b1()}
        </AlertTitle>
        <AlertDescription>
          {admin_capability_organized_by_capability_domain_at_l1_cap_e1bb0cc4()}
        </AlertDescription>
      </Alert>

      <p
        className="text-muted-foreground text-sm"
        data-testid="catalog-revision"
      >
        revision {view.revision} {admin_capability_captured_d98892e9()}{' '}
        {view.capturedAt} · L1 {view.domains.length}{' '}
        {admin_capability_domain_evidence_drill_down_98f9d0c6()}{' '}
        {view.drilldownPages.length} {admin_capability_page_73422182()}
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
                {admin_capability_l1_capability_domain_04163a50()}
              </Badge>
            </div>
            <FrameDescription className="space-y-1">
              <p data-testid="catalog-function-summary">
                <span className="text-foreground font-medium">
                  {admin_capability_feature_909b78d7()}
                </span>
                {section.functionSummary}
              </p>
              <p data-testid="catalog-user-impact">
                <span className="text-foreground font-medium">
                  {admin_capability_user_impact_528f48c3()}
                </span>
                {section.userImpact}
              </p>
            </FrameDescription>
          </FrameHeader>

          <FramePanel
            className="flex flex-col gap-0 p-0!"
            data-testid="catalog-l2-capabilities"
          >
            <div className="text-muted-foreground flex items-center gap-3 px-4 py-2 text-sm font-medium">
              <span className="flex-1">
                {admin_capability_capabilities_e2db9f83()}
              </span>
              <span className="shrink-0">
                {admin_capability_instrumentation_status_06b0af95()}
              </span>
            </div>
            <Separator />
            {section.capabilities.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                {admin_capability_no_registered_capabilities_in_this_domai_adcbbb76()}
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
            <h3 className="text-sm font-semibold">
              {admin_capability_l2_technical_dependencies_53cc5cff()}
            </h3>
            {section.technicalDependencies.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {admin_capability_no_related_technical_dependencies_19492803()}
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
              {admin_capability_l2_evidence_drill_down_9963fcdd()}
            </div>
            <Separator />
            {section.evidenceDrilldowns.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                {admin_capability_no_existing_admin_page_drill_downs_in_th_6015c80c()}
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
                        {admin_capability_includes_runtime_health_ac069faa()}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {drill.functionSummary}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {admin_capability_user_impact_528f48c3()}
                    {drill.userImpact}
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
          <h3 className="text-sm font-semibold">
            {admin_capability_complex_fix_technical_handoff_9ce0f3b1()}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {admin_capability_when_code_level_sql_env_or_infrastructur_8158d0d4()}
          </p>
        </FramePanel>
      </Frame>
    </div>
  );
}
