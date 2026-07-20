import assert from 'node:assert/strict';
import test from 'node:test';
import { P1DomainError } from '../foundation/domain.js';
import {
  normalizeProductEntitlementPolicy,
  type ProductEntitlementPolicy,
} from '../foundation/entitlement-policy.js';
import { AccountAllocationStore } from './account-allocation.js';
import {
  assertNoUpstreamResources,
  projectProductSideEntitlement,
  wouldAssignUpstreamResourceToUser,
} from './dual-truth.js';
import {
  computeEffectiveEntitlement,
  DEFAULT_PLATFORM_HARD_LIMITS,
  previewEffectiveEntitlementChange,
} from './effective-entitlement.js';
import { resolveModelSelectionBoundary } from './model-selection-boundary.js';
import { EntitlementPolicyRevisionRegistry } from './policy-revision.js';
import type { EntitlementPolicyBody } from './contracts.js';

const basePlan = (): ProductEntitlementPolicy =>
  normalizeProductEntitlementPolicy({
    addOns: [],
    allowance: { audio: 0, copy: 100, image: 40, video: 20 },
    autoTopUp: {
      enabled: false,
      monthlyCapMicros: 0,
      spentThisMonthMicros: 0,
    },
    concurrencyLimit: 4,
    queuePriority: 5,
    revision: 'plan:growth:r1',
    supportLabel: 'priority',
    tier: 'growth',
    allowedCatalogModelIds: ['catalog-copy-a', 'catalog-image-a'],
    allowedQualityTiers: ['auto', 'balanced'],
    availableSupplyPoolIds: ['pool-shared-default'],
    overage: { mode: 'block' },
    validity: {
      validFrom: '2026-07-01T00:00:00.000Z',
      validUntil: '2026-08-01T00:00:00.000Z',
    },
  });

function growthBody(
  overrides: Partial<EntitlementPolicyBody> = {}
): EntitlementPolicyBody {
  return {
    tier: 'growth',
    allowance: { audio: 0, copy: 100, image: 40, video: 20 },
    concurrencyLimit: 4,
    queuePriority: 5,
    supportLabel: 'priority',
    rateLabel: 'standard',
    allowedCatalogModelIds: ['catalog-copy-a'],
    allowedQualityTiers: ['auto', 'balanced'],
    availableSupplyPoolIds: ['pool-shared-default'],
    overage: { mode: 'block' },
    validity: { validFrom: null, validUntil: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Five-layer priority + preview
// ---------------------------------------------------------------------------

test('EffectiveEntitlement applies five-layer priority with before/after preview', () => {
  const plan = basePlan();
  const store = new AccountAllocationStore();
  const accountOverride = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'concurrency' },
    delta: { mode: 'delta', amount: 2 },
    source: 'enterprise_contract',
    reason: 'Enterprise concurrency uplift',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-override-1',
  });
  const campaign = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'allowance', resource: 'copy' },
    delta: { mode: 'delta', amount: 50 },
    source: 'campaign',
    reason: 'Summer promo',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T00:00:00.000Z',
    correlationId: 'corr-campaign-1',
  });

  const before = computeEffectiveEntitlement({ planPolicy: plan });
  assert.equal(before.concurrencyLimit, 4);
  assert.equal(before.allowance.copy, 100);
  assert.equal(before.sources.concurrencyLimit, 'plan_policy');

  const after = computeEffectiveEntitlement({
    planPolicy: plan,
    accountOverrides: [accountOverride],
    campaignGrants: [campaign],
    requestPreferences: {
      preferredCatalogModelIds: ['catalog-copy-a'],
    },
    now: new Date('2026-07-15T00:00:00.000Z'),
  });

  // Account override wins concurrency (4+2=6) over plan; request cannot expand.
  assert.equal(after.concurrencyLimit, 6);
  assert.equal(after.sources.concurrencyLimit, 'account_override');
  // Campaign grant adds copy allowance.
  assert.equal(after.allowance.copy, 150);
  assert.equal(after.sources.allowance, 'campaign_grant');
  // Request prefs may only narrow catalog models (lowest layer).
  assert.deepEqual(after.allowedCatalogModelIds, ['catalog-copy-a']);
  assert.equal(after.sources.catalogModels, 'request_preference');

  // Request-level concurrency may only further narrow, never raise above override.
  const narrowed = computeEffectiveEntitlement({
    planPolicy: plan,
    accountOverrides: [accountOverride],
    requestPreferences: { preferredConcurrency: 3 },
    now: new Date('2026-07-15T00:00:00.000Z'),
  });
  assert.equal(narrowed.concurrencyLimit, 3);
  assert.equal(narrowed.sources.concurrencyLimit, 'request_preference');

  const preview = previewEffectiveEntitlementChange({
    before: { planPolicy: plan },
    after: {
      planPolicy: plan,
      accountOverrides: [accountOverride],
      campaignGrants: [campaign],
      now: new Date('2026-07-15T00:00:00.000Z'),
    },
  });
  assert.ok(preview.changed.includes('concurrencyLimit'));
  assert.ok(preview.changed.includes('allowance'));
  assert.equal(preview.before.concurrencyLimit, 4);
  assert.equal(preview.after.concurrencyLimit, 6);
});

