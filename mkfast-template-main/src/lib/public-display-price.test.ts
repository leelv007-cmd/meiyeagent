import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_DISPLAY_PRICE_CENTS,
  describePriceLadderProblems,
} from './public-display-price';

describe('the quoted ladder holds together', () => {
  it('states no problem with what the pages quote today', () => {
    assert.deepEqual(describePriceLadderProblems(), []);
  });

  /**
   * The pair that actually shipped on 2026-07-28: the monthly figure moved
   * ¥399 → ¥1999 inside a landing-polish commit and the yearly figure stayed
   * at ¥3990, leaving a year on sale for two months' money.
   */
  it('catches a monthly rise that leaves the yearly figure behind', () => {
    const problems = describePriceLadderProblems({
      ...PUBLIC_DISPLAY_PRICE_CENTS,
      growthMonthly: 199900,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /two months or less/u);
  });

  it('catches a yearly plan that costs more than paying monthly', () => {
    const problems = describePriceLadderProblems({
      ...PUBLIC_DISPLAY_PRICE_CENTS,
      growthYearly: PUBLIC_DISPLAY_PRICE_CENTS.growthMonthly * 12,
    });
    assert.match(problems.join(' '), /nobody would pick it/u);
  });

  it('catches a lifetime plan that undercuts a single year', () => {
    const problems = describePriceLadderProblems({
      ...PUBLIC_DISPLAY_PRICE_CENTS,
      lifetime: PUBLIC_DISPLAY_PRICE_CENTS.growthYearly,
    });
    assert.match(problems.join(' '), /nothing to offer/u);
  });
});
