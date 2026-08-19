import type { CanonicalDeepLinkDestination } from '@/product/canonical-deep-link';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import {
  deep_link_unavailable_description,
  deep_link_unavailable_title,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';

export function CanonicalDeepLinkUnavailable({
  destination,
}: {
  destination: CanonicalDeepLinkDestination;
}) {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: product_navigation_workbench(), isCurrentPage: false },
        { label: deep_link_unavailable_title(), isCurrentPage: true },
      ]}
      description={deep_link_unavailable_description()}
      title={deep_link_unavailable_title()}
    >
      <div
        data-deep-link-entry={destination.entry}
        data-deep-link-id={destination.objectId}
        data-deep-link-object={destination.objectClass}
        data-deep-link-reason={destination.reason}
        data-deep-link-stage={destination.stage}
        data-testid="canonical-deep-link-unavailable"
      >
        <StatePanel
          description={deep_link_unavailable_description()}
          kind="unknown"
          title={deep_link_unavailable_title()}
        />
      </div>
    </DashboardLayout>
  );
}
