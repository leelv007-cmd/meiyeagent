import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCatalogReturnSnapshot,
  saveCatalogReturnSnapshot,
} from './catalog-return-store';

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

test('catalog return snapshot restores only tab/filter/scroll/focus fields', () => {
  const storage = new MemoryStorage();
  const key = saveCatalogReturnSnapshot(
    {
      tab: 'templates',
      category: 'video',
      scrollY: 420,
      focusKey: 'recipe.video_1',
      surfaceRevisionId: 'surface.home.launch@7',
    },
    storage,
    'return-1'
  );

  assert.equal(key, 'return-1');
  assert.deepEqual(loadCatalogReturnSnapshot(key, storage), {
    tab: 'templates',
    category: 'video',
    scrollY: 420,
    focusKey: 'recipe.video_1',
    surfaceRevisionId: 'surface.home.launch@7',
    returnKey: 'return-1',
  });
  assert.equal(storage.getItem('composer.catalog.return:return-1'), null);
});

test('catalog return snapshot rejects tools tab and sensitive storage payloads', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    'composer.catalog.return:bad-tools',
    JSON.stringify({
      tab: 'tools',
      category: 'all',
      scrollY: 0,
    })
  );
  assert.equal(loadCatalogReturnSnapshot('bad-tools', storage), null);

  storage.setItem(
    'composer.catalog.return:bad',
    JSON.stringify({
      tab: 'templates',
      category: 'featured',
      scrollY: 0,
      prompt: 'must-not-survive',
    })
  );
  assert.equal(loadCatalogReturnSnapshot('bad', storage), null);
});
