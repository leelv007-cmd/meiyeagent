import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProductContext, ProductState } from '@meiye/contracts';
import { LegacyBillingLedger } from './legacy-billing-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../..');

/**
 * Every production file allowed to append a usage row.
 *
 * The patterns below are deliberately blunt — any receiver, any file — so that
 * a new writer trips this list rather than slipping past a cleverer regex that
 * a rename could defeat. The cost is that the list has to explain itself:
 *
 *   - product/legacy-billing-ledger.ts — the authority. The only place a
 *     product command originates a charge, and the only place that decides
 *     whether the charge may happen at all.
 *   - p1/foundation/postgres-repository.ts, p1/cutover/execution-service.ts —
 *     projections, not origins. Both rebuild the legacy ProductState shape from
 *     the foundation ledger, which is why every row they write carries the
 *     `foundation:` id prefix.
 *   - p1/foundation/memory-repository.ts — a different ledger entirely. Its
 *     rows are foundation `UsageEvent`s keyed by workspaceId, held in the
 *     repository's own field; it never touches a ProductState.
 *
 * A fifth entry is a deliberate act. The point of the list is that it cannot be
 * added by forgetting.
 */
const USAGE_ROW_WRITERS = [
  'apps/core/src/p1/cutover/execution-service.ts',
  'apps/core/src/p1/foundation/memory-repository.ts',
  'apps/core/src/p1/foundation/postgres-repository.ts',
  'apps/core/src/product/legacy-billing-ledger.ts'
] as const;

/** memory-repository holds no entitlement, so this list is one shorter. */
const ENTITLEMENT_WRITERS = [
  'apps/core/src/p1/cutover/execution-service.ts',
  'apps/core/src/p1/foundation/postgres-repository.ts',
  'apps/core/src/product/legacy-billing-ledger.ts'
] as const;

const USAGE_EVENT_APPEND = /\busageEvents\.push\s*\(/u;
const ENTITLEMENT_MUTATION =
  /\bentitlement(?:\.[A-Za-z]+|\[[^\]]+\])(?:\.[A-Za-z]+)?\s*(?:\+=|-=|=(?!=))/u;

function childSourceRoots(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'src'))
    .filter((path) => existsSync(path));
}

const productionSourceRoots = [
  ...childSourceRoots(join(repositoryRoot, 'apps')),
  ...childSourceRoots(join(repositoryRoot, 'packages')),
  join(repositoryRoot, 'mkfast-template-main/src')
];

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

// deepEqual on purpose rather than a subset check: a writer that disappears has
// to fail here too, otherwise the day the authority stops writing, this gate
// would go quiet instead of loud.
test('usage rows are appended in exactly four places', () => {
  assert.deepEqual(filesMatching(USAGE_EVENT_APPEND), [...USAGE_ROW_WRITERS]);
});

test('entitlement is moved in exactly three places', () => {
  assert.deepEqual(filesMatching(ENTITLEMENT_MUTATION), [
    ...ENTITLEMENT_WRITERS
  ]);
});

function emptyState(): ProductState {
  const bucket = () => ({ allowance: 10, remaining: 10 });
  return {
    entitlement: {
      plan: 'trial',
      content: bucket(),
      image: bucket(),
      video: bucket(),
      package: bucket(),
      storageMb: bucket(),
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard'
    },
    usageEvents: []
  } as unknown as ProductState;
}

const context: ProductContext = {
  correlationId: 'corr-1',
  userId: 'user-1',
  workspaceId: 'workspace-1'
};

test('a writable ledger charges', () => {
  const ledger = new LegacyBillingLedger(true);
  const state = emptyState();
  const reservationId = ledger.reserve(state, context, 'content', 1);
  assert.ok(reservationId);
  assert.equal(state.entitlement.content.remaining, 9);
  assert.equal(ledger.commit(state, context, 'content', reservationId), true);
  assert.deepEqual(
    state.usageEvents.map((event) => event.status),
    ['reserved', 'committed']
  );
});

test('a writable ledger returns allowance on refund', () => {
  const ledger = new LegacyBillingLedger(true);
  const state = emptyState();
  const reservationId = ledger.reserve(state, context, 'video', 1);
  assert.equal(state.entitlement.video.remaining, 9);
  assert.equal(ledger.refund(state, context, 'video', reservationId), true);
  assert.equal(state.entitlement.video.remaining, 10);
});

/**
 * The regression the module exists for. Two call sites reached the ledger under
 * a read-only assembly because each site was expected to remember a flag —
 * `cancel_video`'s refund remembered nothing, and `executeGenerateCopy`'s
 * reserve remembered a different flag. Neither can happen now: there is no
 * caller-visible way to write, so the check below covers every present and
 * future call site at once rather than the twelve that were spelled out.
 */
test('a read-only ledger moves nothing, through any verb', () => {
  const ledger = new LegacyBillingLedger(false);
  const state = emptyState();

  assert.equal(ledger.reserve(state, context, 'content', 1), undefined);
  assert.equal(ledger.commit(state, context, 'content', 'any'), false);
  assert.equal(ledger.release(state, context, 'video', 'any'), false);
  assert.equal(ledger.refund(state, context, 'video', 'any'), false);
  assert.equal(ledger.chargeImmediate(state, context, 'package', 1), undefined);
  assert.equal(ledger.consumeStorage(state, context, 5, 'reason'), false);
  ledger.record(state, context, 'content', 0, 'failed_no_charge', 'reason');

  assert.deepEqual(state.usageEvents, []);
  assert.deepEqual(emptyState().entitlement, state.entitlement);
});

/**
 * A read-only ledger must not enforce legacy quota either. Its allowance
 * numbers are frozen, so refusing on them would refuse against a stale fact;
 * enforcement moved to the foundation ledger. This is the semantics the twelve
 * previously-guarded sites already had, and the two unguarded ones did not.
 */
test('a read-only ledger does not refuse on stale allowance', () => {
  const ledger = new LegacyBillingLedger(false);
  const state = emptyState();
  state.entitlement.content.remaining = 0;
  assert.equal(ledger.reserve(state, context, 'content', 1), undefined);
});

test('a writable ledger still refuses on exhausted allowance', () => {
  const ledger = new LegacyBillingLedger(true);
  const state = emptyState();
  state.entitlement.content.remaining = 0;
  assert.throws(() => ledger.reserve(state, context, 'content', 1), {
    code: 'QUOTA_EXHAUSTED'
  });
});
