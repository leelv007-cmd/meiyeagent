/**
 * Merchant capability-pack pills on the Composer recipe catalog (Spec E / #380).
 *
 * Same pill family as the recipe row (D-164② / recipe-pill-row). Confirm-style
 * user_selectable toggles only mutate the Composer draft; explainable is a
 * readonly “this run” chip; backend_only never renders. Engineering fields
 * (revision refs, provider IDs, governance) stay out of the DOM surface.
 */

import { cn } from '@/lib/utils';
import {
  composer_skill_capability_explainable_aria,
  composer_skill_capability_explainable_prefix,
  composer_skill_capability_group_aria,
  composer_skill_capability_group_label,
  composer_skill_capability_pill_aria,
  composer_skill_capability_select,
  composer_skill_capability_selected,
} from '@/locale/paraglide/messages';

import { COMPOSER_CARD_TEXT_CLASS } from './mobile-layout';
import {
  projectSkillCapabilityViews,
  type SkillCapabilityItemInput,
} from './skill-capability-selection';

export type SkillCapabilityPillRowProps = {
  items: readonly SkillCapabilityItemInput[];
  selectedSkillRevisionRefs: readonly string[];
  onToggleSelectable: (skillRevisionRef: string) => void;
  className?: string;
};

export function SkillCapabilityPillRow({
  items,
  selectedSkillRevisionRefs,
  onToggleSelectable,
  className,
}: SkillCapabilityPillRowProps) {
  const views = projectSkillCapabilityViews(items, selectedSkillRevisionRefs);
  if (views.length === 0) return null;

  return (
    <fieldset
      aria-label={composer_skill_capability_group_aria()}
      className={cn('m-0 flex flex-col gap-1 border-0 p-0', className)}
      data-testid="composer-skill-capability-pill-row"
    >
      <legend className="meiye-type-aux">
        {composer_skill_capability_group_label()}
      </legend>
      <div className="flex flex-wrap gap-2">
        {views.map((view) => {
          if (view.kind === 'explainable') {
            const label = `${composer_skill_capability_explainable_prefix()}: ${view.title}`;
            return (
              <span
                className={cn(
                  'inline-flex min-h-12 min-w-12 items-center rounded-full border px-4 py-2 text-sm font-medium',
                  'border-input bg-muted text-muted-foreground',
                  COMPOSER_CARD_TEXT_CLASS
                )}
                data-kind="explainable"
                data-skill-id={view.skillId}
                data-testid={`composer-skill-explainable-${view.skillId}`}
                key={`explainable:${view.skillId}`}
                title={view.summary}
              >
                <span className="sr-only">
                  {composer_skill_capability_explainable_aria({
                    title: view.title,
                  })}
                </span>
                <span aria-hidden="true">{label}</span>
              </span>
            );
          }

          const action = view.selected
            ? composer_skill_capability_selected()
            : composer_skill_capability_select();
          return (
            <button
              aria-label={composer_skill_capability_pill_aria({
                action,
                title: view.title,
              })}
              aria-pressed={view.selected}
              className={cn(
                'inline-flex min-h-12 min-w-12 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                COMPOSER_CARD_TEXT_CLASS,
                view.selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input bg-background text-foreground hover:bg-accent'
              )}
              data-kind="user_selectable"
              data-selected={view.selected ? 'true' : 'false'}
              data-skill-id={view.skillId}
              data-testid={`composer-skill-selectable-${view.skillId}`}
              key={`selectable:${view.skillId}`}
              onClick={() => {
                onToggleSelectable(view.skillRevisionRef);
              }}
              title={view.summary}
              type="button"
            >
              {view.title}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
