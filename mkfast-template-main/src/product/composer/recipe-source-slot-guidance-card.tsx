import {
  composer_recipe_slot_case_image_body,
  composer_recipe_slot_case_image_body_no_fallback,
  composer_recipe_slot_case_image_title,
  composer_recipe_slot_generic_body,
  composer_recipe_slot_generic_body_no_fallback,
  composer_recipe_slot_generic_title,
  composer_recipe_slot_switch,
  composer_recipe_slot_upload,
} from '@/locale/paraglide/messages';
import { Button } from '@/components/ui/button';

export function RecipeSourceSlotGuidanceCard({
  canSwitch = true,
  onSwitch,
  onUpload,
  slot,
}: {
  canSwitch?: boolean;
  onSwitch: () => void;
  onUpload: () => void;
  slot: string;
}) {
  const isCaseImage = slot === 'case_image';
  const body = isCaseImage
    ? canSwitch
      ? composer_recipe_slot_case_image_body()
      : composer_recipe_slot_case_image_body_no_fallback()
    : canSwitch
      ? composer_recipe_slot_generic_body()
      : composer_recipe_slot_generic_body_no_fallback();
  return (
    <div
      className="space-y-2 rounded-xl border border-border bg-muted/30 p-3"
      data-can-switch={canSwitch ? 'true' : 'false'}
      data-slot={slot}
      data-testid="composer-recipe-slot-guidance"
      role="alert"
    >
      <p className="text-sm font-medium text-foreground">
        {isCaseImage
          ? composer_recipe_slot_case_image_title()
          : composer_recipe_slot_generic_title()}
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="composer-recipe-slot-upload"
          onClick={onUpload}
          size="sm"
          type="button"
        >
          {composer_recipe_slot_upload()}
        </Button>
        {canSwitch ? (
          <Button
            data-testid="composer-recipe-slot-switch"
            onClick={onSwitch}
            size="sm"
            type="button"
            variant="outline"
          >
            {composer_recipe_slot_switch()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
