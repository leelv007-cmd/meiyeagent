/**
 * V31-63: transaction-aware current context-bundle rebuild for the
 * price-drift successor builder.
 *
 * §37.4-E price drift revises a store fact, which always marks the fence
 * diff `contextDrifted`. The builder must rebuild the successor's fact
 * baseline from CURRENT heads read inside the caller's PostgreSQL
 * transaction — never from browser payload, and never from heads read
 * outside the transaction (TOCTOU). Heads that moved again between the
 * gate's fence read and this transaction fail closed.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from "../agent-session/plan-compiler.js";
import { PostgresMarketingPlanStore } from "../agent-session/postgres-plan-store.js";
import type { ExecutionPlanFrozenContent } from "../harness/execution-plan-admission.js";
import { freezeExecutionPlanContent } from "../harness/execution-plan-admission.js";
import { createAuthoritativeExecutionPlanLiveFactsPorts } from "../harness/execution-plan-live-facts.js";
import type { HarnessWorkflowInput } from "../harness/task-admission.js";
import { PostgresStoreFactLedger } from "../operations/postgres-store-fact-ledger.js";
import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { createCreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import { PostgresRepricedPaidExecutionSuccessorBuilder } from "./postgres-repriced-paid-execution-successor-builder.js";
import type {
  CreationSubmissionRecord,
  RepricedPaidExecutionSuccessorRequest,
} from "./submission-coordinator.js";

const connectionString = process.env.TEST_DATABASE_URL;

const FROZEN_AT = "2026-08-10T09:00:00.000Z";
const DRIFT_AT = "2026-08-11T09:00:00.000Z";
const SUCCESSOR_CREATED_AT = "2026-08-12T09:00:00.000Z";

type Scenario = Awaited<ReturnType<typeof setupPriceDriftScenario>>;

async function setupPriceDriftScenario(pool: Pool) {
  const suffix = randomUUID();
  const workspaceId = `builder-ctx-${suffix}`;
  const planId = `plan-builder-${suffix}`;
  const quoteId = `quote-builder-${suffix}`;
  const taskId = `task-builder-${suffix}`;
  const successorTaskId = `task-successor-${suffix}`;
  const factId = `fact-price-${suffix}`;
  const predecessorRequestId = `confirmation:builder:${suffix}`;

  const billingRepository = new PostgresProductBillingRepository(pool);
  const plans = new PostgresMarketingPlanStore(pool);
  const facts = new PostgresStoreFactLedger(pool);
  await billingRepository.migrate();
  await plans.migrate();
  await facts.migrate();

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

  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: "owner-1",
      briefConfirmation: { id: "brief-1", revision: "brief-r1" },
      briefContext: { id: "brief-context-1", revision: 1 },
      catalogModel: { id: "copy-model-1", revision: "catalog-r1" },
      contentModules: ["social_cover"],
      contentPackageId: `package-${suffix}`,
      deliverables: [{ id: "copy-main", kind: "copy", order: 1, quantity: 1 }],
      expectedContentPackageRevision: 0,
      identity: { id: "identity-1", revision: "identity-r1" },
      idempotencyKey: `submission-${suffix}`,
      creationMode: "customized",
      intent: "为夏日护理项目写一条预约文案",
      lens: "copy",
      modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
      platform: { id: "douyin" },
      quote: { id: quoteId, revision: currentQuote.revision },
      recipe: { id: "recipe-1", revision: "recipe-r1" },
      rights: { revision: "rights-r1", summary: "authorized source assets" },
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

  const identityRef = "identity:identity-1@identity-r1";
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
    rightsRevisionRefs: ["rights-r1"],
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
      rightsRevisionRefs: ["rights-r1"],
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
      assetReferences: [],
    },
    factScope: { storeId: workspaceId },
    executionSnapshot: snapshot,
    pendingExecutionPlanSnapshot: pending,
    executionConfirmationRequestId: predecessorRequestId,
  };

  // The paid gate resolves observed heads through the same authoritative
  // ports (pool-bound) before it reports the stale fence.
  const resolveObservedFactRefs = async () => {
    const gatePorts = createAuthoritativeExecutionPlanLiveFactsPorts({
      facts,
      request: sourceRequest,
      rights: {
        async resolve() {
          return { unauthorizedAssetIds: [] };
        },
      },
      now: () => SUCCESSOR_CREATED_AT,
    });
    const heads = await gatePorts.resolveFactHeads!({
      workspaceId,
      factRevisionRefs: frozenFactRevisionRefs,
    });
    const headByFrozen = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.factRevisionId, head]),
    );
    return {
      refs: frozenFactRevisionRefs.map(
        (ref) => headByFrozen.get(ref)!.factRevisionId,
      ),
      heads,
    };
  };

  const staleFenceFor = (
    observedFactRevisionRefs: readonly string[],
  ): RepricedPaidExecutionSuccessorRequest["staleFence"] => ({
    expectedSnapshotHash: pending.snapshotHash,
    expectedQuoteRef: { id: quoteId, revision: String(currentQuote.revision) },
    observedQuoteRevision: String(currentQuote.revision),
    observedRightsRevisionRefs: ["rights-r1"],
    observedFactRevisionRefs,
    diffFields: ["factRevisionRefs", "contextDrifted"],
  });

  return {
    appendFact,
    billing,
    compiler,
    facts,
    frozenFactRevisionRefs,
    pending,
    planId,
    plans,
    predecessorRequestId,
    quoteId,
    resolveObservedFactRefs,
    source,
    sourceRequest,
    staleFenceFor,
    successorTaskId,
    suffix,
    workspaceId,
  };
}

function contextAwareBuilder(pool: Pool, scenario: Scenario) {
  return new PostgresRepricedPaidExecutionSuccessorBuilder(
    pool,
    scenario.plans,
    scenario.compiler,
    { facts: scenario.facts },
  );
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
        scenario.staleFenceFor(observed.refs),
      );

      // Successor fact baseline == the current heads, verified in-transaction.
      assert.deepEqual([...rebuilt.factRevisionRefs], observed.refs);
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
