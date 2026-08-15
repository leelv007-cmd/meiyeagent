/**
 * V31-63: transaction-aware current context-bundle rebuild for the
 * price-drift successor builder.
 *
 * The builder must rebuild every successor context axis from CURRENT heads
 * read inside the caller's PostgreSQL transaction — never from browser
 * payload, and never from heads read outside the transaction (TOCTOU). This
 * remains true when quote drift is the only gate diff. Heads that move again
 * between the gate's fence read and this transaction fail closed.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";
import {
  agentExecutionConfirmationRequestSchema,
  planConfirmationDecisionSchema,
} from "@meiye/contracts";

import { ConfirmationAuthorityAssembler } from "../agent-session/execution-confirmation-authority.js";
import { PostgresConfirmationAuthorityStore } from "../agent-session/execution-confirmation-authority-store.js";
import { ExecutionConfirmationService } from "../agent-session/execution-confirmation-service.js";
import {
  confirmationCreditPortFromPostgresLedger,
  PostgresExecutionConfirmationRequestStore,
  PostgresPlanConfirmationDecisionStore,
} from "../agent-session/postgres-execution-confirmation-store.js";
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from "../agent-session/plan-compiler.js";
import { PostgresMarketingPlanStore } from "../agent-session/postgres-plan-store.js";
import { PostgresCreditLedger } from "../credit-billing/postgres-credit-ledger.js";
import { creditUsageOperationId } from "../credit-billing/credit-ledger.js";
import type { ExecutionPlanFrozenContent } from "../harness/execution-plan-admission.js";
import { freezeExecutionPlanContent } from "../harness/execution-plan-admission.js";
import { createAuthoritativeExecutionPlanLiveFactsPorts } from "../harness/execution-plan-live-facts.js";
import { PostgresHarnessStore } from "../harness/postgres-store.js";
import {
  HarnessTaskAdmissionService,
  type HarnessWorkflowInput,
} from "../harness/task-admission.js";
import { PostgresContextSourceRevisionRepository } from "../operations/context-source-revisions.js";
import { PostgresMarketingIdentityRepository } from "../operations/marketing-identity.js";
import { PostgresOperationsRepository } from "../operations/postgres-repository.js";
import { PostgresStoreFactLedger } from "../operations/postgres-store-fact-ledger.js";
import { ProductContentPackageRightsResolver } from "../operations/product-package-rights-adapter.js";
import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { ProductService } from "../../product/product-service.js";
import { PostgresProductRepository } from "../../product/postgres-repository.js";
import { PostgresRelationalProductRepository } from "../../product/relational-product-repository.js";
import {
  createCreationExecutionSnapshot,
  creationExecutionSnapshotSchema,
} from "./creation-execution-snapshot.js";
import { CreationStagePort } from "./creation-stage-port.js";
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from "./postgres-creation-submission-store.js";
import { PostgresRepricedPaidExecutionSuccessorBuilder } from "./postgres-repriced-paid-execution-successor-builder.js";
import type {
  CreationSubmissionRecord,
  RepricedPaidExecutionSuccessorRequest,
} from "./submission-coordinator.js";
import { asAgentThreadIdentity } from "./submission-coordinator.js";

const connectionString = process.env.TEST_DATABASE_URL;

const FROZEN_AT = "2026-08-10T09:00:00.000Z";
const DRIFT_AT = "2026-08-11T09:00:00.000Z";
// Fresh relative to the run: expireUndispatchedConfirmationHolds treats
// `snapshot.createdAt + 48h` as the expiry fallback, so an absolute date here
// is a time bomb — the previous "2026-08-12T09:00:00.000Z" crossed the window
// on 2026-08-14 and the sweeper lock-order test started counting these
// fixtures as legitimately expirable (2 !== 0).
const SUCCESSOR_CREATED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

type Scenario = Awaited<ReturnType<typeof setupPriceDriftScenario>>;

async function setupPriceDriftScenario(pool: Pool) {
  const suffix = randomUUID();
  const workspaceId = `builder-ctx-${suffix}`;
  const planId = `plan-builder-${suffix}`;
  const quoteId = `quote-builder-${suffix}`;
  const taskId = `task-builder-${suffix}`;
  const successorTaskId = `task-successor-${suffix}`;
  const factId = `fact-price-${suffix}`;
  const identityId = `identity-${suffix}`;
  const userId = `user-${suffix}`;
  const predecessorRequestId = `confirmation:builder:${suffix}`;

  const billingRepository = new PostgresProductBillingRepository(pool);
  const plans = new PostgresMarketingPlanStore(pool);
  const facts = new PostgresStoreFactLedger(pool);
  const identities = new PostgresMarketingIdentityRepository(pool);
  await billingRepository.migrate();
  await plans.migrate();
  await facts.migrate();
  await new PostgresContextSourceRevisionRepository(pool).migrate();
  await identities.migrate();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  await pool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES ($1, 'V31-63 product user', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, 'V31-63 successor')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id)
     VALUES ($1, $2)`,
    [workspaceId, userId],
  );

  const productRepository = new PostgresRelationalProductRepository(pool);
  await new PostgresProductRepository(pool).migrate();
  await productRepository.migrate();
  await pool.query(
    `INSERT INTO p1_write_ownership (workspace_id, owner)
     VALUES ($1, 'p1')
     ON CONFLICT (workspace_id) DO UPDATE SET owner = 'p1', updated_at = now()`,
    [workspaceId],
  );
  const products = new ProductService({
    repository: productRepository,
    acceptedWriteOwner: "p1",
  });
  const productContext = {
    actor: "user" as const,
    correlationId: `corr-${suffix}`,
    userId,
    workspaceId,
  };
  await products.execute(
    productContext,
    {
      asset: {
        consentScope: "internal_only",
        containsPerson: false,
        containsSensitiveData: false,
        id: "asset-1",
        mediaType: "image",
        minorStatus: "none",
        objectKey: `${workspaceId}/assets/source.jpg`,
        rightsOwner: "青禾门店",
        sourceType: "real",
        tags: [],
      },
      type: "add_asset",
    },
    `add-asset-${suffix}`,
  );
  await products.execute(
    productContext,
    {
      assetId: "asset-1",
      consentScope: "public_marketing",
      rightsEvidence: `merchant-release-${suffix}`,
      type: "authorize_asset",
    },
    `authorize-asset-${suffix}`,
  );
  const rights = new ProductContentPackageRightsResolver(
    productRepository,
    () => new Date(SUCCESSOR_CREATED_AT),
  );
  const frozenRights = await rights.resolveWithRevision({
    assetIds: ["asset-1"],
    workspaceId,
  });
  assert.deepEqual(frozenRights.unauthorizedAssetIds, []);
  await identities.register({
    workspaceId,
    actorId: "owner-1",
    occurredAt: "2026-08-01T00:00:00.000Z",
    command: {
      identityId,
      kind: "brand",
      expectedVersion: 0,
      displayName: "青禾美业",
      owner: "青禾门店",
      professionalBoundaries: ["不作医疗承诺"],
      allowedPlatforms: ["xiaohongshu"],
      allowedScenes: ["routine_marketing_materials"],
      expressionSamples: ["以门店官方口吻介绍服务。"],
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      departureHandling: "停用后不再生成。",
      sourceRef: `authorization-${suffix}`,
      brandClaims: ["专业护理"],
      forbiddenClaims: [],
      visualPrinciples: [],
      seriesAnchors: [],
    },
  });

  // Store fact rev1 is active at freeze time; rev2 (a price change) lands
  // after the freeze — the §37.4-E material drift.
  const appendFact = (expectedRevision: number, value: string, at: string) =>
    facts.append({
      factId,
      workspaceId,
      kind: "price",
      key: "summer-care-price",
      value,
      scope: { storeId: workspaceId },
      source: {
        kind: "user_confirmation",
        referenceId: `ref-${expectedRevision + 1}`,
        capturedAt: at,
      },
      effectiveFrom: at,
      expiresAt: null,
      recordedAt: at,
      recordedBy: "owner-1",
      expectedRevision,
    });
  await appendFact(0, "199", "2026-08-01T00:00:00.000Z");
  await appendFact(1, "159", DRIFT_AT);

  // Real compiled plan revision 1 — the refresh authority appends revision 2.
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  await compiler.compile({
    workspaceId,
    threadId: `thread-${suffix}`,
    goalIds: ["goal-1"],
    planId,
    proposal: {
      goalNarrative: "小红书护理案例种草",
      whyNow: "暑期新客",
      recommendedDeliverables: [
        {
          carrier: "note",
          platform: "xiaohongshu",
          quantity: 1,
          purpose: "案例种草笔记",
        },
      ],
      expressionStrategy: { voice: "专业温和", promotionIntensity: "soft" },
      factIntentions: ["门店地址"],
      assetIntentions: ["before_after_case"],
      assumptions: [{ key: "tone", statement: "少一点硬广", risk: "low" }],
    },
    intentRevision: 1,
    contextBundleId: "bundle-1",
    contextRevision: "ctx-1",
    harnessReleaseId: "release-1",
    now: FROZEN_AT,
  });

  // Server quote authority: confirmed to the predecessor task, then reserved.
  const billing = new DurableProductBillingService(billingRepository);
  await billing.buildQuote({
    billingMode: "per_request",
    catalogModelId: "copy-model-1",
    catalogModelRevision: "catalog-r1",
    frozenCandidateDeploymentIds: ["copy-deployment-1"],
    creditCost: 3,
    quoteId,
    quotePolicyRevision: "quote-policy-1",
    routeSnapshotRef: "route-1",
    unitRate: 1,
    workspaceId,
  });
  await billing.confirm({ workspaceId, quoteId, taskId });
  await billing.reserve({ workspaceId, quoteId, units: [] });
  const currentQuote = await billing.getQuote(quoteId, workspaceId);
  assert.ok(currentQuote);
  assert.equal(currentQuote.lifecycleStatus, "reserved");

  const baseSnapshot = createCreationExecutionSnapshot(
    {
      actorId: "owner-1",
      briefConfirmation: { id: "brief-1", revision: "brief-r1" },
      briefContext: { id: "brief-context-1", revision: 1 },
      catalogModel: { id: "copy-model-1", revision: "catalog-r1" },
      contentModules: ["social_cover"],
      contentPackageId: `package-${suffix}`,
      deliverables: [{ id: "copy-main", kind: "copy", order: 1, quantity: 1 }],
      expectedContentPackageRevision: 0,
      identity: { id: identityId, revision: "1" },
      idempotencyKey: `submission-${suffix}`,
      creationMode: "customized",
      intent: "为夏日护理项目写一条预约文案",
      lens: "copy",
      modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
      platform: { id: "douyin" },
      quote: { id: quoteId, revision: currentQuote.revision },
      recipe: { id: "recipe-1", revision: "recipe-r1" },
      rights: {
        revision: frozenRights.rightsRevision,
        summary: "authorized source assets",
      },
      route: { id: "route-1", revision: "route-r1" },
      sources: {
        assets: [{ id: "asset-1", revision: "asset-r1", role: "reference" }],
      },
      surface: { id: "surface-1", revision: "surface-r1" },
      taskId,
      workId: `work-${suffix}`,
      workspaceId,
    },
    FROZEN_AT,
  );
  const semanticReference = {
    id: `decision-price-${suffix}`,
    field: "offer_price",
    value: "159 元",
    revision: 2,
  };
  const snapshot = creationExecutionSnapshotSchema.parse({
    ...baseSnapshot,
    semanticDecision: {
      sourceSnapshotId: `snapshot-before-price-${suffix}`,
      reference: semanticReference,
    },
  });

  const identityRef = `identity:${identityId}@1`;
  const briefRef = "brief:brief-context-1@1";
  const frozenFactRevisionRefs = [identityRef, briefRef];

  const pendingContent = {
    planId,
    planRevision: 1,
    intentDeclaration: { summary: "为夏日护理项目写一条预约文案" },
    contextBundleRef: { bundleId: "bundle-1", revision: 1, hash: "ctx-hash" },
    executionPlan: {
      schemaVersion: "compiled-execution-plan/v1",
      units: [
        { unitId: "unit-1", unitType: "copy.generate", primitive: "generate" },
      ],
      dependencyGroups: [{ groupId: "g1", unitIds: ["unit-1"] }],
      boundedRetry: {
        "unit-1": { maxAttempts: 1, maxCostCents: 0, retry: { enabled: false } },
      },
    },
    deliverables: [{ deliverableId: "d1", kind: "copy", quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: quoteId, revision: currentQuote.revision },
    rightsRevisionRefs: [frozenRights.rightsRevision],
    factRevisionRefs: frozenFactRevisionRefs,
    boundedExecution: {
      schemaVersion: "bounded-execution-snapshot/v1",
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ["maxIterations", "maxCostCents"],
      consumption: { iterations: 0, costCents: 0, wallClockMs: 0, delegations: 0 },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: "release-1",
    approvalBasis: "merchant_confirmed",
  } as unknown as ExecutionPlanFrozenContent;
  const pending = freezeExecutionPlanContent(pendingContent);

  const source: CreationSubmissionRecord = {
    contentPackage: { expectedRevision: 0, id: `package-${suffix}` },
    snapshot,
    task: { id: taskId },
    work: { id: `work-${suffix}` },
    usageReservation: {
      id: `usage-${suffix}`,
      credits: 3,
      units: [{ resource: "copy", quantity: 1 }],
      creditUsageOperationId: `usage-op-${suffix}`,
    },
    executionPlanFreeze: {
      planId: planId as never,
      planRevision: 1,
      intentDeclaration: { summary: "为夏日护理项目写一条预约文案" },
      contextBundleRef: { bundleId: "bundle-1", revision: 1, hash: "ctx-hash" },
      executionPlan: {
        schemaVersion: "compiled-execution-plan/v1",
        units: [
          {
            unitId: "unit-1" as never,
            unitType: "copy.generate",
            primitive: "generate",
          },
        ],
        dependencyGroups: [{ groupId: "g1", unitIds: ["unit-1" as never] }],
        boundedRetry: {
          "unit-1": {
            maxAttempts: 1,
            maxCostCents: 0,
            retry: { enabled: false },
          },
        },
      },
      deliverables: [{ deliverableId: "d1", kind: "copy", quantity: 1 }],
      quoteRef: { id: quoteId, revision: currentQuote.revision },
      rightsRevisionRefs: [frozenRights.rightsRevision],
      harnessReleaseId: "release-1" as never,
      approvalBasis: "merchant_confirmed",
    },
    confirmationDispatch: {
      requestId: predecessorRequestId,
      state: "dispatched",
      expiresAt: "2026-08-14T09:00:00.000Z",
    },
  };

  const sourceRequest: HarnessWorkflowInput = {
    actorId: "owner-1",
    workspaceId,
    packageId: source.contentPackage.id,
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: "customized",
    rawInput: "为夏日护理项目写一条预约文案",
    intent: {
      context: {
        workId: source.work.id,
        intent: "为夏日护理项目写一条预约文案",
        sourceSummaries: [],
      },
      assetReferences: ["asset-1"],
    },
    factScope: { storeId: workspaceId },
    carrierUnitId: "copy",
    carrierUnitIds: ["copy"],
    carrierBillableUnits: 1,
    executionSnapshot: snapshot,
    pendingExecutionPlanSnapshot: pending,
    executionConfirmationRequestId: predecessorRequestId,
    // A semantic resumption already carries this stable reference in its
    // durable request while the snapshot carries the same semantic decision.
    decisionReferences: [semanticReference],
  };

  // The paid gate resolves observed heads through the same authoritative
  // ports (pool-bound) before it reports the stale fence.
  const resolveObservedFactRefs = async () => {
    const gatePorts = createAuthoritativeExecutionPlanLiveFactsPorts({
      facts,
      identities,
      request: sourceRequest,
      rights,
      now: () => SUCCESSOR_CREATED_AT,
    });
    const [heads, rightsHeads] = await Promise.all([
      gatePorts.resolveFactHeads!({
        workspaceId,
        factRevisionRefs: frozenFactRevisionRefs,
      }),
      gatePorts.resolveRightsHeads!({
        workspaceId,
        rightsRevisionRefs: [frozenRights.rightsRevision],
      }),
    ]);
    const headByFrozen = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.factRevisionId, head]),
    );
    const rightsRefs = rightsHeads.map((head) => head.revisionId);
    assert.deepEqual(rightsRefs, [frozenRights.rightsRevision]);
    return {
      refs: frozenFactRevisionRefs.map(
        (ref) => headByFrozen.get(ref)!.factRevisionId,
      ),
      heads,
      rightsRefs,
    };
  };

  const staleFenceFor = (
    observedFactRevisionRefs: readonly string[],
    observedRightsRevisionRefs: readonly string[] = [
      frozenRights.rightsRevision,
    ],
  ): RepricedPaidExecutionSuccessorRequest["staleFence"] => ({
    expectedSnapshotHash: pending.snapshotHash,
    expectedQuoteRef: { id: quoteId, revision: String(currentQuote.revision) },
    observedQuoteRevision: String(currentQuote.revision),
    observedRightsRevisionRefs,
    observedFactRevisionRefs,
    diffFields: ["factRevisionRefs", "contextDrifted"],
  });

  return {
    appendFact,
    billing,
    compiler,
    facts,
    identities,
    identityId,
    products,
    productContext,
    rights,
    frozenFactRevisionRefs,
    pending,
    planId,
    plans,
    predecessorRequestId,
    quoteId,
    resolveObservedFactRefs,
    source,
    sourceRequest,
    semanticReference,
    staleFenceFor,
    successorTaskId,
    suffix,
    workspaceId,
  };
}

function contextAwareBuilder(
  pool: Pool,
  scenario: Scenario,
  compiler: Pick<PlanCompiler, "refreshLiveBindingsInTransaction"> =
    scenario.compiler,
) {
  return new PostgresRepricedPaidExecutionSuccessorBuilder(
    pool,
    scenario.plans,
    compiler,
    {
      facts: scenario.facts,
      identities: scenario.identities,
      rights: scenario.rights,
    },
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

async function assertRemainsPending(promise: Promise<unknown>) {
  const state = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 75);
    }),
  ]);
  assert.equal(state, "pending");
}

async function waitForApplicationLock(
  pool: Pool,
  applicationName: string,
) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = $1
            AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
       ) AS waiting`,
      [applicationName],
    );
    if (waiting.rows[0]?.waiting) return;
    if (Date.now() >= deadline) {
      const activity = await pool.query<{
        state: string | null;
        wait_event: string | null;
        wait_event_type: string | null;
      }>(
        `SELECT state, wait_event, wait_event_type
           FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = $1`,
        [applicationName],
      );
      throw new Error(
        `${applicationName} did not wait for the credits lock: ${JSON.stringify(activity.rows)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function rebuildInOwnTransaction(
  pool: Pool,
  builder: PostgresRepricedPaidExecutionSuccessorBuilder,
  scenario: Scenario,
  staleFence: RepricedPaidExecutionSuccessorRequest["staleFence"],
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rebuilt = await builder.rebuildInTransaction({
      client,
      workspaceId: scenario.workspaceId,
      source: scenario.source,
      sourceRequest: structuredClone(scenario.sourceRequest),
      successor: {
        taskId: scenario.successorTaskId,
        createdAt: SUCCESSOR_CREATED_AT,
      },
      staleFence,
    });
    await client.query("COMMIT");
    return rebuilt;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test(
  "V31-63 contextDrifted successor rebuilds its fact baseline from current heads inside the transaction",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      // Sanity: the price revision is a material context drift on the brief ref.
      assert.equal(
        observed.heads.some((head) => head.materialPriceOrDateChanged === true),
        true,
      );
      assert.match(
        observed.refs[1]!,
        /^brief:brief-context-1@1:material-head:[a-f0-9]{16}$/u,
      );

      const builder = contextAwareBuilder(pool, scenario);
      const rebuilt = await rebuildInOwnTransaction(
        pool,
        builder,
        scenario,
        scenario.staleFenceFor(observed.refs, observed.rightsRefs),
      );

      // The entire context bundle is pinned and rebuilt on one transaction.
      assert.deepEqual([...rebuilt.factRevisionRefs], observed.refs);
      assert.deepEqual(rebuilt.freeze.rightsRevisionRefs, observed.rightsRefs);
      // Server-owned reprice: fresh quote bound to the successor task.
      assert.equal(rebuilt.quote.quoteId, `quote-${scenario.successorTaskId}`);
      assert.equal(rebuilt.quote.taskId, scenario.successorTaskId);
      assert.equal(rebuilt.quote.lifecycleStatus, "confirmed");
      assert.equal(rebuilt.quote.creditCost, 3);
      assert.deepEqual(rebuilt.freeze.quoteRef, {
        id: rebuilt.quote.quoteId,
        revision: rebuilt.quote.revision,
      });
      // Refresh authority appended exactly one durable plan revision.
      assert.equal(rebuilt.freeze.planRevision, 2);
      const latest = await scenario.plans.getLatest(scenario.planId);
      assert.equal(latest?.revision.revision, 2);
      assert.deepEqual(
        latest?.revision.factUsages,
        observed.refs.map((factRef) => ({ factRef })),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 successor rebuild serializes a concurrent canonical quote lifecycle advancement",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      const enteredRefresh = deferred();
      const releaseRefresh = deferred();
      const builder = contextAwareBuilder(pool, scenario, {
        async refreshLiveBindingsInTransaction(input, store) {
          enteredRefresh.resolve();
          await releaseRefresh.promise;
          return scenario.compiler.refreshLiveBindingsInTransaction(input, store);
        },
      });

      const rebuilt = rebuildInOwnTransaction(
        pool,
        builder,
        scenario,
        scenario.staleFenceFor(observed.refs),
      );
      await enteredRefresh.promise;

      const advanced = scenario.billing.failAndRefund({
        workspaceId: scenario.workspaceId,
        quoteId: scenario.quoteId,
        forceCreditRefund: true,
        reason: "concurrent lifecycle advancement",
      });
      let pendingAssertion: unknown;
      try {
        await assertRemainsPending(advanced);
      } catch (error) {
        pendingAssertion = error;
      } finally {
        releaseRefresh.resolve();
      }
      await rebuilt;
      const result = await advanced;
      if (pendingAssertion) throw pendingAssertion;
      assert.equal(result.quote.lifecycleStatus, "refunded");
      assert.equal(result.usage.status, "refunded");
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 successor rebuild re-reads and fails closed after a concurrent quote advancement commits first",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const blocker = await pool.connect();
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      await blocker.query("BEGIN");
      const blockerBilling = new DurableProductBillingService(
        new PostgresProductBillingRepository(pool, blocker),
      );
      const advanced = await blockerBilling.failAndRefund({
        workspaceId: scenario.workspaceId,
        quoteId: scenario.quoteId,
        forceCreditRefund: true,
        reason: "concurrent lifecycle advancement",
      });
      assert.equal(advanced.quote.lifecycleStatus, "refunded");

      const rebuilt = rebuildInOwnTransaction(
        pool,
        contextAwareBuilder(pool, scenario),
        scenario,
        scenario.staleFenceFor(observed.refs),
      );
      await assertRemainsPending(rebuilt);
      await blocker.query("COMMIT");

      await assert.rejects(
        rebuilt,
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /Current ProductQuote/u.test(error.message),
      );
      const latest = await scenario.plans.getLatest(scenario.planId);
      assert.equal(latest?.revision.revision, 1);
    } catch (error) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
      await pool.end();
    }
  },
);

test(
  "V31-63 successor rebuild serializes a concurrent marketing identity lifecycle write",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      const enteredRefresh = deferred();
      const releaseRefresh = deferred();
      const builder = contextAwareBuilder(pool, scenario, {
        async refreshLiveBindingsInTransaction(input, store) {
          enteredRefresh.resolve();
          await releaseRefresh.promise;
          return scenario.compiler.refreshLiveBindingsInTransaction(input, store);
        },
      });
      const rebuilt = rebuildInOwnTransaction(
        pool,
        builder,
        scenario,
        scenario.staleFenceFor(observed.refs),
      );
      await enteredRefresh.promise;

      const revoked = scenario.identities.transition({
        workspaceId: scenario.workspaceId,
        actorId: "owner-1",
        occurredAt: "2026-08-12T09:01:00.000Z",
        command: {
          identityId: scenario.identityId,
          expectedVersion: 1,
          transition: "revoke",
          reason: "authorization withdrawn concurrently",
        },
      });
      let pendingAssertion: unknown;
      try {
        await assertRemainsPending(revoked);
      } catch (error) {
        pendingAssertion = error;
      } finally {
        releaseRefresh.resolve();
      }
      await rebuilt;
      const identity = await revoked;
      if (pendingAssertion) throw pendingAssertion;
      assert.equal(identity.status, "revoked");
      assert.equal(identity.version, 2);
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 quote-only successor rebuild still fails closed when the frozen marketing identity was revoked after the fence read",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      await scenario.identities.transition({
        workspaceId: scenario.workspaceId,
        actorId: "owner-1",
        occurredAt: "2026-08-12T09:01:00.000Z",
        command: {
          identityId: scenario.identityId,
          expectedVersion: 1,
          transition: "revoke",
          reason: "authorization withdrawn after the fence read",
        },
      });

      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          contextAwareBuilder(pool, scenario),
          scenario,
          {
            ...scenario.staleFenceFor(observed.refs, observed.rightsRefs),
            diffFields: ["quote"],
          },
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /missing marketing identity/u.test(error.message),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 transaction-wired successor fails closed when the gate already observed a missing marketing identity",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      await scenario.identities.transition({
        workspaceId: scenario.workspaceId,
        actorId: "owner-1",
        occurredAt: "2026-08-12T08:59:00.000Z",
        command: {
          identityId: scenario.identityId,
          expectedVersion: 1,
          transition: "revoke",
          reason: "authorization withdrawn before the fence read",
        },
      });
      const observed = await scenario.resolveObservedFactRefs();
      assert.match(
        observed.refs[0]!,
        /:identity-head:missing$/u,
      );

      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          contextAwareBuilder(pool, scenario),
          scenario,
          scenario.staleFenceFor(observed.refs, observed.rightsRefs),
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /missing marketing identity/u.test(error.message),
      );
      const latest = await scenario.plans.getLatest(scenario.planId);
      assert.equal(latest?.revision.revision, 1);
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 successor rebuild serializes a concurrent canonical rights revocation",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      const enteredRefresh = deferred();
      const releaseRefresh = deferred();
      const builder = contextAwareBuilder(pool, scenario, {
        async refreshLiveBindingsInTransaction(input, store) {
          enteredRefresh.resolve();
          await releaseRefresh.promise;
          return scenario.compiler.refreshLiveBindingsInTransaction(input, store);
        },
      });
      const rebuilt = rebuildInOwnTransaction(
        pool,
        builder,
        scenario,
        scenario.staleFenceFor(observed.refs, observed.rightsRefs),
      );
      await enteredRefresh.promise;

      const revoked = scenario.products.execute(
        scenario.productContext,
        { assetId: "asset-1", type: "withdraw_asset" },
        `withdraw-asset-${scenario.suffix}`,
      );
      let pendingAssertion: unknown;
      try {
        await assertRemainsPending(revoked);
      } catch (error) {
        pendingAssertion = error;
      } finally {
        releaseRefresh.resolve();
      }
      const result = await rebuilt;
      const withdrawal = await revoked;
      if (pendingAssertion) throw pendingAssertion;
      assert.deepEqual(result.freeze.rightsRevisionRefs, observed.rightsRefs);
      assert.equal(
        withdrawal.state.assets.find((asset) => asset.id === "asset-1")
          ?.authorizationStatus,
        "withdrawn",
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 successor rebuild fails closed when canonical rights were revoked after the fence read",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      await scenario.products.execute(
        scenario.productContext,
        { assetId: "asset-1", type: "withdraw_asset" },
        `withdraw-before-rebuild-${scenario.suffix}`,
      );

      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          contextAwareBuilder(pool, scenario),
          scenario,
          scenario.staleFenceFor(observed.refs, observed.rightsRefs),
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /revoked or unresolved rights/u.test(error.message),
      );
      const latest = await scenario.plans.getLatest(scenario.planId);
      assert.equal(latest?.revision.revision, 1);
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 heads that move again between fence read and transaction fail closed",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      // The head moves after the gate read but before the successor
      // transaction: another price revision lands.
      await scenario.appendFact(2, "129", "2026-08-11T12:00:00.000Z");

      const builder = contextAwareBuilder(pool, scenario);
      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          builder,
          scenario,
          scenario.staleFenceFor(observed.refs),
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /moved again/u.test(error.message),
      );
      // Nothing committed: the plan authority still has one revision.
      const latest = await scenario.plans.getLatest(scenario.planId);
      assert.equal(latest?.revision.revision, 1);
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 a frozen context ref without a resolvable current head fails closed",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const missingRef = `store_fact:missing-${scenario.suffix}:1`;
      scenario.sourceRequest.pendingExecutionPlanSnapshot = {
        content: {
          ...scenario.pending.content,
          factRevisionRefs: [missingRef],
        },
        snapshotHash: scenario.pending.snapshotHash,
      };

      const builder = contextAwareBuilder(pool, scenario);
      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          builder,
          scenario,
          scenario.staleFenceFor([missingRef]),
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /cannot resolve a current context head/u.test(error.message),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 contextDrifted without a wired context-head source keeps failing closed",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      const builder = new PostgresRepricedPaidExecutionSuccessorBuilder(
        pool,
        scenario.plans,
        scenario.compiler,
      );
      await assert.rejects(
        rebuildInOwnTransaction(
          pool,
          builder,
          scenario,
          scenario.staleFenceFor(observed.refs),
        ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_STATE" &&
          /transaction-aware current context-bundle builder/u.test(
            error.message,
          ),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "V31-63 production store rebuilds current context and persists the successor authority before CreationStage dispatch",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    try {
      const scenario = await setupPriceDriftScenario(pool);
      const observed = await scenario.resolveObservedFactRefs();
      const creditLedger = new PostgresCreditLedger(pool);
      const harness = new PostgresHarnessStore(pool);
      const confirmationRequests =
        new PostgresExecutionConfirmationRequestStore(pool);
      const confirmationDecisions =
        new PostgresPlanConfirmationDecisionStore(pool);
      const confirmationAuthorities =
        new PostgresConfirmationAuthorityStore(pool);
      await new PostgresOperationsRepository(pool).migrate();
      const schemaClient = await pool.connect();
      try {
        await creditLedger.migrate(schemaClient);
        await harness.migrate(schemaClient);
        await confirmationRequests.migrate(schemaClient);
        await confirmationDecisions.migrate(schemaClient);
        await confirmationAuthorities.migrate(schemaClient);
      } finally {
        schemaClient.release();
      }

      const store = new PostgresCreationSubmissionStore(
        pool,
        new PostgresCreationSubmissionPersistence(
          new PostgresProductBillingUsageReservation(
            pool,
            undefined,
            creditLedger,
          ),
        ),
        {
          creditLedger,
          repricedSuccessorBuilder: contextAwareBuilder(pool, scenario),
        },
      );
      await store.applySchema();
      await creditLedger.grant({
        id: `grant-${scenario.suffix}`,
        workspaceId: scenario.workspaceId,
        credits: 20,
        expirationDate: "2026-09-01T00:00:00.000Z",
        transactionType: "PURCHASE_PACKAGE",
        sourceRef: `successor-production-${scenario.suffix}`,
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      await creditLedger.consume({
        workspaceId: scenario.workspaceId,
        credits: 3,
        transactionId:
          scenario.source.usageReservation.creditUsageOperationId!,
        actorId: "owner-1",
        correlationId: `source:${scenario.suffix}`,
        createdAt: "2026-08-02T00:00:00.000Z",
      });

      const predecessorWorkflowId = `${scenario.source.task.id}:plan-r1`;
      scenario.source.agentBinding = {
        threadId: asAgentThreadIdentity(`thread-${scenario.suffix}`),
        runId: `run-${scenario.suffix}`,
      };
      scenario.sourceRequest.agentThreadId =
        scenario.source.agentBinding.threadId;
      scenario.sourceRequest.agentRunId = scenario.source.agentBinding.runId;
      await pool.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, work_id, content_package_id,
            usage_reservation_id, quote_id, route_snapshot_id,
            snapshot_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $4::jsonb, 'started', $5, $6, $7, $8,
                 $9, $10, $11, $12::timestamptz, $12::timestamptz)`,
        [
          scenario.source.snapshot.id,
          scenario.workspaceId,
          `source-${scenario.suffix}`,
          JSON.stringify(scenario.source),
          scenario.source.task.id,
          scenario.source.work.id,
          scenario.source.contentPackage.id,
          scenario.source.usageReservation.id,
          scenario.source.snapshot.quote.id,
          scenario.source.snapshot.route.id,
          scenario.source.snapshot.revision,
          scenario.source.snapshot.createdAt,
        ],
      );
      const predecessorRequest = {
        schemaVersion: "agent-execution-confirmation-request/v1" as const,
        requestId: scenario.predecessorRequestId,
        workspaceId: scenario.workspaceId,
        planId: scenario.planId,
        planRevision: 1,
        snapshotHash: scenario.pending.snapshotHash,
        quoteRef: structuredClone(scenario.source.snapshot.quote),
        reservationIdempotencyKey:
          scenario.source.usageReservation.creditUsageOperationId!,
        createdAt: "2026-08-11T09:00:00.000Z",
        holdExpiresAt: "2026-08-14T09:00:00.000Z",
        status: "pending" as const,
      };
      await confirmationRequests.savePending({
        request: agentExecutionConfirmationRequestSchema.parse(
          predecessorRequest,
        ),
        projection: {
          reservedCredits: 3,
          failureRefundsCredits: true,
          rightsSummary: null,
          factSummary: null,
        },
      });
      await confirmationRequests.markStatus({
        requestId: scenario.predecessorRequestId,
        expectedStatus: "pending",
        status: "decided",
      });
      await confirmationDecisions.append(planConfirmationDecisionSchema.parse({
        schemaVersion: "plan-confirmation-decision/v1",
        decisionId: `decision-${scenario.suffix}`,
        requestId: scenario.predecessorRequestId,
        actorId: "owner-1",
        decision: "confirmed",
        decidedAt: "2026-08-11T09:05:00.000Z",
      }));
      await pool.query(
        `INSERT INTO harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request,
            confirmation_request_id, admission_state)
         VALUES ($1, $1, $1, 'source-fingerprint', $2::jsonb, $3,
                 'awaiting_confirmation')`,
        [
          predecessorWorkflowId,
          JSON.stringify(scenario.sourceRequest),
          scenario.predecessorRequestId,
        ],
      );

      const confirmationService = new ExecutionConfirmationService(
        confirmationRequests,
        confirmationDecisions,
        confirmationCreditPortFromPostgresLedger(creditLedger),
        confirmationAuthorities,
        { clock: () => new Date(SUCCESSOR_CREATED_AT) },
      );
      const confirmationAuthority = new ConfirmationAuthorityAssembler(
        confirmationService,
        confirmationAuthorities,
        {
          getQuote: (quoteId, workspaceId) =>
            new PostgresProductBillingRepository(pool).getQuote(
              workspaceId!,
              quoteId,
            ),
          getQuoteInTransaction: (client, quoteId, workspaceId) =>
            new PostgresProductBillingRepository(pool, client).getQuote(
              workspaceId!,
              quoteId,
            ),
        },
        { clock: () => new Date(SUCCESSOR_CREATED_AT) },
      );
      let starts = 0;
      const admission = new HarnessTaskAdmissionService(
        harness,
        {
          async start({ workflowId }) {
            starts += 1;
            return { workflowId };
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          createRequest: (input) =>
            confirmationAuthority.createRequest(input),
          createRequestInTransaction: (input, ledger) =>
            confirmationAuthority.createRequestInTransaction(input, ledger),
          putCurrent: (input) => confirmationAuthorities.putCurrent(input),
          getRequest: (requestId) =>
            confirmationService.getRequest(requestId),
          getDecisionForWorkspace: (workspaceId, requestId) =>
            confirmationService.getDecisionForWorkspace(
              workspaceId,
              requestId,
            ),
        },
      );
      const successorTaskId = `task-production-${scenario.suffix}`;
      const created = await store.createRepricedPaidExecutionSuccessor({
        workspaceId: scenario.workspaceId,
        predecessor: {
          workflowId: predecessorWorkflowId,
          submissionId: scenario.source.snapshot.id,
          taskId: scenario.source.task.id,
          confirmationRequestId: scenario.predecessorRequestId,
        },
        staleFence: {
          expectedSnapshotHash: scenario.pending.snapshotHash,
          expectedQuoteRef: {
            id: scenario.source.snapshot.quote.id,
            revision: String(scenario.source.snapshot.quote.revision),
          },
          observedQuoteRevision: String(
            scenario.source.snapshot.quote.revision,
          ),
          observedRightsRevisionRefs: observed.rightsRefs,
          observedFactRevisionRefs: observed.refs,
          diffFields: ["quote", "factRevisionRefs", "contextDrifted"],
        },
        successor: {
          submissionId: `submission-production-${scenario.suffix}`,
          contentPackageId: `package-production-${scenario.suffix}`,
          workId: `work-production-${scenario.suffix}`,
          taskId: successorTaskId,
          createdAt: SUCCESSOR_CREATED_AT,
        },
        prepare: (prepared) =>
          admission
            .prepareRepricedConfirmationSuccessorInTransaction(prepared)
            .then(() => undefined),
      });
      assert.equal(created.kind, "created");
      assert.deepEqual(
        created.submission.executionPlanFreeze?.rightsRevisionRefs,
        observed.rightsRefs,
      );
      const successorAuthority =
        await confirmationAuthorities.getCurrentByWorkflowId(
          `${successorTaskId}:plan-r2`,
        );
      assert.ok(successorAuthority);
      assert.deepEqual(successorAuthority.factRevisionRefs, observed.refs);
      assert.deepEqual(
        successorAuthority.rightsRevisionRefs,
        observed.rightsRefs,
      );
      const successorRequestId =
        created.submission.confirmationDispatch?.requestId;
      assert.ok(successorRequestId);
      const persisted = await pool.query<{ request: HarnessWorkflowInput }>(
        `SELECT request FROM harness_runtime.task_requests
          WHERE request->>'workspaceId' = $1
            AND confirmation_request_id = $2`,
        [scenario.workspaceId, successorRequestId],
      );
      assert.deepEqual(
        persisted.rows[0]?.request.pendingExecutionPlanSnapshot?.content
          .factRevisionRefs,
        observed.refs,
      );
      assert.deepEqual(
        persisted.rows[0]?.request.decisionReferences,
        [scenario.semanticReference],
      );

      await confirmationService.decideForWorkspace({
        decisionId: `decision-successor-${scenario.suffix}`,
        requestId: successorRequestId,
        workspaceId: scenario.workspaceId,
        actorId: "owner-1",
        decision: "confirmed",
        decidedAt: "2026-08-12T09:05:00.000Z",
      });
      await new CreationStagePort(admission).start(created.submission);
      assert.equal(starts, 1);
      const balance = await creditLedger.project(scenario.workspaceId);
      assert.equal(balance.refundedCredits, 3);
      assert.equal(balance.availableCredits, 17);
    } finally {
      await pool.end();
    }
  },
);

async function assertProductionExpirySuccessorLockOrder(
  expiryMode: "claimHarnessStart" | "sweeper",
) {
    const control = new Pool({ connectionString });
    const scenario = await setupPriceDriftScenario(control);
    const expiryApplication = `v3163-${expiryMode}-${scenario.suffix}`;
    const successorApplication = `v3163-successor-${scenario.suffix}`;
    const expiryPool = new Pool({
      connectionString,
      application_name: expiryApplication,
    });
    const successorPool = new Pool({
      connectionString,
      application_name: successorApplication,
    });
    const creditLedger = new PostgresCreditLedger(control);
    const harness = new PostgresHarnessStore(control);
    const confirmationRequests =
      new PostgresExecutionConfirmationRequestStore(control);
    const confirmationDecisions =
      new PostgresPlanConfirmationDecisionStore(control);
    const confirmationAuthorities =
      new PostgresConfirmationAuthorityStore(control);
    const expiryStore = new PostgresCreationSubmissionStore(
      expiryPool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          expiryPool,
          undefined,
          creditLedger,
        ),
      ),
      { creditLedger },
    );
    const successorStore = new PostgresCreationSubmissionStore(
      successorPool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          successorPool,
          undefined,
          creditLedger,
        ),
      ),
      {
        creditLedger,
        repricedSuccessorBuilder: contextAwareBuilder(successorPool, scenario),
      },
    );
    const blocker = await control.connect();
    let expiry: Promise<unknown> | undefined;
    let successor: ReturnType<typeof successorStore.createRepricedPaidExecutionSuccessor> | undefined;
    try {
      const observed = await scenario.resolveObservedFactRefs();
      await new PostgresOperationsRepository(control).migrate();
      const schemaClient = await control.connect();
      try {
        await creditLedger.migrate(schemaClient);
        await harness.migrate(schemaClient);
        await confirmationRequests.migrate(schemaClient);
        await confirmationDecisions.migrate(schemaClient);
        await confirmationAuthorities.migrate(schemaClient);
      } finally {
        schemaClient.release();
      }
      await successorStore.applySchema();
      await creditLedger.grant({
        id: `grant-lock-${scenario.suffix}`,
        workspaceId: scenario.workspaceId,
        credits: 20,
        expirationDate: "2026-09-01T00:00:00.000Z",
        transactionType: "PURCHASE_PACKAGE",
        sourceRef: `successor-lock-${scenario.suffix}`,
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      const sourceUsageOperationId = creditUsageOperationId(
        scenario.source.task.id,
      );
      await creditLedger.consume({
        workspaceId: scenario.workspaceId,
        credits: 3,
        transactionId: sourceUsageOperationId,
        actorId: "owner-1",
        correlationId: `source-lock:${scenario.suffix}`,
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      scenario.source.usageReservation.creditUsageOperationId =
        sourceUsageOperationId;
      const predecessorWorkflowId = `${scenario.source.task.id}:plan-r1`;
      scenario.source.agentBinding = {
        threadId: asAgentThreadIdentity(`thread-lock-${scenario.suffix}`),
        runId: `run-lock-${scenario.suffix}`,
      };
      scenario.source.confirmationDispatch = {
        requestId: scenario.predecessorRequestId,
        state: "pending",
        expiresAt: "2026-08-11T08:00:00.000Z",
      };
      scenario.sourceRequest.agentThreadId = scenario.source.agentBinding.threadId;
      scenario.sourceRequest.agentRunId = scenario.source.agentBinding.runId;
      await control.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, work_id, content_package_id,
            usage_reservation_id, quote_id, route_snapshot_id,
            snapshot_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $4::jsonb, 'reserved', $5, $6, $7, $8,
                 $9, $10, $11, $12::timestamptz, $12::timestamptz)`,
        [
          scenario.source.snapshot.id,
          scenario.workspaceId,
          `source-lock-${scenario.suffix}`,
          JSON.stringify(scenario.source),
          scenario.source.task.id,
          scenario.source.work.id,
          scenario.source.contentPackage.id,
          scenario.source.usageReservation.id,
          scenario.source.snapshot.quote.id,
          scenario.source.snapshot.route.id,
          scenario.source.snapshot.revision,
          scenario.source.snapshot.createdAt,
        ],
      );
      await confirmationRequests.savePending({
        request: agentExecutionConfirmationRequestSchema.parse({
          schemaVersion: "agent-execution-confirmation-request/v1",
          requestId: scenario.predecessorRequestId,
          workspaceId: scenario.workspaceId,
          planId: scenario.planId,
          planRevision: 1,
          snapshotHash: scenario.pending.snapshotHash,
          quoteRef: scenario.source.snapshot.quote,
          reservationIdempotencyKey:
            scenario.source.usageReservation.creditUsageOperationId!,
          createdAt: "2026-08-11T07:00:00.000Z",
          holdExpiresAt: "2026-08-11T08:00:00.000Z",
          status: "pending",
        }),
        projection: {
          reservedCredits: 3,
          failureRefundsCredits: true,
          rightsSummary: null,
          factSummary: null,
        },
      });
      await confirmationRequests.markStatus({
        requestId: scenario.predecessorRequestId,
        expectedStatus: "pending",
        status: "decided",
      });
      await confirmationDecisions.append(planConfirmationDecisionSchema.parse({
        schemaVersion: "plan-confirmation-decision/v1",
        decisionId: `decision-lock-${scenario.suffix}`,
        requestId: scenario.predecessorRequestId,
        actorId: "owner-1",
        decision: "confirmed",
        decidedAt: "2026-08-11T07:05:00.000Z",
      }));
      await control.query(
        `INSERT INTO harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request,
            confirmation_request_id, admission_state)
         VALUES ($1, $1, $1, 'source-lock-fingerprint', $2::jsonb, $3,
                 'awaiting_confirmation')`,
        [
          predecessorWorkflowId,
          JSON.stringify(scenario.sourceRequest),
          scenario.predecessorRequestId,
        ],
      );
      const confirmationService = new ExecutionConfirmationService(
        confirmationRequests,
        confirmationDecisions,
        confirmationCreditPortFromPostgresLedger(creditLedger),
        confirmationAuthorities,
        { clock: () => new Date(SUCCESSOR_CREATED_AT) },
      );
      const confirmationAuthority = new ConfirmationAuthorityAssembler(
        confirmationService,
        confirmationAuthorities,
        {
          getQuote: (quoteId, workspaceId) =>
            new PostgresProductBillingRepository(control).getQuote(
              workspaceId!,
              quoteId,
            ),
          getQuoteInTransaction: (client, quoteId, workspaceId) =>
            new PostgresProductBillingRepository(control, client).getQuote(
              workspaceId!,
              quoteId,
            ),
        },
        { clock: () => new Date(SUCCESSOR_CREATED_AT) },
      );
      const admission = new HarnessTaskAdmissionService(
        harness,
        { async start({ workflowId }) { return { workflowId }; } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          createRequest: (input) => confirmationAuthority.createRequest(input),
          createRequestInTransaction: (input, ledger) =>
            confirmationAuthority.createRequestInTransaction(input, ledger),
          putCurrent: (input) => confirmationAuthorities.putCurrent(input),
          getRequest: (requestId) => confirmationService.getRequest(requestId),
          getDecisionForWorkspace: (workspaceId, requestId) =>
            confirmationService.getDecisionForWorkspace(workspaceId, requestId),
        },
      );
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [scenario.workspaceId, "merchant-credits"],
      );
      const successorTaskId = `task-lock-${scenario.suffix}`;
      successor = successorStore.createRepricedPaidExecutionSuccessor({
        workspaceId: scenario.workspaceId,
        predecessor: {
          workflowId: predecessorWorkflowId,
          submissionId: scenario.source.snapshot.id,
          taskId: scenario.source.task.id,
          confirmationRequestId: scenario.predecessorRequestId,
        },
        staleFence: scenario.staleFenceFor(observed.refs, observed.rightsRefs),
        successor: {
          submissionId: `submission-lock-${scenario.suffix}`,
          contentPackageId: `package-lock-${scenario.suffix}`,
          workId: `work-lock-${scenario.suffix}`,
          taskId: successorTaskId,
          createdAt: SUCCESSOR_CREATED_AT,
        },
        prepare: (prepared) =>
          admission
            .prepareRepricedConfirmationSuccessorInTransaction(prepared)
            .then(() => undefined),
      });
      await waitForApplicationLock(control, successorApplication);
      expiry = expiryMode === "claimHarnessStart"
        ? expiryStore.claimHarnessStart({
            workspaceId: scenario.workspaceId,
            submissionId: scenario.source.snapshot.id,
          })
        : expiryStore.expireUndispatchedConfirmationHolds({ limit: 10 });
      await waitForApplicationLock(control, expiryApplication);
      await blocker.query("COMMIT");

      const settled = await Promise.allSettled([expiry, successor]);
      assert.equal(
        settled.some(
          (result) =>
            result.status === "rejected" &&
            (result.reason as { code?: string }).code === "40P01",
        ),
        false,
      );
      assert.equal(settled[0]?.status, "fulfilled");
      if (expiryMode === "claimHarnessStart") {
        assert.deepEqual(
          settled[0]?.status === "fulfilled" ? settled[0].value : null,
          { kind: "failed" },
        );
      } else {
        assert.equal(
          settled[0]?.status === "fulfilled" ? settled[0].value : null,
          0,
        );
      }
      assert.equal(settled[1]?.status, "fulfilled");
      assert.equal(
        settled[1]?.status === "fulfilled" ? settled[1].value.kind : null,
        "created",
      );
      const sourceTerminal = await control.query<{
        harness_state: string;
        superseded_by_submission_id: string | null;
      }>(
        `SELECT harness_state, superseded_by_submission_id
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2`,
        [scenario.workspaceId, scenario.source.snapshot.id],
      );
      assert.deepEqual(sourceTerminal.rows[0], {
        harness_state: "failed",
        superseded_by_submission_id: `submission-lock-${scenario.suffix}`,
      });
      assert.equal(
        (await new PostgresProductBillingRepository(control).getQuote(
          scenario.workspaceId,
          scenario.quoteId,
        ))?.lifecycleStatus,
        "refunded",
      );
      const balance = await creditLedger.project(scenario.workspaceId);
      assert.equal(balance.refundedCredits, 3);
      assert.equal(balance.availableCredits, 17);
      const refundRows = await control.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_credit_lot_transactions
          WHERE workspace_id = $1 AND transaction_type = 'REFUND'`,
        [scenario.workspaceId],
      );
      assert.equal(refundRows.rows[0]?.count, "1");
    } catch (error) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await Promise.allSettled([
        ...(expiry ? [expiry] : []),
        ...(successor ? [successor] : []),
      ]);
      blocker.release();
      await Promise.all([
        expiryPool.end(),
        successorPool.end(),
        control.end(),
      ]);
    }
}

test(
  "V31-63 production claimHarnessStart and successor creation share credits-first lock order",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  () => assertProductionExpirySuccessorLockOrder("claimHarnessStart"),
);

test(
  "V31-63 production expiry sweeper and successor creation share credits-first lock order",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  () => assertProductionExpirySuccessorLockOrder("sweeper"),
);
