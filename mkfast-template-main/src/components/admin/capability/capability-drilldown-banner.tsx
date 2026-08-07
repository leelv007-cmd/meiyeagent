import { Badge } from '@/components/reui/badge';
import {
  domainLabel,
  getDrilldownDomainContext,
  type AdminDrilldownPageId,
} from '@/p1/admin-capability-catalog-model';
import {
  admin_capability_back_to_capability_catalog_e2f0cae2,
  admin_capability_feature_909b78d7,
  admin_capability_runtime_health_section_2346a237,
  admin_capability_user_impact_528f48c3,
} from '@/locale/paraglide/messages';

/**
 * Domain context banner for admin drilldown pages (six-domain IA).
 * Shows parent L1 domain in operator language (capability / function / impact).
 */
export function CapabilityDrilldownBanner({
  pageId,
  catalogHref = '/admin/capabilities',
}: {
  pageId: AdminDrilldownPageId;
  /** Catalog entry path (hardcoded until Z2-WIRING batch B). */
  catalogHref?: string;
}) {
  const context = getDrilldownDomainContext(pageId);
  if (!context) return null;

  const { page, domain } = context;

  return (
    <aside
      className="bg-muted/30 rounded-xl border p-4 text-sm"
      data-testid="capability-drilldown-banner"
      data-page-id={page.pageId}
      data-domain={page.domain}
      data-hosts-health={page.hostsOperationsHealth ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" data-testid="drilldown-l1-badge">
          {domainLabel(page.domain)}
        </Badge>
        <span className="text-muted-foreground">·</span>
        <span className="font-medium" data-testid="drilldown-page-title">
          {page.title}
        </span>
        {page.hostsOperationsHealth ? (
          <Badge variant="info-outline" data-testid="drilldown-health-badge">
            {admin_capability_runtime_health_section_2346a237()}
          </Badge>
        ) : null}
      </div>
      <p
        className="mt-2 text-muted-foreground"
        data-testid="drilldown-function"
      >
        <span className="font-medium text-foreground">
          {admin_capability_feature_909b78d7()}
        </span>
        {page.functionSummary}
      </p>
      <p
        className="mt-1 text-muted-foreground"
        data-testid="drilldown-user-impact"
      >
        <span className="font-medium text-foreground">
          {admin_capability_user_impact_528f48c3()}
        </span>
        {page.userImpact}
      </p>
      <p className="mt-2">
        <a
          href={catalogHref}
          className="text-primary underline-offset-4 hover:underline"
          data-testid="drilldown-back-to-catalog"
        >
          {admin_capability_back_to_capability_catalog_e2f0cae2()}
          {domain.title}）
        </a>
      </p>
    </aside>
  );
}