// ---------------------------------------------------------------------------
// Expiry fall-back
// ---------------------------------------------------------------------------

test('expired AccountAllocation auto-falls back to plan default', () => {
  const plan = basePlan();
  const store = new AccountAllocationStore();
  store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'allowance', resource: 'image' },
    delta: { mode: 'delta', amount: 100 },
    source: 'campaign',
    reason: 'Expired promo',
    actorId: 'admin-1',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-06-30T00:00:00.000Z',
    correlationId: 'corr-expired',
  });

  const now = new Date('2026-07-15T00:00:00.000Z');
  const active = store.listActive({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    now,
  });
  assert.equal(active.length, 0);

  const effective = computeEffectiveEntitlement({
    planPolicy: plan,
    campaignGrants: store.listAll('acct-1'),
    now,
  });
  assert.equal(effective.allowance.image, plan.allowance.image);
  assert.equal(effective.sources.allowance, 'plan_policy');
  assert.deepEqual(effective.appliedAllocationIds, []);
});

// ---------------------------------------------------------------------------
// Hard limit cannot be overridden by grant (negative)
// ---------------------------------------------------------------------------

test('platform hard limit cannot be overridden by grant', () => {
  const plan = basePlan();
  const store = new AccountAllocationStore();
  const grant = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'concurrency' },
    delta: { mode: 'delta', amount: 1000 },
    source: 'support_compensation',
    reason: 'Attempt to exceed hard limit',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-hard',
  });

  const hard = {
    ...DEFAULT_PLATFORM_HARD_LIMITS,
    maxConcurrency: 8,
  };
  const effective = computeEffectiveEntitlement({
    planPolicy: plan,
    platformHardLimits: hard,
    accountOverrides: [grant],
  });

  assert.equal(effective.concurrencyLimit, 8);
  assert.equal(effective.sources.concurrencyLimit, 'platform_hard_limit');
  // Plan was 4; grant tried +1000; hard clamps to 8.
  assert.ok(effective.concurrencyLimit < 4 + 1000);
});

test('platform denied CatalogModel cannot be re-granted', () => {
  const plan = normalizeProductEntitlementPolicy({
    ...basePlan(),
    allowedCatalogModelIds: ['safe-model', 'blocked-model'],
  });
  const store = new AccountAllocationStore();
  const grant = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'catalog_model', catalogModelId: 'blocked-model' },
    delta: { mode: 'set', enabled: true },
    source: 'canary',
    reason: 'Attempt to re-enable denied model',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-deny',
  });

  const effective = computeEffectiveEntitlement({
    planPolicy: plan,
    platformHardLimits: {
      ...DEFAULT_PLATFORM_HARD_LIMITS,
      deniedCatalogModelIds: ['blocked-model'],
    },
    accountOverrides: [grant],
  });

  assert.ok(!effective.allowedCatalogModelIds.includes('blocked-model'));
  assert.ok(effective.allowedCatalogModelIds.includes('safe-model'));
  assert.equal(effective.sources.catalogModels, 'platform_hard_limit');
});

