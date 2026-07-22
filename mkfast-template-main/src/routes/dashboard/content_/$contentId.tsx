import { ContentLibrarySurface } from '@/routes/dashboard/-content-library-surface';
import { parseTrustedReturn } from '@/product/trusted-return';
import { createFileRoute } from '@tanstack/react-router';
import { stableContentPackageSelection } from '../-content-helpers';

export const Route = createFileRoute('/dashboard/content_/$contentId')({
  validateSearch: (search: Record<string, unknown>) => {
    const from = parseTrustedReturn(search.from);
    return from ? { from } : {};
  },
  component: ContentDetailRoute,
});

function ContentDetailRoute() {
  const selection = stableContentPackageSelection(Route.useParams().contentId);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ContentLibrarySurface
      onOpenPackage={(contentId) => {
        void navigate({
          params: { contentId },
          search,
          to: '/dashboard/content/$contentId',
        });
      }}
      selection={{ ...selection, from: search.from }}
    />
  );
}
