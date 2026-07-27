/**
 * S3 P0-3 — one set of plan quotas reaches a dev stack.
 *
 * `pnpm dev` loads the repo `.env.example` (package.json), and
 * `productPlanConfigFromEnv` lets any value there outrank the code seed. The
 * example file used to carry the pre-D-123 numbers (starter 30/10/5, growth
 * 100/40/20, pro 300/120/60), so a developer's ProductState metered against one
 * set of quotas while /pricing quoted the admin-config seed — the same two
 * public surfaces disagreeing that D-143 exists to stop, one layer down.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PUBLIC_PLAN_ALLOWANCE_SEED } from '@meiye/contracts';

import { defaultProductPlanConfig, productPlanConfigFromEnv } from './plans.js';

const envExample = readFileSync(
  fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
  'utf8',
);

test('the code seed states the D-123 numbers for every published plan', () => {
  for (const offer of PUBLIC_PLAN_ALLOWANCE_SEED) {
    const plan = defaultProductPlanConfig[offer.id as 'starter' | 'growth' | 'pro'];
    assert.equal(plan.content, offer.allowance.copy, `${offer.id} copy`);
    assert.equal(plan.image, offer.allowance.image, `${offer.id} image`);
    assert.equal(plan.video, offer.allowance.video, `${offer.id} video`);
    assert.equal(
      plan.concurrencyLimit,
      offer.concurrencyLimit,
      `${offer.id} concurrency`,
    );
  }
});

test('the shared .env.example carries no plan quota to outrank it', () => {
  const overrides = envExample
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) =>
      /^(TRIAL|STARTER|GROWTH|PRO)_(CONTENT|IMAGE|VIDEO|PACKAGE)_ALLOWANCE\s*=/u.test(
        line.trim(),
      ),
    );
  assert.deepEqual(
    overrides,
    [],
    'a quota here becomes the dev default and forks from the manifest (D-132)',
  );
});

test('an explicit deployment override still wins, and only where it is set', () => {
  // Removing the example values must not disable the override mechanism —
  // a real deployment can still repoint a single tier.
  const config = productPlanConfigFromEnv({ STARTER_CONTENT_ALLOWANCE: '7' });
  assert.equal(config.starter.content, 7);
  assert.equal(config.starter.image, defaultProductPlanConfig.starter.image);
  assert.equal(config.growth.content, defaultProductPlanConfig.growth.content);
});
