import type { RecipeSourceRequirement } from '@meiye/contracts';

import {
  composer_library_pick_action,
  composer_library_pick_empty,
  composer_library_pick_none_eligible,
  composer_library_pick_title,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';

import {
  listEligibleLibraryAssetsForSlots,
  type LibrarySlotAsset,
} from './recipe-source-slot-readiness';

function assetLabel(asset: LibrarySlotAsset): string {
  const tagged = asset.tags?.find((tag) => tag.trim());
  if (tagged) return tagged;
  if (asset.category === 'customer_case') return '顾客案例';
  if (asset.category === 'before_after') return '前后对比';
  if (asset.category === 'store') return '门店图';
  if (asset.category === 'price_list') return '价目';
  return asset.id;
}

export function ComposerLibrarySourcePicker({
  assets,
  onPick,
  requirements,
  selectedAssetIds,
}: {
  assets: readonly LibrarySlotAsset[];
  onPick: (asset: LibrarySlotAsset) => void;
  requirements: readonly RecipeSourceRequirement[] | undefined;
  selectedAssetIds: readonly string[];
}) {
  const eligible = listEligibleLibraryAssetsForSlots({ assets, requirements });
  const hasAuthorized = assets.some(
    (asset) => asset.authorizationStatus === 'authorized'
  );

  return (
    <section
      className="space-y-2 border-t border-border pt-3"
      data-testid="composer-library-source-picker"
    >
      <h4 className="text-sm font-medium text-foreground">
        {composer_library_pick_title()}
      </h4>
      {eligible.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="composer-library-source-empty"
        >
          {hasAuthorized
            ? composer_library_pick_none_eligible()
            : composer_library_pick_empty()}
        </p>
      ) : (
        <ul className="space-y-1">
          {eligible.map((asset) => {
            const selected = selectedAssetIds.includes(asset.id);
            const preview = asset.objectKey
              ? `/api/storage/file?key=${encodeURIComponent(asset.objectKey)}`
              : null;
            return (
              <li key={asset.id}>
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm',
                    selected
                      ? 'bg-muted text-muted-foreground'
                      : 'hover:bg-muted/70'
                  )}
                  data-selected={selected ? 'true' : 'false'}
                  data-testid={`composer-library-source-${asset.id}`}
                  disabled={selected}
                  onClick={() => onPick(asset)}
                  type="button"
                >
                  {preview ? (
                    <img
                      alt=""
                      className="size-10 shrink-0 rounded-lg object-cover"
                      src={preview}
                    />
                  ) : (
                    <span className="bg-muted size-10 shrink-0 rounded-lg" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {assetLabel(asset)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {composer_library_pick_action()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
