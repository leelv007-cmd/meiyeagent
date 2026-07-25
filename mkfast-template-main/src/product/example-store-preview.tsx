import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
  example_store_asset_preview_alt,
  example_store_asset_summary,
  example_store_assets_title,
  example_store_browsing_no_allowance,
  example_store_content_aria,
  example_store_content_preview_alt,
  example_store_content_title,
  example_store_eyebrow,
  example_store_facts_title,
  example_store_handoff_readonly,
  example_store_handoff_title,
  example_store_hide,
  example_store_hide_error,
  example_store_hide_retry,
  example_store_hiding,
  example_store_preview_badge,
  example_store_profile,
  example_store_remix,
  example_store_remix_description,
} from '@/locale/paraglide/messages';
import type { ProductState } from '@meiye/contracts';
import {
  IconBuildingStore,
  IconCheck,
  IconChevronRight,
  IconEyeOff,
  IconFileText,
  IconPackage,
  IconPhoto,
  IconSparkles,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { exampleRemixIntent } from './creation-entry-model';

type ExampleStore = ProductState['exampleStores'][number];

export function ExampleStorePreview({
  example,
  hideError,
  hiding,
  onHide,
  onRemix,
}: {
  example: ExampleStore;
  hideError?: string;
  hiding: boolean;
  onHide: () => void;
  onRemix: (intent: string) => void;
}) {
  const [selectedContentId, setSelectedContentId] = useState(
    example.contentPreviews[0]?.id ?? ''
  );
  const selected =
    example.contentPreviews.find((item) => item.id === selectedContentId) ??
    example.contentPreviews[0];

  useEffect(() => {
    if (!selected && example.contentPreviews[0]) {
      setSelectedContentId(example.contentPreviews[0].id);
    }
  }, [example.contentPreviews, selected]);

  return (
    <section
      aria-labelledby="example-store-title"
      className="space-y-6 border-t border-divider pt-6"
      data-i18n-pass-through="business-example"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <IconBuildingStore aria-hidden="true" className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium tracking-wide text-primary uppercase">
                {example_store_eyebrow()}
              </p>
              <Badge variant="secondary">{example_store_preview_badge()}</Badge>
            </div>
            <h3 className="mt-2 text-lg font-semibold" id="example-store-title">
              {example.name}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {example_store_profile({
                city: example.profile.city,
                price: example.profile.confirmedPrice,
                project: example.profile.project,
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {example_store_browsing_no_allowance()}
            </p>
          </div>
        </div>
        <Button
          className="min-h-touch-target"
          disabled={hiding}
          onClick={onHide}
          size="sm"
          type="button"
          variant="ghost"
        >
          <IconEyeOff aria-hidden="true" />
          {hiding ? example_store_hiding() : example_store_hide()}
        </Button>
      </div>

      {hideError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{example_store_hide_error()}</p>
          <Button
            className="mt-2"
            onClick={onHide}
            size="sm"
            type="button"
            variant="outline"
          >
            {example_store_hide_retry()}
          </Button>
        </div>
      ) : null}

      <div>
        <h4 className="text-sm font-semibold">{example_store_facts_title()}</h4>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {example.facts.map((fact) => (
            <div className="rounded-xl bg-surface-1 p-3 text-sm" key={fact.id}>
              <dt className="font-medium">{fact.label}</dt>
              <dd className="mt-1 leading-6 text-muted-foreground">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h4 className="text-sm font-semibold">
          {example_store_assets_title()}
        </h4>
        <ul className="mt-4 grid grid-cols-1 gap-4 border-y border-divider py-5 sm:grid-cols-2">
          {example.assetPreviews.map((asset) => (
            <li className="flow-root" key={asset.id}>
              <div className="group flex min-h-20 items-center gap-4 rounded-xl p-2 transition-colors hover:bg-muted/50">
                <div className="flex aspect-square size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-1">
                  {asset.previewUrl ? (
                    <img
                      alt={example_store_asset_preview_alt({
                        name: asset.label,
                      })}
                      className="size-full object-cover"
                      loading="lazy"
                      src={asset.previewUrl}
                    />
                  ) : (
                    <IconPhoto
                      aria-hidden="true"
                      className="size-6 text-muted-foreground"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{asset.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {example_store_asset_summary()}
                  </p>
                </div>
                <IconChevronRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Card className="gap-4 overflow-visible rounded-none bg-transparent py-0">
        <CardHeader className="rounded-none border-b border-divider px-0 pb-3">
          <CardTitle className="text-sm">
            {example_store_content_title()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 px-0">
          <div
            aria-label={example_store_content_aria()}
            className="grid gap-px overflow-hidden rounded-lg bg-divider sm:grid-cols-2 xl:grid-cols-3"
            role="radiogroup"
          >
            {example.contentPreviews.map((content) => {
              const previewUrl = content.previewUrl;
              return (
                <Button
                  aria-checked={selected?.id === content.id}
                  className="group h-auto min-w-0 flex-col items-stretch justify-start gap-0 rounded-none p-0 text-left whitespace-normal"
                  key={content.id}
                  onClick={() => setSelectedContentId(content.id)}
                  role="radio"
                  type="button"
                  variant={
                    selected?.id === content.id ? 'secondary' : 'outline'
                  }
                >
                  {previewUrl ? (
                    <img
                      alt={example_store_content_preview_alt({
                        name: content.title,
                      })}
                      className="aspect-[3/4] w-full object-cover"
                      loading="lazy"
                      src={previewUrl}
                    />
                  ) : (
                    <span className="grid aspect-[3/4] w-full place-items-center bg-surface-1 text-primary">
                      <IconFileText aria-hidden="true" className="size-8" />
                    </span>
                  )}
                  <span className="flex min-w-0 items-start gap-3 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{content.title}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {content.platform === 'xiaohongshu'
                          ? creation_entry_platform_xiaohongshu()
                          : creation_entry_platform_douyin()}
                      </span>
                      <span className="mt-2 block text-xs leading-5 font-normal text-muted-foreground">
                        {content.summary}
                      </span>
                    </span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:text-foreground">
                      {selected?.id === content.id ? (
                        <IconCheck aria-hidden="true" className="size-4" />
                      ) : (
                        <IconChevronRight
                          aria-hidden="true"
                          className="size-4"
                        />
                      )}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-4 text-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconPackage aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {example_store_handoff_title()}
              </p>
              <p className="mt-1 font-medium">{example.handoffPreview.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {example.handoffPreview.platform === 'xiaohongshu'
                  ? creation_entry_platform_xiaohongshu()
                  : creation_entry_platform_douyin()}{' '}
                · {example_store_handoff_readonly()}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-5">
            <Button
              disabled={!selected}
              onClick={() => {
                if (selected) onRemix(exampleRemixIntent(selected));
              }}
              type="button"
              variant="outline"
            >
              <IconSparkles aria-hidden="true" />
              {example_store_remix()}
            </Button>
            <p className="text-xs text-muted-foreground">
              {example_store_remix_description()}
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
