import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { MarketingIdentityManager } from '@/product/marketing-identity-manager';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/assets')({
  component: AssetLibraryPage,
});

function AssetLibraryPage() {
  return (
    <CanonicalHistoryPage mode="assets">
      <MarketingIdentityManager />
    </CanonicalHistoryPage>
  );
}
