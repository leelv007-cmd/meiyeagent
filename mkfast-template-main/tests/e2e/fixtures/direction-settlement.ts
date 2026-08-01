export type DirectionSettlementProof =
  | {
      attribute: 'aria-pressed';
      target: 'direction';
      value: 'true';
    }
  | {
      attribute: 'data-settlement';
      target: 'card';
      value: 'answered';
    };

/** Renderer-specific visible proof that a real direction click took effect. */
export function directionSettlementProof(
  productionRenderer: boolean
): DirectionSettlementProof {
  return productionRenderer
    ? { attribute: 'aria-pressed', target: 'direction', value: 'true' }
    : { attribute: 'data-settlement', target: 'card', value: 'answered' };
}
