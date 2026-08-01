/**
 * Static gates for #286 P0-A workbench four-state fixes (F1/F6/F7/F8).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8');

test('P0-2: conversation pane does not set nested max-height on the className', () => {
  const source = readSource('src/product/composer/composer-conversation.tsx');
  // Class binding only — comments may still name the retired height cap.
  const classBindings = [
    ...source.matchAll(/className="([^"]*)"/gu),
    ...source.matchAll(/className=\{`([^`]*)`\}/gu),
  ].map((match) => match[1] ?? '');
  for (const className of classBindings) {
    assert.doesNotMatch(className, /70svh/u);
    assert.doesNotMatch(className, /max-h-\[min\(/u);
  }
  assert.match(source, /className="meiye-conversation-pane"/u);
});

test('P0-3: delivery case does not pass stream body as excerpt', () => {
  const source = readSource('src/product/composer/composer-conversation.tsx');
  // The dual-read failure was: excerpt={{ body: stream.primary.body, ... }}
  assert.doesNotMatch(source, /excerpt=\{\s*stream\.primary/u);
  assert.match(source, /composer-candidate-summary/u);
  assert.match(source, /candidateShouldCollapse/u);
});

test('P0-4: TodayRecommendationCard onUse is typed handoff', () => {
  const card = readSource('src/product/today-recommendation-card.tsx');
  assert.match(card, /RecommendationHandoff/u);
  assert.match(card, /buildRecommendationHandoff/u);
  assert.doesNotMatch(card, /onUse:\s*\(intent:\s*string\)\s*=>\s*void/u);
});
