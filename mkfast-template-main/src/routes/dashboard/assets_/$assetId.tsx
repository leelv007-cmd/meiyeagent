import { CanonicalAssetDetailPage } from '@/product/canonical-history-page';
import { parseTrustedReturn } from '@/product/trusted-return';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/assets_/$assetId')({
  validateSearch: (search: Record<string, unknown>) => {
    const from = parseTrustedReturn(search.from);
    return from ? { from } : {};
  },
  component: AssetDetailRoute,
});

function AssetDetailRoute() {
  const search = Route.useSearch();
  return (
    <CanonicalAssetDetailPage
      assetId={Route.useParams().assetId}
      returnFrom={search.from}
    />
  );
}