// ---------------------------------------------------------------------------
// Upstream resources never assigned to users (negative / D-061)
// ---------------------------------------------------------------------------

test('product-side projection never includes upstream tokens, accounts, or balances', () => {
  const effective = computeEffectiveEntitlement({ planPolicy: basePlan() });
  const boundary = resolveModelSelectionBoundary({
    mode: 'auto',
    qualityTier: 'balanced',
  });
  const projection = projectProductSideEntitlement(effective, boundary);

  assert.equal(projection.entitlement.tier, 'growth');
  assert.ok(projection.usageAllowance);
  assert.ok(projection.concurrencyPolicy);
  assert.ok(projection.routePolicy);
  assertNoUpstreamResources(projection);

  // Negative: attempting to assign upstream resources to a user is rejected.
  assert.equal(
    wouldAssignUpstreamResourceToUser({
      upstreamToken: 'sk-leaked',
      gatewayBalance: 999,
      upstreamAccountId: 'acct-upstream-1',
    }),
    true
  );
  assert.equal(
    wouldAssignUpstreamResourceToUser({
      entitlement: projection.entitlement,
      usageAllowance: projection.usageAllowance,
    }),
    false
  );

  assert.throws(
    () =>
      assertNoUpstreamResources({
        entitlement: projection.entitlement,
        providerToken: 'secret',
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );
});

// ---------------------------------------------------------------------------
// Publish aggregation CAS
// ---------------------------------------------------------------------------

test('EntitlementPolicy publish is batch-wide with CAS and rollback', () => {
  const registry = new EntitlementPolicyRevisionRegistry();

  const draft = registry.draft({
    tier: 'growth',
    body: growthBody({ concurrencyLimit: 4 }),
    actorId: 'admin-1',
    reason: 'Initial growth policy',
    correlationId: 'corr-draft-1',
    expectedPublishedRevision: null,
  });
  assert.equal(draft.stage, 'draft');

  // Stale CAS on publish is rejected.
  assert.throws(
    () =>
      registry.publish({
        tier: 'growth',
        revisionId: draft.id,
        actorId: 'admin-1',
        reason: 'stale',
        correlationId: 'corr-stale',
        expectedPublishedRevision: 99,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT'
  );

  const published = registry.publish({
    tier: 'growth',
    revisionId: draft.id,
    actorId: 'admin-1',
    reason: 'Publish growth defaults',
    correlationId: 'corr-pub-1',
    expectedPublishedRevision: null,
  });
  assert.equal(published.stage, 'published');
  // Batch-wide: single head serves every account on the tier (no per-account copy).
  assert.deepEqual(registry.getPublished('growth')?.body.concurrencyLimit, 4);
  assert.equal(registry.projectPlanPolicy('growth')?.concurrencyLimit, 4);

  const draft2 = registry.draft({
    tier: 'growth',
    body: growthBody({ concurrencyLimit: 6, queuePriority: 8 }),
    actorId: 'admin-1',
    reason: 'Raise concurrency',
    correlationId: 'corr-draft-2',
    expectedPublishedRevision: published.revision,
  });
  const published2 = registry.publish({
    tier: 'growth',
    revisionId: draft2.id,
    actorId: 'admin-1',
    reason: 'Publish raised concurrency',
    correlationId: 'corr-pub-2',
    expectedPublishedRevision: published.revision,
  });
  assert.equal(registry.getPublished('growth')?.body.concurrencyLimit, 6);

  // Concurrent CAS conflict after head moved.
  assert.throws(
    () =>
      registry.draft({
        tier: 'growth',
        body: growthBody({ concurrencyLimit: 1 }),
        actorId: 'admin-2',
        reason: 'stale draft',
        correlationId: 'corr-conflict',
        expectedPublishedRevision: published.revision,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT'
  );

  const rolled = registry.rollback({
    tier: 'growth',
    targetRevision: published.revision,
    actorId: 'admin-1',
    reason: 'Rollback concurrency raise',
    correlationId: 'corr-rb-1',
    expectedPublishedRevision: published2.revision,
  });
  assert.equal(rolled.rolledBackToRevision, published.revision);
  assert.equal(registry.getPublished('growth')?.body.concurrencyLimit, 4);
  // Still a single batch-wide head — not per-account.
  assert.equal(registry.history('growth').filter((r) => r.stage === 'published').length, 1);
});

// ---------------------------------------------------------------------------
// D-062 fixed vs Auto selection boundary
// ---------------------------------------------------------------------------

test('fixed CatalogModel only allows Deployment selection; Auto allows both', () => {
  const fixed = resolveModelSelectionBoundary({
    mode: 'fixed',
    catalogModelId: 'catalog-copy-a',
  });
  assert.equal(fixed.maySelectCatalogModel, false);
  assert.equal(fixed.maySelectDeployment, true);
  assert.equal(fixed.fixedCatalogModelId, 'catalog-copy-a');

  const auto = resolveModelSelectionBoundary({
    mode: 'auto',
    qualityTier: 'quality',
  });
  assert.equal(auto.maySelectCatalogModel, true);
  assert.equal(auto.maySelectDeployment, true);
  assert.equal(auto.qualityTier, 'quality');

  assert.throws(
    () => resolveModelSelectionBoundary({ mode: 'fixed' }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );
});

// ---------------------------------------------------------------------------
// Multi-workspace: workspace only inside allocation drilldown
// ---------------------------------------------------------------------------

test('AccountAllocation requires explicit target workspace (drilldown-only selection)', () => {
  const store = new AccountAllocationStore();
  assert.throws(
    () =>
      store.append({
        accountId: 'acct-1',
        workspaceId: '  ',
        kind: 'grant',
        target: { type: 'concurrency' },
        delta: { mode: 'delta', amount: 1 },
        source: 'account_override',
        reason: 'missing workspace',
        actorId: 'admin-1',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: null,
        correlationId: 'corr-ws',
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE'
  );

  const allocation = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-chosen-in-drilldown',
    kind: 'restrict',
    target: { type: 'supply_pool', supplyPoolId: 'pool-dedicated-x' },
    delta: { mode: 'set', enabled: false },
    source: 'risk_control',
    reason: 'Isolate dedicated pool',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-ws-ok',
  });
  assert.equal(allocation.workspaceId, 'ws-chosen-in-drilldown');
});

// ---------------------------------------------------------------------------
// Restrict beats grant; rollback allocation
// ---------------------------------------------------------------------------

test('restrict beats grant and rollback restores plan path', () => {
  const plan = basePlan();
  const store = new AccountAllocationStore();
  const grant = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'grant',
    target: { type: 'catalog_model', catalogModelId: 'catalog-extra' },
    delta: { mode: 'set', enabled: true },
    source: 'canary',
    reason: 'Canary model',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-g',
  });
  const restrict = store.append({
    accountId: 'acct-1',
    workspaceId: 'ws-a',
    kind: 'restrict',
    target: { type: 'catalog_model', catalogModelId: 'catalog-extra' },
    delta: { mode: 'set', enabled: false },
    source: 'risk_control',
    reason: 'Revoke canary',
    actorId: 'admin-1',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
    correlationId: 'corr-r',
  });

  const withBoth = computeEffectiveEntitlement({
    planPolicy: plan,
    accountOverrides: [grant, restrict],
  });
  assert.ok(!withBoth.allowedCatalogModelIds.includes('catalog-extra'));

  store.rollback({
    allocationId: restrict.id,
    actorId: 'admin-1',
    reason: 'Lift restriction',
    correlationId: 'corr-rb',
  });
  const afterRollback = computeEffectiveEntitlement({
    planPolicy: plan,
    accountOverrides: store.listActive({
      accountId: 'acct-1',
      workspaceId: 'ws-a',
    }),
  });
  assert.ok(afterRollback.allowedCatalogModelIds.includes('catalog-extra'));
});
