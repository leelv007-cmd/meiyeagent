import { Button } from '@/components/ui/button';
import { creation_entry_scene_preview_alt } from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';

import type { SceneChip } from './creation-entry-model';

export function SceneVisualButton({
  className,
  onSelect,
  scene,
  selected,
}: {
  className?: string;
  onSelect: () => void;
  scene: SceneChip;
  selected: boolean;
}) {
  return (
    <Button
      aria-pressed={selected}
      className={cn(
        'h-auto w-40 items-stretch justify-start overflow-hidden rounded-2xl p-0 text-left whitespace-normal',
        className
      )}
      onClick={onSelect}
      type="button"
      variant={selected ? 'secondary' : 'outline'}
    >
      <span className="relative block w-full">
        <img
          alt={creation_entry_scene_preview_alt({ name: scene.label })}
          className="aspect-[16/10] w-full object-cover"
          loading="lazy"
          src={scene.imageUrl}
        />
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface-0/95 via-surface-0/75 to-transparent px-3 pt-6 pb-2 font-semibold text-foreground">
          {scene.label}
        </span>
      </span>
    </Button>
  );
}
