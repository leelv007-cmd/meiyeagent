import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSurfaceProjection } from '@meiye/contracts';

import {
  CatalogLivePage,
  type CatalogRecipeSelection,
} from './catalog-live-page';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const surface = {
  surfaceId: 'surface.home.launch',
  revision: 7,
  revisionId: 'surface.home.launch@7',
  status: 'published',
  contentHash: 'surface-hash',
  recipeRefs: [
    {
      recipeRevisionId: 'recipe.server@7',
      lensId: 'copy',
      order: 1,
      featured: true,
      visible: true,
    },
  ],
  recipes: [
    {
      recipeId: 'recipe.server',
      revision: 7,
      revisionId: 'recipe.server@7',
      status: 'published',
      lensId: 'copy',
      presentation: { title: '服务端实时模板', summary: '非本地种子' },
      delivery: {},
      contextPatches: {},
      sourceRequirements: [],
      modelPolicy: { mode: 'auto' },
      settingsPatches: {},
      promptRevisionRef: 'prompt@7',
      targetWorkspaceKind: 'copy',
      contentHash: 'recipe-hash',
    },
  ],
} satisfies BrowserSurfaceProjection;

afterEach(cleanup);

function renderCatalog(input: { storage: Storage; returnKey?: string }) {
  const queryCalls: Array<{ action: string }> = [];
  const query = vi.fn(async (_module: unknown, call: { action: string }) => {
    queryCalls.push(call);
    return surface;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const selected = vi.fn((_selection: CatalogRecipeSelection) => undefined);
  const navigated = vi.fn((_href: string) => undefined);
  render(
    <QueryClientProvider client={client}>
      <CatalogLivePage
        search={input.returnKey ? { returnKey: input.returnKey } : {}}
        query={query as never}
        storage={input.storage}
        onSelectRecipe={selected}
        onNavigateHref={navigated}
        onBack={() => undefined}
      />
    </QueryClientProvider>
  );
  return { query, queryCalls, selected, navigated };
}

describe('live fullscreen catalog', () => {
  it('selects live Recipe revisions without a tools tab or tool_list query', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const first = renderCatalog({ storage });

    await user.click(await screen.findByText('服务端实时模板'));
    expect(first.selected).toHaveBeenCalledWith({
      recipeRevisionId: 'recipe.server@7',
      surfaceRevisionId: 'surface.home.launch@7',
    });
    // Surface only — no parallel tool_list fetch.
    expect(first.query).toHaveBeenCalledTimes(1);
    expect(first.queryCalls.map((call) => call.action)).toEqual([
      'surface_browser',
    ]);

    expect(
      screen.queryByTestId('composer-catalog-tab-tools')
    ).not.toBeInTheDocument();
    expect(first.navigated).not.toHaveBeenCalled();
  });
});
