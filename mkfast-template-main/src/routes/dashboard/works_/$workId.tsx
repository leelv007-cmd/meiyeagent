import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { parseLightComposerCarrier } from '@/p1/content-package-export-carrier';
import { WorksDetailPage, WorksLightEditPage } from '@/product/works';
import { createFileRoute } from '@tanstack/react-router';

/**
 * 作品 detail — T32 / #226 reshell.
 *
 * The param is whatever the caller has: a ContentPackage id from the list, a
 * workId from the Composer 交付卡, or a canvas work id from the 轻编辑 carrier.
 * The projection resolves all three onto the same 作品 (works-projection.ts).
 *
 * `?exportCarrier=` keeps its meaning: a canonical light_composer delivery
 * hands the material specs straight to the capability core, so that entry goes
 * to the light-edit shell without a projection round trip.
 */
export const Route = createFileRoute('/dashboard/works_/$workId')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
  component: WorkPage,
});

function WorkPage() {
  const { workId } = Route.useParams();
  const { exportCarrier } = Route.useSearch() as { exportCarrier?: unknown };
  const exportUseDelivery = parseLightComposerCarrier(exportCarrier);
  if (exportUseDelivery) {
    return (
      <WorksLightEditPage
        exportUseDelivery={exportUseDelivery}
        workId={workId}
      />
    );
  }
  return <WorksDetailPage workId={workId} />;
}
