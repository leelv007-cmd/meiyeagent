import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { CatalogSearch } from './catalog-route-model';
import {
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
  onNavigateHref: _onNavigateHref,
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
  const source = useMemo(
    () =>
      sourceQuery.data
        ? catalogItemSourceFromLive(sourceQuery.data.surface)
        : undefined,
    [sourceQuery.data]
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
    if (item.locked) return;
    if (item.kind !== 'template' || !item.recipeRevisionId) return;
    onSelectRecipe({
      recipeRevisionId: item.recipeRevisionId,
      surfaceRevisionId: sourceQuery.data.surface.revisionId,
    });
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
