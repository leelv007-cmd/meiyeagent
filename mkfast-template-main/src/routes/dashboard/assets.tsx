import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { MarketingIdentityManager } from '@/product/marketing-identity-manager';
import { useProductState } from '@/product/client';
import { StoreIntakeWizard } from '@/product/store-intake/store-intake-wizard';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/assets')({
  component: AssetLibraryPage,
});

/**
 * W02 ⑤: the asset library is the second door into the same intake chain — a
 * merchant who came here to upload a price list should not be sent to another
 * page to turn it into confirmed facts. The product state is read in this leaf
 * so the route component itself stays a pure composition.
 */
function AssetStoreIntake() {
  const { refresh, state } = useProductState();
  return <StoreIntakeWizard product={{ refresh, state }} surface="assets" />;
}

function AssetLibraryPage() {
  return (
    <CanonicalHistoryPage mode="assets">
      <AssetStoreIntake />
      <MarketingIdentityManager />
    </CanonicalHistoryPage>
  );
}
