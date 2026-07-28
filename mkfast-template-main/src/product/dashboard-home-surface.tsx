/**
 * D-126 Dashboard home surface — hot and cold state of the same page.
 *
 * The page opens with `DashboardHomeGreeting` and nothing else: the first thing
 * the shop owner reads is an invitation to post, not a meter. This surface is
 * the rest of the page and renders *below* the Composer, so no panel competes
 * with the main axis — least of all an empty one, which is what a cold
 * workspace's recommendation is. The per-run allowance is stated where it is
 * spent (next to the Composer's send button), so there is no balance panel here.
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
  workbench_greeting,
  workbench_greeting_fallback,
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
import { workbenchGreetingName } from './workbench-state-model';

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

/**
 * DESIGN.md §3 问候语法则 — the one Display on this screen: 称呼 + a single
 * invitation to act, never a metric or a feature title. Its own export because
 * it is the only part of this page that belongs above the Composer; everything
 * else (`DashboardHomeSurface`) renders below it so no panel competes with the
 * main axis.
 *
 * `.meiye-ambient-copy` is the container every page header uses for copy that
 * rides the ambient backdrop; `.meiye-greeting` carries the Display metrics and
 * declares no colour of its own, so it inherits the shell's ink gradient in
 * both themes rather than the hard-coded white of `.meiye-type-display`.
 */
export function DashboardHomeGreeting({
  state,
}: {
  state: ProductState | undefined;
}) {
  // Confirmed store first, the half-finished intake draft second; neither
  // exists on a brand-new workspace, and then the greeting keeps the generic
  // 店主 form rather than inventing a name.
  const greetingName = workbenchGreetingName(
    state?.store?.name,
    state?.storeDraft?.extracted.name
  );

  return (
    <div className="meiye-ambient-copy">
      <h1 className="meiye-greeting" data-testid="dashboard-greeting">
        {greetingName
          ? workbench_greeting({ name: greetingName })
          : workbench_greeting_fallback()}
      </h1>
    </div>
  );
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
      <TodayRecommendationCard
        onStart={onStart}
        onUse={prefill}
        workspaceId={state?.workspaceId}
      />

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
