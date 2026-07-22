import { optionalSourceId } from '@/p1/source-object-navigation';
import { parseTrustedReturn } from '@/product/trusted-return';
import { createFileRoute } from '@tanstack/react-router';
import { ContentLibrarySurface } from './-content-library-surface';

export const Route = createFileRoute('/dashboard/content')({
  validateSearch: (search: Record<string, unknown>) => {
    const contentId = optionalSourceId(search.contentId);
    const handoffId = optionalSourceId(search.handoffId);
    const packageId = optionalSourceId(search.packageId);
    const from = parseTrustedReturn(search.from);
    return {
      ...(contentId ? { contentId } : {}),
      ...(handoffId ? { handoffId } : {}),
      ...(packageId ? { packageId } : {}),
      ...(from ? { from } : {}),
    };
  },
  component: ContentLibraryPage,
});

function ContentLibraryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ContentLibrarySurface
      onOpenPackage={(packageId) => {
        void navigate({
          search: { ...search, packageId, from: 'content' },
        });
      }}
      selection={search}
    />
  );
}
