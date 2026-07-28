/**
 * Six-card / P0 recipe card grid (C2 / #96 + C3 / #97, D-083 / D-084).
 *
 * U04: the grid and the cards are the supply layer's `item-card-group` /
 * `item-card` units. The upstream units are dense list rows — a centred flex
 * row whose title and description end in an ellipsis — so the app-side
 * `.meiye-item-card-stack` adaptation (heroui-glass.css) stands them up as
 * cards and lets merchant sentences wrap. That adaptation is what D-084 needs:
 * this grid may never truncate on the narrow path.
 *
 * Behaviour the换壳 must not lose:
 * - Each card is a single <button> (no nested interactive controls)
 * - Action label always visible (not hover-only)
 * - Touch target ≥ 48×48
 * - Cold: two-col three-row; after lens: P0 caps
 * - singleColumn (<280px / 200%): no line-clamp truncation (D-084)
 */

import { ItemCard, ItemCardGroup } from '@/components/heroui-pro';
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
    <ItemCardGroup
      className={className}
      // `columns` is typed 2 | 3 upstream; the D-084 narrow path needs one
      // column, and the unit reads the same CSS variable either way.
      data-card-count={cards.length}
      data-columns={singleColumn ? '1' : '2'}
      data-single-column={singleColumn ? 'true' : 'false'}
      data-testid="composer-recipe-card-grid"
      layout="grid"
      style={
        {
          '--item-card-group-columns': singleColumn ? 1 : 2,
        } as React.CSSProperties
      }
      variant="transparent"
    >
      {cards.map((card) => (
        <RecipeCardButton
          card={card}
          key={card.cardKey}
          onSelect={() => {
            if (card.available) onSelectCard(card);
          }}
          singleColumn={singleColumn}
        />
      ))}
    </ItemCardGroup>
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
    <ItemCard<'button'>
      className={cn(
        // min 48×48 touch target; no hover-only action discovery
        'meiye-item-card-stack min-h-12 w-full gap-1 p-3 text-left transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        // 不可用不整卡降透明度：opacity 会把说明行和「暂不可用」的原因一起乘
        // 下去（ink-60 × 0.6 在白瓷上只剩 2.5:1），而原因恰恰是店主此刻唯一
        // 需要读的字。卡片照旧不可点，压暗只落在缩略图上。
        card.available ? 'hover:bg-accent/40' : 'cursor-not-allowed'
      )}
      data-available={card.available ? 'true' : 'false'}
      data-card-kind={card.kind}
      data-card-lens={card.lensId ?? 'none'}
      data-no-truncate="true"
      data-testid={`composer-recipe-card-${card.cardKey}`}
      // The card stays one <button> (D-083: no nested interactive controls).
      // The unit's `render` escape hatch is typed by the element it is told to
      // render, hence the `<'button'>` above.
      render={(props) => (
        <button
          {...props}
          // 状态不只靠颜色：不可点这件事同时由原生 disabled、aria-disabled 与
          // cursor-not-allowed 三路给出，读屏在浏览模式下能从 AX 树拿到禁用态，
          // 连着 aria-label 里的「暂不可用」原因一起念。
          aria-disabled={!card.available}
          aria-label={accessibleName}
          disabled={!card.available}
          onClick={() => {
            if (card.available) onSelect();
          }}
          type="button"
        />
      )}
    >
      {card.previewAssetRef ? (
        <img
          alt=""
          aria-hidden="true"
          className={cn(
            'mb-1 h-16 w-full rounded-lg object-cover',
            card.available ? undefined : 'opacity-50'
          )}
          src={card.previewAssetRef}
        />
      ) : null}
      <ItemCard.Content>
        <ItemCard.Title
          className={cn('text-foreground text-sm font-semibold', textClass)}
        >
          {card.title}
        </ItemCard.Title>
        <ItemCard.Description
          className={cn('text-muted-foreground text-xs leading-5', textClass)}
        >
          {card.summary}
        </ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action
        className={cn(
          'text-xs font-medium',
          textClass,
          card.available ? 'text-primary' : 'text-muted-foreground'
        )}
        data-testid={`composer-recipe-card-action-${card.cardKey}`}
      >
        {actionText}
      </ItemCard.Action>
    </ItemCard>
  );
}
