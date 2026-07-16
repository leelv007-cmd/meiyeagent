import { CanonicalAssetDetailPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/assets_/$assetId')({
  component: AssetDetailRoute,
});

function AssetDetailRoute() {
  return <CanonicalAssetDetailPage assetId={Route.useParams().assetId} />;
}
