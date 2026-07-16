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
        <span className="meiye-media-mask absolute inset-x-0 bottom-0 px-3 pt-8 pb-2 text-sm font-medium text-white">
          {scene.label}
        </span>
      </span>
    </Button>
  );
}
