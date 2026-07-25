import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useProStudioEntitlement } from '@/hooks/use-pro-studio-entitlement';

import { saveCatalogReturnSnapshot } from './catalog-return-store';
import type { CatalogSearch } from './catalog-route-model';
import {
  captureCatalogReturnSnapshot,
  catalogItemSourceFromLive,
  catalogStateFromSearch,
  restoreCatalogUiState,
  type CatalogItemView,
  type CatalogReturnRestoreSnapshot,
  type CatalogUiState,
} from './fullscreen-catalog';
import { FullscreenCatalogPanel } from './fullscreen-catalog-panel';
import {
  fetchComposerCatalogSource,
  type ComposerQueryTransport,
} from './composer-live';
import {
  assertProStudioCanonicalHref,
  openComposerTool,
} from './composer-tools';
import { loadCatalogReturnSnapshot } from './catalog-return-store';

export type CatalogRecipeSelection = {
  recipeRevisionId: string;
  surfaceRevisionId: string;
};

export type CatalogLivePageProps = {
  search: CatalogSearch;
  query?: ComposerQueryTransport;
  storage?: Storage;
  onReplaceState?: (state: CatalogUiState) => void;
  onSelectRecipe: (selection: CatalogRecipeSelection) => void;
  onNavigateHref: (href: string) => void;
  onBack: (snapshot: CatalogReturnRestoreSnapshot) => void;
};

export function CatalogLivePage({
  search,
  query,
  storage,
  onReplaceState,
  onSelectRecipe,
  onNavigateHref,
  onBack,
}: CatalogLivePageProps) {
  const initialState = useMemo(() => {
    const restored = loadCatalogReturnSnapshot(search.returnKey, storage);
    return restored
      ? restoreCatalogUiState(restored)
      : catalogStateFromSearch(search);
    // Entry URL and one-shot return snapshot hydrate once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<CatalogUiState>(initialState);
  const sourceQuery = useQuery({
    queryKey: ['composer', 'fullscreen-catalog', search.surfaceRevisionId],
    queryFn: ({ signal }) => fetchComposerCatalogSource(signal, query),
  });
  const entitlement = useProStudioEntitlement();
  const source = useMemo(
    () =>
      sourceQuery.data
        ? {
            ...catalogItemSourceFromLive(
              sourceQuery.data.surface,
              sourceQuery.data.tools
            ),
            proStudioStatus: entitlement.projection.state,
            ...(entitlement.reason
              ? { proStudioLockReason: entitlement.reason }
              : {}),
          }
        : undefined,
    [entitlement.projection.state, entitlement.reason, sourceQuery.data]
  );

  useEffect(() => {
    const revisionId = sourceQuery.data?.surface.revisionId;
    if (!revisionId || state.surfaceRevisionId === revisionId) return;
    const next = { ...state, surfaceRevisionId: revisionId };
    setState(next);
    onReplaceState?.(next);
  }, [onReplaceState, sourceQuery.data, state]);

  const publishState = (next: CatalogUiState) => {
    setState(next);
    onReplaceState?.(next);
  };

  const selectItem = (item: CatalogItemView) => {
    if (!sourceQuery.data) return;
    // Pro Studio stays reachable in every state: the canonical gate page is
    // where the merchant sees the real entitlement and can unlock (R-08).
    if (item.locked && !item.isProStudioBanner) return;
    if (item.kind === 'template') {
      if (!item.recipeRevisionId) return;
      onSelectRecipe({
        recipeRevisionId: item.recipeRevisionId,
        surfaceRevisionId: sourceQuery.data.surface.revisionId,
      });
      return;
    }
    if (!item.toolEntryId) return;
    const snapshot = captureCatalogReturnSnapshot({
      ...state,
      focusKey: item.id,
      surfaceRevisionId: sourceQuery.data.surface.revisionId,
    });
    const returnKey = saveCatalogReturnSnapshot(snapshot, storage);
    const opened = openComposerTool(item.toolEntryId, {
      returnToDraftKey: returnKey,
      focusKey: item.id,
      surfaceRevisionId: sourceQuery.data.surface.revisionId,
    });
    if (item.toolEntryId === 'tool.pro_studio') {
      assertProStudioCanonicalHref(opened.href);
    }
    onNavigateHref(opened.href);
  };

  if (sourceQuery.isPending) {
    return <output>正在读取创作目录…</output>;
  }
  if (sourceQuery.isError || !source) {
    return (
      <div role="alert">
        <p>创作目录暂时不可用</p>
        <button type="button" onClick={() => void sourceQuery.refetch()}>
          重新读取
        </button>
      </div>
    );
  }

  return (
    <FullscreenCatalogPanel
      state={state}
      source={source}
      onStateChange={publishState}
      onSelectItem={selectItem}
      onBack={onBack}
    />
  );
}
