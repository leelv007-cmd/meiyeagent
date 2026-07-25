/**
 * D-126 cold-state Dashboard home: three platform-maintained sample stores
 * (C-5 护发 / 皮肤管理 / 生发). Browsing is read-only and free; remixing an
 * example only prefills the Composer draft — it never auto-submits or charges.
 */

import { Button } from '@/components/ui/button';
import {
  example_store_industry_aria,
  example_store_showcase_description,
  example_store_showcase_title,
} from '@/locale/paraglide/messages';
import type { ExampleStore } from '@meiye/contracts';
import { useState } from 'react';

import { exampleStoreIndustryLabel } from './creation-entry-model';
import { ExampleStorePreview } from './example-store-preview';

export function ExampleStoreShowcase({
  hideError,
  hiding,
  onHide,
  onRemix,
  stores,
}: {
  hideError?: string;
  hiding: boolean;
  onHide: () => void;
  onRemix: (intent: string) => void;
  stores: ExampleStore[];
}) {
  const [selectedId, setSelectedId] = useState(stores[0]?.id ?? '');
  const selected = stores.find((store) => store.id === selectedId) ?? stores[0];

  if (!selected) return null;

  return (
    <section
      aria-labelledby="example-store-showcase-title"
      className="space-y-5"
      data-testid="example-store-showcase"
    >
      <div>
        <h2
          className="text-base font-semibold"
          id="example-store-showcase-title"
        >
          {example_store_showcase_title()}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {example_store_showcase_description()}
        </p>
      </div>

      <div
        aria-label={example_store_industry_aria()}
        className="flex flex-wrap gap-2"
        role="radiogroup"
      >
        {stores.map((store) => (
          <Button
            aria-checked={selected.id === store.id}
            className="min-h-touch-target"
            key={store.id}
            onClick={() => setSelectedId(store.id)}
            role="radio"
            size="sm"
            type="button"
            variant={selected.id === store.id ? 'secondary' : 'outline'}
          >
            {exampleStoreIndustryLabel(store.industry)}
          </Button>
        ))}
      </div>

      <ExampleStorePreview
        example={selected}
        hideError={hideError}
        hiding={hiding}
        key={selected.id}
        onHide={onHide}
        onRemix={onRemix}
      />
    </section>
  );
}
