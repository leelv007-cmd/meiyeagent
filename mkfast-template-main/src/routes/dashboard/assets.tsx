import { Button } from '@/components/ui/button';
import { getLocale } from '@/lib/locale';
import { appPageHead } from '@/lib/seo';
import { product_navigation_assets } from '@/locale/paraglide/messages';
import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { useProductState } from '@/product/client';
import { MarketingIdentityManager } from '@/product/marketing-identity-manager';
import { StoreIntakeWizard } from '@/product/store-intake/store-intake-wizard';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/dashboard/assets')({
  head: () => appPageHead(product_navigation_assets()),
  component: AssetLibraryPage,
});

const COPY = {
  zh: {
    closeIntake: '收起门店资料',
    identitySummary: '口吻',
    openIntake: '完善门店资料',
    secondaryLabel: '更多设置',
  },
  en: {
    closeIntake: 'Hide store materials',
    identitySummary: 'Voice',
    openIntake: 'Complete store materials',
    secondaryLabel: 'More settings',
  },
} as const;

/**
 * W02 ⑤: assets remain a second door into intake — but cold-start must not
 * stack the five-step wizard and voice manager beside upload. Default surface
 * is library + capture; intake/voice stay available behind single entries.
 */
function AssetLibrarySecondary() {
  const copy = COPY[getLocale()];
  const { refresh, state } = useProductState();
  const [intakeOpen, setIntakeOpen] = useState(false);

  return (
    <aside
      aria-label={copy.secondaryLabel}
      className="space-y-3 border-t border-border/60 pt-4"
      data-testid="asset-library-secondary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid={
            intakeOpen ? 'asset-store-intake-close' : 'asset-store-intake-open'
          }
          onClick={() => setIntakeOpen((open) => !open)}
          size="sm"
          type="button"
          variant="outline"
        >
          {intakeOpen ? copy.closeIntake : copy.openIntake}
        </Button>
      </div>

      {intakeOpen ? (
        <StoreIntakeWizard product={{ refresh, state }} surface="assets" />
      ) : null}

      <details
        className="group rounded-2xl border border-border/60 bg-background/40 px-4 py-3"
        data-testid="asset-identity-entry"
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          {copy.identitySummary}
        </summary>
        <div className="mt-3">
          <MarketingIdentityManager />
        </div>
      </details>
    </aside>
  );
}

function AssetLibraryPage() {
  return (
    <CanonicalHistoryPage mode="assets">
      <AssetLibrarySecondary />
    </CanonicalHistoryPage>
  );
}
