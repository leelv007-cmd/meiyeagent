/**
 * Six-card / P0 recipe card grid (C2 / #96 + C3 / #97, D-083 / D-084).
 *
 * - Each card is a single <button> (no nested interactive controls)
 * - Action label always visible (not hover-only)
 * - Touch target ≥ 48×48
 * - Cold: two-col three-row; after lens: P0 caps
 * - singleColumn (<280px / 200%): no line-clamp truncation (D-084)
 */

import { cn } from '@/lib/utils';

import { COMPOSER_CARD_TEXT_CLASS } from './mobile-layout';
import type { RecipeCardView } from './recipe-cards';

export type RecipeCardGridProps = {
  cards: RecipeCardView[];
  onSelectCard: (card: RecipeCardView) => void;
  /** Optional class on the grid container. */
  className?: string;
  /** When true, use single-column layout (<280px / 200% zoom). */
  singleColumn?: boolean;
};

export function RecipeCardGrid({
  cards,
  onSelectCard,
  className,
  singleColumn = false,
}: RecipeCardGridProps) {
  return (
    <div
      data-testid="composer-recipe-card-grid"
      data-card-count={cards.length}
      data-single-column={singleColumn ? 'true' : 'false'}
      data-columns={singleColumn ? '1' : '2'}
      className={cn(
        'grid gap-3',
        singleColumn ? 'grid-cols-1' : 'grid-cols-2',
        className
      )}
    >
      {cards.map((card) => (
        <RecipeCardButton
          key={card.cardKey}
          card={card}
          singleColumn={singleColumn}
          onSelect={() => {
            if (card.available) onSelectCard(card);
          }}
        />
      ))}
    </div>
  );
}

export type RecipeCardButtonProps = {
  card: RecipeCardView;
  onSelect: () => void;
  /** When true, never truncate title/summary/action (D-084 narrow path). */
  singleColumn?: boolean;
};

export function RecipeCardButton({
  card,
  onSelect,
  singleColumn = false,
}: RecipeCardButtonProps) {
  const actionText = card.available
    ? card.actionLabel
    : (card.unavailableReason ?? '暂不可用');

  const accessibleName = `${card.title}。${card.summary}。${actionText}`;
  // Always allow wrap; never line-clamp on the narrow/single-column path.
  const textClass = singleColumn
    ? COMPOSER_CARD_TEXT_CLASS
    : COMPOSER_CARD_TEXT_CLASS;

  return (
    <button
      type="button"
      data-testid={`composer-recipe-card-${card.cardKey}`}
      data-card-kind={card.kind}
      data-card-lens={card.lensId ?? 'none'}
      data-available={card.available ? 'true' : 'false'}
      data-no-truncate="true"
      disabled={!card.available}
      aria-label={accessibleName}
      className={cn(
        // min 48×48 touch target; no hover-only action discovery
        'flex min-h-12 w-full flex-col items-start gap-1 rounded-2xl border border-input bg-background p-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        card.available ? 'hover:bg-accent/40' : 'cursor-not-allowed opacity-60'
      )}
      onClick={() => {
        if (card.available) onSelect();
      }}
    >
      {card.previewAssetRef ? (
        <img
          src={card.previewAssetRef}
          alt=""
          aria-hidden="true"
          className="mb-1 h-16 w-full rounded-lg object-cover"
        />
      ) : null}
      <span className={cn('text-sm font-semibold text-foreground', textClass)}>
        {card.title}
      </span>
      <span
        className={cn('text-xs leading-5 text-muted-foreground', textClass)}
      >
        {card.summary}
      </span>
      <span
        className={cn(
          'mt-1 text-xs font-medium',
          textClass,
          card.available ? 'text-primary' : 'text-muted-foreground'
        )}
        data-testid={`composer-recipe-card-action-${card.cardKey}`}
      >
        {actionText}
      </span>
    </button>
  );
}
