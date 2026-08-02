/**
 * #305 owns the outbound purchase intent; #310 owns the matching pricing
 * sections. Keep the anchors stable so a shortfall always opens the right
 * action rather than a generic pricing landing.
 */
export const CREDIT_PURCHASE_DESTINATIONS = {
  booster: { to: '/pricing', hash: 'credit-boosters' },
  upgrade: { to: '/pricing', hash: 'subscription-plans' },
} as const;
