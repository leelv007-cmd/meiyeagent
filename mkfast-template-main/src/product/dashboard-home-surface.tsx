/**
 * D-126 Dashboard home surface — hot and cold state of the same page.
 *
 * Hot: one recommendation a day carrying the three explanation elements
 * (why now / which store facts / what the customer should do). Its CTA
 * prefills the Composer draft below; it never auto-submits and never charges.
 *
 * Cold: the three platform-maintained sample stores (C-5 护发／皮肤管理／生发),
 * opt-in and read-only. Remixing a sample only prefills the same draft, so the
 * sample task runs through the real chain and spends the real trial allowance
 * (D-128 — no demo-only second path).
 */

import { Button } from '@/components/ui/button';
import {
  example_store_hide_error,
  example_store_show,
} from '@/locale/paraglide/messages';
import type { ProductState } from '@meiye/contracts';
import { IconBuildingStore } from '@tabler/icons-react';
import { useState } from 'react';

import { executeProductCommand } from './client';
import {
  exampleStoreVisibility,
  writeCreationDraftIntent,
} from './creation-entry-model';
import { ExampleStoreShowcase } from './example-store-showcase';
import { TodayRecommendationCard } from './today-recommendation-card';

/**
 * `visible` = cold and revealed, `opt_in` = cold but the merchant closed it,
 * `hidden` = the workspace already has real work so samples never show again.
 */
export type ExampleShowcaseVisibility =
  | 'visible'
  | 'opt_in'
  | 'hidden'
  | 'unknown';

export function exampleShowcaseVisibility(input: {
  loading: boolean;
  state: ProductState | undefined;
}): ExampleShowcaseVisibility {
  const { loading, state } = input;
  if (!state) return 'unknown';
  const cold = exampleStoreVisibility({
    assetCount: state.assets.length,
    contentCount: state.contents.length,
    // Asked without the opt-in flag: this answers "is the workspace still cold".
    hidden: false,
    queriesReady: !loading,
    taskCount: state.videoJobs.length,
    workCount:
      state.handoffPackages.length +
      state.operationalEvidence.generatedCandidateCount,
  });
  if (cold !== 'visible') return cold;
  return state.exampleStores.every((store) => store.hidden)
    ? 'opt_in'
    : 'visible';
}

export function DashboardHomeSurface({
  loading,
  onPrefill,
  onRefresh,
  onStart,
  state,
}: {
  loading: boolean;
  onPrefill: (intent: string) => void;
  onRefresh: () => Promise<void>;
  onStart: () => void;
  state: ProductState | undefined;
}) {
  const [pendingVisibility, setPendingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string>();

  const visibility = exampleShowcaseVisibility({ loading, state });
  const stores = state?.exampleStores ?? [];

  const setExampleHidden = async (hidden: boolean) => {
    setPendingVisibility(true);
    setVisibilityError(undefined);
    try {
      await executeProductCommand(
        { type: 'hide_example', hidden },
        `hide-example:${hidden}:${Date.now()}`
      );
      await onRefresh();
    } catch {
      setVisibilityError(example_store_hide_error());
    } finally {
      setPendingVisibility(false);
    }
  };

  const prefill = (intent: string) => {
    if (typeof window !== 'undefined') {
      writeCreationDraftIntent(sessionStorage, intent);
    }
    onPrefill(intent);
  };

  return (
    <div className="space-y-6" data-testid="dashboard-home-surface">
      <TodayRecommendationCard onStart={onStart} onUse={prefill} />

      {visibility === 'visible' && stores.length > 0 ? (
        <ExampleStoreShowcase
          hideError={visibilityError}
          hiding={pendingVisibility}
          onHide={() => void setExampleHidden(true)}
          onRemix={prefill}
          stores={stores}
        />
      ) : null}

      {visibility === 'opt_in' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="min-h-touch-target"
            disabled={pendingVisibility}
            onClick={() => void setExampleHidden(false)}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconBuildingStore aria-hidden="true" />
            {example_store_show()}
          </Button>
          {visibilityError ? (
            <p className="text-sm text-destructive">{visibilityError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
