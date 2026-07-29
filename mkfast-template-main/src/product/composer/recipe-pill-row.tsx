/**
 * 第二层 Skill pill 行 — D-164② / D-139.
 *
 * The recipes were already here as a card grid, sitting below the quote line
 * and the quota card, physically outside the prompt bar. Read top to bottom
 * that says the recipes are a panel of their own; D-164① says they are the
 * second level of the output-type axis, so they ride directly under it.
 *
 * Pills carry the recipe title only. The action label D-083 requires to be
 * always visible moves into the accessible name — see the deviation recorded
 * in `docs/tickets/261/01-ia-three-sections.md` §4.5, which is the one place
 * this design bends D-083 and is flagged for ratification. The summary, which
 * has nowhere to sit on a pill, rides the native `title` tooltip; the full
 * catalog is unchanged and still reachable from the tools strip.
 *
 * No cap here: `listVisibleRecipeCards` already applies the D-084 P0 caps, and
 * a second limiter would silently disagree with the first.
 */

import { cn } from '@/lib/utils';
import {
  composer_recipe_pill_action_aria,
  composer_recipe_pill_group_aria,
} from '@/locale/paraglide/messages';

import { COMPOSER_CARD_TEXT_CLASS } from './mobile-layout';
import { groupRecipeCardsByMarketingTask } from './recipe-marketing-groups';
import type { RecipeCardView } from './recipe-cards';

export type RecipePillRowProps = {
  cards: readonly RecipeCardView[];
  onSelectCard: (card: RecipeCardView) => void;
  className?: string;
};

export function RecipePillRow({
  cards,
  onSelectCard,
  className,
}: RecipePillRowProps) {
  const groups = groupRecipeCardsByMarketingTask(cards);
  if (groups.length === 0) return null;

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-group-count={groups.length}
      data-testid="composer-recipe-pill-row"
    >
      {groups.map((group) => (
        // fieldset/legend rather than a div wearing an ARIA grouping role: the
        // grouping is the point of this row, and the native pair carries it
        // without a patch. The aria-label overrides the legend for the accessible
        // name on purpose — the visible label is a bare noun phrase, and a
        // screen reader is better served by the whole sentence.
        <fieldset
          aria-label={composer_recipe_pill_group_aria({ group: group.label })}
          className="m-0 flex flex-col gap-1 border-0 p-0"
          data-testid={`composer-recipe-pill-group-${group.id}`}
          key={group.id}
        >
          <legend className="meiye-type-aux">{group.label}</legend>
          <div className="flex flex-wrap gap-2">
            {group.cards.map((card) => {
              const actionText = card.available
                ? card.actionLabel
                : (card.unavailableReason ?? '暂不可用');
              return (
                <button
                  // 状态不只靠颜色：disabled、aria-disabled 与 cursor 三路同时给
                  // 出，读屏在浏览模式下也能连着 aria-label 里的原因一起念。
                  aria-disabled={!card.available}
                  aria-label={composer_recipe_pill_action_aria({
                    action: actionText,
                    title: card.title,
                  })}
                  className={cn(
                    // Same pill family as the lens axis right above it — they
                    // are one control surface, not two that happen to be near.
                    'inline-flex min-h-12 min-w-12 items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    COMPOSER_CARD_TEXT_CLASS,
                    card.available
                      ? 'border-input bg-background text-foreground hover:bg-accent'
                      : 'border-input bg-background text-muted-foreground cursor-not-allowed'
                  )}
                  data-available={card.available ? 'true' : 'false'}
                  data-card-lens={card.lensId ?? 'none'}
                  // Keeps the id the grid used: it names the recipe entry, not
                  // the shape it is drawn in, and five journeys reach a recipe
                  // through it. Renaming would have been a rename of the
                  // contract dressed up as a re-skin.
                  data-no-truncate="true"
                  data-testid={`composer-recipe-card-${card.cardKey}`}
                  disabled={!card.available}
                  key={card.cardKey}
                  onClick={() => {
                    if (card.available) onSelectCard(card);
                  }}
                  title={card.summary}
                  type="button"
                >
                  {card.title}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
