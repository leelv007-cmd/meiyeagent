/**
 * Responsive matrix tests (C3 / #97, D-084).
 * 320×720 / 390×844 / landscape / 200% → column + no-truncate contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSER_SINGLE_COLUMN_MAX_WIDTH,
  COMPOSER_VIEWPORT_FIXTURES,
  isTwoColumnMobileViewport,
  resolveComposerCardGridLayout,
} from './mobile-layout';
import { listColdCardsFromSeeds } from './recipe-cards';

test('320×720 cold six uses two columns (three rows)', () => {
  const layout = resolveComposerCardGridLayout(
    COMPOSER_VIEWPORT_FIXTURES.phone320,
    { cardCount: 6 }
  );
  assert.equal(layout.columns, 2);
  assert.equal(layout.singleColumn, false);
  assert.equal(layout.allowTruncate, false);
  assert.equal(layout.coldRows, 3);
  assert.equal(
    isTwoColumnMobileViewport(COMPOSER_VIEWPORT_FIXTURES.phone320),
    true
  );
});

test('390×844 cold six uses two columns (three rows)', () => {
  const layout = resolveComposerCardGridLayout(
    COMPOSER_VIEWPORT_FIXTURES.phone390,
    { cardCount: 6 }
  );
  assert.equal(layout.columns, 2);
  assert.equal(layout.singleColumn, false);
  assert.equal(layout.coldRows, 3);
});

test('landscape wide enough stays two-column', () => {
  const layout = resolveComposerCardGridLayout(
    COMPOSER_VIEWPORT_FIXTURES.landscape,
    { cardCount: 6 }
  );
  assert.equal(layout.columns, 2);
  assert.equal(layout.singleColumn, false);
});

test('200% zoom / width <280 uses single column without truncation', () => {
  const layout = resolveComposerCardGridLayout(
    COMPOSER_VIEWPORT_FIXTURES.zoom200,
    { cardCount: 6 }
  );
  assert.equal(layout.columns, 1);
  assert.equal(layout.singleColumn, true);
  assert.equal(layout.allowTruncate, false);
  assert.ok(
    COMPOSER_VIEWPORT_FIXTURES.zoom200.width < COMPOSER_SINGLE_COLUMN_MAX_WIDTH
  );
  assert.equal(
    isTwoColumnMobileViewport(COMPOSER_VIEWPORT_FIXTURES.zoom200),
    false
  );
});

test('boundary: width 279 single, 280 two-col', () => {
  assert.equal(
    resolveComposerCardGridLayout({ width: 279 }).singleColumn,
    true
  );
  assert.equal(
    resolveComposerCardGridLayout({ width: 280 }).singleColumn,
    false
  );
});

test('cold seeds still expose full six cards for the matrix', () => {
  const cards = listColdCardsFromSeeds();
  assert.equal(cards.length, 6);
  for (const card of cards) {
    assert.ok(card.title.length > 0);
    assert.ok(card.summary.length > 0);
    assert.ok(card.actionLabel.length > 0);
  }
});
