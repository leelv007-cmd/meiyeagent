import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type {
  AssetIntakeBatch,
  FinalizeStoreIntakeCommand,
  AssetIntakeBatchInput,
  StoreProfilePatch,
} from '@meiye/contracts';
import { STORE_PROFILE_PLATFORM_DEFAULTS } from '@meiye/contracts';
import { Pool } from 'pg';

import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { ProductService } from '../../product/product-service.js';
import type { P1Context } from '../foundation/domain.js';
import { insertNewAccountWriteOwnership } from '../foundation/write-ownership.js';
import { AssetIntakeService } from './asset-intake-service.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import {
  FixtureAssetDraftCompiler,
  FixtureDocumentParseProvider,
  FixtureVisualAssetClassifier,
  MemoryParseRepository,
  ParseService,
} from './parse-service.js';
import { PostgresAssetIntakeRepository } from './postgres-asset-intake-repository.js';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';
import {
  PostgresStoreIntakeFinalizationRepository,
  StoreIntakeFinalizationError,
  StoreIntakeFinalizer,
  type StoreIntakeFinalizationIntakePort,
  type StoreIntakeFinalizationRepository,
  type StoreProfileMergePort,
} from './store-intake-finalizer.js';

const connectionString = process.env.TEST_DATABASE_URL;
const now = '2026-07-27T10:00:00.000Z';

test(
  'Day-0 finalize normalizes inline workspace and capability, then replays without another revision',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      const input = finalizeInput(environment.context.workspaceId, {
        candidateStoreId: 'another-workspace',
        profilePatch: completePatch(),
      });
      const submittedBatch = inlineBatch(input);

      const first = await environment.finalizer.finalize(
        environment.context,
        input,
        'day-0-finalize',
      );
      const replay = await environment.finalizer.finalize(
        environment.context,
        input,
        'day-0-finalize',
      );
      const expectedFactIds = [
        'store-profile:address:fulfillment',
        'store-profile:booking:fulfillment',
        'store-profile:city:other',
        'store-profile:district:other',
        'store-profile:name:other',
        'store-project:project-a:price',
        'store-project:project-a:service',
      ] as const;
      const history = await environment.facts.history(
        environment.context.workspaceId,
        input.confirmations[0]!.factId,
      );
      const histories = await Promise.all(
        expectedFactIds.map((factId) =>
          environment.facts.history(environment.context.workspaceId, factId),
        ),
      );
      const storeFacts = await environment.facts.listActive({
        workspaceId: environment.context.workspaceId,
        scope: { storeId: environment.context.workspaceId },
        at: '2026-07-27T10:01:00.000Z',
      });
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      const persistedBatch = await environment.intake.view(
        environment.context.workspaceId,
        input.batch.batchId,
      );

      assert.equal(first.profileRevision, 1);
      assert.equal(replay.profileRevision, 1);
      assert.equal(history.length, 1);
      assert.equal(history[0]!.source.kind, 'user_confirmation');
      assert.equal(
        history[0]!.source.referenceId,
        submittedBatch.source.referenceId,
      );
      assert.equal(
        history[0]!.source.capturedAt,
        submittedBatch.source.capturedAt,
      );
      assert.deepEqual(history[0]!.scope, {
        storeId: environment.context.workspaceId,
        serviceId: 'project-a',
      });
      assert.deepEqual(
        storeFacts.map((fact) => fact.factId),
        expectedFactIds,
      );
      assert.deepEqual(
        histories.map((entries) => entries.length),
        expectedFactIds.map(() => 1),
      );
      assert.equal(state.store?.revision, 1);
      assert.equal(persistedBatch.batch.source.capabilityStatus, 'assisted');
      assert.equal(persistedBatch.capability.status, 'assisted');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'V31-84 Day-0 wizard finalize projects the confirmed store name onto the profile',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          ...completePatch(),
          name: '盘点美发工作室',
          city: '市中心',
        },
      });

      const result = await environment.finalizer.finalize(
        environment.context,
        input,
        'v31-84-sentence-finalize',
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      const facts = await environment.facts.listActive({
        workspaceId: environment.context.workspaceId,
        scope: { storeId: environment.context.workspaceId },
        at: '2026-07-27T10:01:00.000Z',
      });
      const nameFact = facts.find(
        (fact) => fact.factId === 'store-profile:name:other',
      );

      assert.equal(result.profileRevision, 1);
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.name, '盘点美发工作室');
      assert.equal(state.store?.city, '市中心');
      assert.equal(state.store?.projects[0]?.name, '透亮猫眼');
      assert.equal(state.store?.projects[0]?.price, 299);
      assert.ok(nameFact);
      assert.deepEqual(nameFact?.value, { name: '盘点美发工作室' });
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'V31-86 archive-card finalize keeps platform defaults on the profile and out of facts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      const input = archiveCardFinalizeInput(environment.context.workspaceId);
      const result = await environment.finalizer.finalize(
        environment.context,
        input,
        'v31-86-archive-card-finalize',
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      const facts = await environment.facts.listActive({
        workspaceId: environment.context.workspaceId,
        scope: { storeId: environment.context.workspaceId },
        at: '2026-07-27T10:01:00.000Z',
      });
      const factIds = facts.map((fact) => fact.factId).sort();
      const receipt = await environment.pool.query<{
        result: {
          fieldProvenance?: Record<string, string>;
          profileRevision: number;
        };
      }>(
        `SELECT result
           FROM p1_store_intake_finalization_outbox
          WHERE workspace_id = $1
            AND idempotency_key = $2`,
        [environment.context.workspaceId, 'v31-86-archive-card-finalize'],
      );

      assert.equal(result.profileRevision, 1);
      assert.equal(state.store?.name, '盘点美发工作室');
      assert.equal(state.store?.city, '市中心');
      assert.equal(
        state.store?.district,
        STORE_PROFILE_PLATFORM_DEFAULTS.district,
      );
      assert.equal(
        state.store?.address,
        STORE_PROFILE_PLATFORM_DEFAULTS.address,
      );
      assert.equal(
        state.store?.booking,
        STORE_PROFILE_PLATFORM_DEFAULTS.booking,
      );
      assert.deepEqual(factIds, [
        'store-profile:city:other',
        'store-profile:name:other',
        'store-project:project-a:price',
        'store-project:project-a:service',
      ]);
      assert.equal(
        facts.some((fact) => fact.factId.includes('district')),
        false,
      );
      assert.deepEqual(result.fieldProvenance, input.fieldProvenance);
      assert.deepEqual(
        receipt.rows[0]?.result.fieldProvenance,
        input.fieldProvenance,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'stale profile OCC rejects before any StoreFact revision is appended',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 0,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'stale-profile',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_PROFILE_REVISION_CONFLICT' &&
          error.status === 409,
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          input.confirmations[0]!.factId,
        ),
        [],
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed price fact must equal the project price patch before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'project-a-price-mismatch',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'price',
            key: 'service.project-a.price',
            value: { amount: 999, currency: 'CNY' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'project-a-price-mismatch',
          factId: 'store-project:project-a:price',
          expectedFactRevision: 0,
        },
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'project-price-value-mismatch',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:price',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.projects[0]?.price, 299);
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a persisted corrected price reaches both PostgreSQL projections',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'project-a-corrected-price',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'price',
            key: 'service.project-a.price',
            value: { amount: 239, currency: 'CNY' },
            scope: {
              storeId: environment.context.workspaceId,
              serviceId: 'project-a',
            },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'project-a-corrected-price',
          factId: 'store-project:project-a:price',
          expectedFactRevision: 0,
        },
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [
              {
                ...project('project-a', '透亮猫眼', 299),
                priceValidUntil: null,
              },
            ],
          },
        },
      });
      const batch = inlineBatch(input);
      const persistedBatch = {
        ...batch,
        workspaceId: environment.context.workspaceId,
        createdAt: now,
      } satisfies AssetIntakeBatch;
      await environment.intake.recordBatch(persistedBatch);
      const priceCandidate = persistedBatch.candidates.find(
        (candidate) =>
          candidate.objectKind === 'store_fact' &&
          candidate.candidateId === 'project-a-corrected-price',
      );
      if (priceCandidate?.objectKind !== 'store_fact') {
        assert.fail('corrected price candidate is missing');
      }
      await environment.intake.correctFact(environment.context, {
        batchId: persistedBatch.batchId,
        candidateId: priceCandidate.candidateId,
        correctedFact: {
          ...priceCandidate.fact,
          value: { amount: 299, currency: 'CNY' },
        },
        idempotencyKey: 'correct-project-a-price',
      });

      const command = {
        ...input,
        batch: { batchId: persistedBatch.batchId },
      } satisfies FinalizeStoreIntakeCommand;
      const result = await environment.finalizer.finalize(
        environment.context,
        command,
        'finalize-corrected-project-a-price',
      );
      const replay = await environment.finalizer.finalize(
        environment.context,
        command,
        'finalize-corrected-project-a-price',
      );
      const priceFact = result.facts.find(
        (fact) => fact.factId === 'store-project:project-a:price',
      );
      const priceHistory = await environment.facts.history(
        environment.context.workspaceId,
        'store-project:project-a:price',
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });

      assert.deepEqual(replay, result);
      assert.deepEqual(priceFact?.value, { amount: 299, currency: 'CNY' });
      assert.equal(priceHistory.length, 1);
      assert.deepEqual(priceHistory[0]?.value, {
        amount: 299,
        currency: 'CNY',
      });
      assert.equal(state.store?.revision, 2);
      assert.equal(
        state.store?.projects.find((item) => item.id === 'project-a')?.price,
        299,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed price fact requires its project upsert before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'project-a-price-without-upsert',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'price',
            key: 'service.project-a.price',
            value: { amount: 299, currency: 'CNY' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'project-a-price-without-upsert',
          factId: 'store-project:project-a:price',
          expectedFactRevision: 0,
        },
        profilePatch: { expectedRevision: 1 },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'project-price-without-upsert',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:price',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.projects[0]?.price, 299);
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a mapped profile patch cannot change a project price without its StoreFact confirmation',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 999)],
          },
        },
      });
      if (!('candidates' in input.batch)) throw new Error('inline batch expected');
      const batch = input.batch;
      input.confirmations = input.confirmations.filter(
        (confirmation) => confirmation.factId !== 'store-project:project-a:price',
      );
      batch.candidates = batch.candidates.filter(
        (candidate) =>
          candidate.candidateId !==
          `${batch.batchId}-store-project-project-a-price`,
      );

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'project-price-profile-bypass',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:service',
        ),
        [],
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:price',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.projects[0]?.price, 299);
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a mapped scalar profile patch requires its StoreFact confirmation',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 1,
          name: '伪造门店名称',
        },
      });
      if (!('candidates' in input.batch)) throw new Error('inline batch expected');
      const batch = input.batch;
      input.confirmations = input.confirmations.filter(
        (confirmation) => confirmation.factId !== 'store-profile:name:other',
      );
      batch.candidates = batch.candidates.filter(
        (candidate) =>
          candidate.candidateId !==
          `${batch.batchId}-store-profile-name-other`,
      );

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'profile-name-bypass',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:service',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.name, '青禾美甲');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed service fact must equal the project name patch before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'project-a-service-mismatch',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'service',
            key: 'service.project-a.name',
            value: { name: '错误服务名称' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'project-a-service-mismatch',
          factId: 'store-project:project-a:service',
          expectedFactRevision: 0,
        },
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'project-service-value-mismatch',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:service',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.projects[0]?.name, '透亮猫眼');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed service fact requires its project upsert before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: { expectedRevision: 1 },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'project-service-without-upsert',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-a:service',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.projects[0]?.name, '透亮猫眼');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed profile fact must equal its profile patch before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'profile-name-mismatch',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'other',
            key: 'store.profile.name',
            value: { name: '错误门店名称' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'profile-name-mismatch',
          factId: 'store-profile:name:other',
          expectedFactRevision: 0,
        },
        profilePatch: {
          expectedRevision: 1,
          name: '青禾美甲',
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'profile-name-value-mismatch',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-profile:name:other',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.name, '青禾美甲');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a confirmed profile fact requires its explicit profile patch before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'profile-name-without-patch',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'other',
            key: 'store.profile.name',
            value: { name: '青禾美甲' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'profile-name-without-patch',
          factId: 'store-profile:name:other',
          expectedFactRevision: 0,
        },
        profilePatch: { expectedRevision: 1 },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'profile-name-without-patch',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-profile:name:other',
        ),
        [],
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 1);
      assert.equal(state.store?.name, '青禾美甲');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a promoted W02 draft finalizes through its persisted batch reference',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const parsing = new ParseService(
        new MemoryParseRepository(),
        new FixtureDocumentParseProvider(),
        new FixtureAssetDraftCompiler(),
        new FixtureVisualAssetClassifier(),
        { isAuthorized: async () => true },
        undefined,
        undefined,
        () => now,
      );
      const module = new AssetMemoryFoundationModule(
        environment.intake,
        parsing,
        environment.finalizer,
      );
      const draft = await parsing.prepareManualDraft(environment.context, {
        taskId: 'w02-price-task',
        source: {
          assetId: 'w02-price-source',
          objectKey: `${environment.context.workspaceId}/price-source.png`,
          sha256: 'a'.repeat(64),
          sizeBytes: 128,
          contentType: 'image/png',
          sourceUrl: 'https://assets.example.test/price-source.png',
          inputKind: 'document_image',
          target: 'price_list',
          rightsStatus: 'confirmed',
        },
        fields: [
          {
            key: 'service.project-a.price',
            value: { amount: 329, currency: 'CNY' },
          },
        ],
        factCandidates: [
          {
            kind: 'service',
            key: 'service.project-a.name',
            value: { name: '透亮猫眼' },
            scope: {
              storeId: environment.context.workspaceId,
              serviceId: 'project-a',
            },
            source: {
              kind: 'user_confirmation',
              referenceId: 'client-placeholder',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
          {
            kind: 'price',
            key: 'service.project-a.price',
            value: { amount: 329, currency: 'CNY' },
            scope: {
              storeId: environment.context.workspaceId,
              serviceId: 'project-a',
            },
            source: {
              kind: 'user_confirmation',
              referenceId: 'client-placeholder',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        ],
      });
      const promoted = await environment.intake.recordBatch(
        {
          batchId: 'w02-promoted-batch',
          workspaceId: environment.context.workspaceId,
          taskId: draft.taskId,
          source: {
            sourceId: draft.sourceAssetId,
            kind: 'price_list',
            referenceId: draft.sourceAssetId,
            capabilityStatus: 'assisted',
            sourceWorkspaceId: environment.context.workspaceId,
            capturedAt: draft.createdAt,
            example: false,
          },
          summary: `已整理出 ${draft.factCandidates.length} 项待确认资料。`,
          candidates: draft.factCandidates.map((fact, index) => ({
            candidateId: `${draft.draftId}:fact:${index + 1}`,
            status: 'pending',
            objectKind: 'store_fact',
            fact,
          })),
          createdAt: now,
        },
        'w02-promoted-batch-server-receipt',
      );

      const finalized = (await module.execute({
        context: environment.context,
        idempotencyKey: 'w02-finalize',
        input: {
          action: 'finalize_store_intake',
          payload: {
            batch: { batchId: 'w02-promoted-batch' },
            confirmations: [
              {
                candidateId: promoted.candidates[0]?.candidateId,
                factId: 'store-project:project-a:service',
                expectedFactRevision: 0,
              },
              {
                candidateId: promoted.candidates[1]?.candidateId,
                factId: 'store-project:project-a:price',
                expectedFactRevision: 0,
              },
            ],
            profilePatch: {
              expectedRevision: 1,
              projects: {
                upsert: [project('project-a', '透亮猫眼', 329)],
              },
            },
          },
        },
      })) as { profileRevision: number };

      assert.equal(finalized.profileRevision, 2);
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            'store-project:project-a:price',
          )
        ).length,
        1,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'forged inline sources and non-D-151 fact mappings reject before a revision is written',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const forgedScreenshot = finalizeInput(environment.context.workspaceId, {
        profilePatch: { expectedRevision: 1 },
      });
      inlineBatch(forgedScreenshot).source.kind = 'group_buy_screenshot';
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          forgedScreenshot,
          'forged-inline-screenshot',
        ),
      );
      const forgedStoredBatch = inlineBatch(forgedScreenshot);
      await environment.intake.recordBatch({
        ...forgedStoredBatch,
        candidates: forgedStoredBatch.candidates.map((candidate) =>
          candidate.objectKind === 'store_fact'
            ? {
                ...candidate,
                fact: {
                  ...candidate.fact,
                  source: {
                    ...candidate.fact.source,
                    referenceId: forgedStoredBatch.source.referenceId,
                  },
                },
              }
            : candidate,
        ),
        workspaceId: environment.context.workspaceId,
        createdAt: now,
      });
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          {
            ...forgedScreenshot,
            batch: { batchId: forgedStoredBatch.batchId },
          },
          'forged-stored-screenshot',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_INTAKE_BATCH_UNTRUSTED',
      );

      const unsupported = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'forged-qualification',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'qualification',
            key: 'qualification.institution-license',
            value: { license: 'forged' },
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
          },
        },
        confirmation: {
          candidateId: 'forged-qualification',
          factId: 'store-profile:qualification:qualification',
          expectedFactRevision: 0,
        },
        profilePatch: { expectedRevision: 1 },
      });
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          unsupported,
          'unsupported-fact-kind',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );

      const mismatchedProject = finalizeInput(
        environment.context.workspaceId,
        {
          confirmation: {
            candidateId: 'project-a-service',
            factId: 'store-project:project-b:service',
            expectedFactRevision: 0,
          },
          profilePatch: { expectedRevision: 1 },
        },
      );
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          mismatchedProject,
          'mismatched-project-fact',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );

      const missingProjectScope = finalizeInput(
        environment.context.workspaceId,
        {
          candidate: {
            candidateId: 'persisted-project-without-service-scope',
            status: 'pending',
            objectKind: 'store_fact',
            fact: {
              kind: 'service',
              key: 'service.project-a.name',
              value: { name: '透亮猫眼' },
              scope: { storeId: environment.context.workspaceId },
              source: {
                kind: 'user_confirmation',
                referenceId: 'progressive-card',
                capturedAt: now,
              },
              effectiveFrom: now,
              expiresAt: null,
            },
          },
          confirmation: {
            candidateId: 'persisted-project-without-service-scope',
            factId: 'store-project:project-a:service',
            expectedFactRevision: 0,
          },
          profilePatch: { expectedRevision: 1 },
        },
      );
      const missingScopeBatch = inlineBatch(missingProjectScope);
      await environment.intake.recordBatch({
        ...missingScopeBatch,
        workspaceId: environment.context.workspaceId,
        createdAt: missingScopeBatch.source.capturedAt,
      });
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          {
            ...missingProjectScope,
            batch: { batchId: missingScopeBatch.batchId },
          },
          'missing-project-service-scope',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );

      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-profile:qualification:qualification',
        ),
        [],
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          'store-project:project-b:service',
        ),
        [],
      );
      assert.equal(
        (
          await environment.product.bootstrap({
            ...environment.context,
            actor: 'user',
          })
        ).store?.revision,
        1,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'retry keeps the persisted batch identity when the clock advances after a profile failure',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    let profileAttempts = 0;
    let clock = now;
    const environment = await createEnvironment(
      (product, context) => ({
        completedRevision: (projectionContext, patch, idempotencyKey) =>
          product.completedStoreProfileMergeRevision(
            { ...projectionContext, actor: 'user' },
            patch,
            idempotencyKey,
          ),
        currentRevision: async () =>
          (await product.bootstrap({ ...context, actor: 'user' })).store
            ?.revision ?? 0,
        async merge(projectionContext, patch, idempotencyKey) {
          profileAttempts += 1;
          if (profileAttempts === 1) {
            throw new Error('injected profile projection failure');
          }
          return product.mergeStoreProfile(
            { ...projectionContext, actor: 'user' },
            patch,
            idempotencyKey,
          );
        },
      }),
      undefined,
      () => clock,
    );
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 329)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'recover-profile',
        ),
        /injected profile projection failure/,
      );
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            input.confirmations[0]!.factId,
          )
        ).length,
        1,
      );

      clock = '2026-07-27T11:00:00.000Z';
      const recovered = await environment.finalizer.finalize(
        environment.context,
        input,
        'recover-profile',
      );
      const replay = await environment.finalizer.finalize(
        environment.context,
        input,
        'recover-profile',
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });

      assert.equal(profileAttempts, 2);
      assert.equal(recovered.profileRevision, 2);
      assert.equal(replay.profileRevision, 2);
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            input.confirmations[0]!.factId,
          )
        ).length,
        1,
      );
      assert.equal(state.store?.revision, 2);
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'a project revocation rejects an overlapping clear and upsert before either projection writes',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      await environment.finalizer.finalize(
        environment.context,
        finalizeInput(environment.context.workspaceId, {
          profilePatch: {
            expectedRevision: 1,
            projects: {
              upsert: [project('project-a', '透亮猫眼', 299)],
            },
          },
        }),
        'seed-overlap-revocation',
      );
      const revocation = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'overlap-project-a-revocation',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'service',
            key: 'service.project-a.name',
            value: null,
            scope: { storeId: environment.context.workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'progressive-card',
              capturedAt: now,
            },
            effectiveFrom: now,
            expiresAt: null,
            revisionKind: 'revocation',
          },
        },
        confirmation: {
          candidateId: 'overlap-project-a-revocation',
          factId: 'store-project:project-a:service',
          expectedFactRevision: 1,
        },
        profilePatch: {
          expectedRevision: 2,
          projects: {
            clear: ['project-a'],
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          revocation,
          'overlap-project-revocation',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID',
      );
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            'store-project:project-a:service',
          )
        ).length,
        1,
      );
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(state.store?.revision, 2);
      assert.equal(state.store?.projects.length, 1);
      assert.equal(state.store?.projects[0]?.id, 'project-a');
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'per-id project clear confirms a revocation and preserves unrelated profile data',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      const first = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          ...completePatch(),
          accounts: {
            upsert: [
              { platform: 'xiaohongshu', nickname: '青禾小红书' },
              { platform: 'douyin', nickname: '青禾抖音' },
            ],
          },
          projects: {
            upsert: [
              project('project-a', '透亮猫眼', 299),
              project('project-b', '法式渐变', 259),
            ],
          },
        },
      });
      const priceFactId = 'store-project:project-a:price';
      await environment.finalizer.finalize(
        environment.context,
        first,
        'seed-project-fact',
      );
      const activeBeforeRevocation = await environment.facts.listActive({
        workspaceId: environment.context.workspaceId,
        scope: {
          storeId: environment.context.workspaceId,
          serviceId: 'project-a',
        },
        at: now,
      });
      assert.equal(
        activeBeforeRevocation.some(
          (fact) => fact.factId === first.confirmations[0]!.factId,
        ),
        true,
      );
      assert.equal(
        activeBeforeRevocation.some((fact) => fact.factId === priceFactId),
        true,
      );

      const revocation = finalizeInput(environment.context.workspaceId, {
        candidate: {
          candidateId: 'revoke-project-a',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'service',
            key: 'service.project-a.name',
            value: null,
            scope: {
              storeId: environment.context.workspaceId,
              serviceId: 'project-a',
            },
          source: {
              kind: 'user_confirmation',
              referenceId: 'untrusted-client-reference',
              capturedAt: '2020-01-01T00:00:00.000Z',
            },
            effectiveFrom: now,
            expiresAt: null,
            revisionKind: 'revocation',
          },
        },
        confirmation: {
          candidateId: 'revoke-project-a',
          factId: first.confirmations[0]!.factId,
          expectedFactRevision: 1,
        },
        profilePatch: {
          expectedRevision: 1,
          projects: { clear: ['project-a'] },
        },
      });
      const revocationBatch = inlineBatch(revocation);
      revocationBatch.candidates.push({
        candidateId: 'revoke-project-a-price',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.project-a.price',
          value: null,
          scope: {
            storeId: environment.context.workspaceId,
            serviceId: 'project-a',
          },
          source: {
            kind: 'user_confirmation',
            referenceId: 'untrusted-client-reference',
            capturedAt: '2020-01-01T00:00:00.000Z',
          },
          effectiveFrom: now,
          expiresAt: null,
          revisionKind: 'revocation',
        },
      });
      revocation.confirmations.push({
        candidateId: 'revoke-project-a-price',
        factId: priceFactId,
        expectedFactRevision: 1,
      });
      await environment.finalizer.finalize(
        environment.context,
        revocation,
        'revoke-project',
      );
      const replay = await environment.finalizer.finalize(
        environment.context,
        revocation,
        'revoke-project',
      );
      const history = await environment.facts.history(
        environment.context.workspaceId,
        first.confirmations[0]!.factId,
      );
      const priceHistory = await environment.facts.history(
        environment.context.workspaceId,
        priceFactId,
      );
      const active = await environment.facts.listActive({
        workspaceId: environment.context.workspaceId,
        scope: {
          storeId: environment.context.workspaceId,
          serviceId: 'project-a',
        },
        at: now,
      });
      const state = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });

      assert.equal(replay.profileRevision, 2);
      assert.equal(history.length, 2);
      assert.equal(history[1]!.revisionKind, 'revocation');
      assert.equal(history[1]!.source.kind, 'user_confirmation');
      assert.equal(priceHistory.length, 2);
      assert.equal(priceHistory[1]!.revisionKind, 'revocation');
      assert.equal(priceHistory[1]!.source.kind, 'user_confirmation');
      assert.equal(
        active.some((fact) => fact.factId === first.confirmations[0]!.factId),
        false,
      );
      assert.equal(
        active.some((fact) => fact.factId === priceFactId),
        false,
      );
      assert.deepEqual(
        state.store?.projects.map((item) => item.id),
        ['project-b'],
      );
      assert.deepEqual(
        state.store?.accounts.map((account) => account.platform),
        ['xiaohongshu', 'douyin'],
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'retry reuses the exact profile receipt when completion fails after both projections',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    let completeAttempts = 0;
    const environment = await createEnvironment(undefined, (repository) => ({
      begin: (...args) => repository.begin(...args),
      markNeedsReconciliation: (...args) =>
        repository.markNeedsReconciliation(...args),
      reject: (...args) => repository.reject(...args),
      withLock: (...args) => repository.withLock(...args),
      async complete(...args) {
        completeAttempts += 1;
        if (completeAttempts === 1) {
          throw new Error('injected finalization completion failure');
        }
        return repository.complete(...args);
      },
    }));
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 329)],
          },
        },
      });

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'recover-completion',
        ),
        /injected finalization completion failure/,
      );
      const afterFailure = await environment.product.bootstrap({
        ...environment.context,
        actor: 'user',
      });
      assert.equal(afterFailure.store?.revision, 2);

      const recovered = await environment.finalizer.finalize(
        environment.context,
        input,
        'recover-completion',
      );
      const replay = await environment.finalizer.finalize(
        environment.context,
        input,
        'recover-completion',
      );

      assert.equal(completeAttempts, 2);
      assert.equal(recovered.profileRevision, 2);
      assert.equal(replay.profileRevision, 2);
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            input.confirmations[0]!.factId,
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await environment.product.bootstrap({
            ...environment.context,
            actor: 'user',
          })
        ).store?.revision,
        2,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'multi-fact preflight rejects a stale later head before the first fact is written',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const environment = await createEnvironment();
    try {
      await seedStore(environment);
      const existingCandidate = {
        candidateId: 'existing-project-service',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'service',
          key: 'service.project-existing.name',
          value: { name: '既有服务' },
          scope: {
            storeId: environment.context.workspaceId,
            serviceId: 'project-existing',
          },
          source: {
            kind: 'user_confirmation',
            referenceId: 'progressive-card',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      } as const;
      const existingFactId = 'store-project:project-existing:service';
      const existingPriceCandidate = {
        candidateId: 'existing-project-price',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.project-existing.price',
          value: { amount: 199, currency: 'CNY' },
          scope: {
            storeId: environment.context.workspaceId,
            serviceId: 'project-existing',
          },
          source: {
            kind: 'user_confirmation',
            referenceId: 'progressive-card',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      } as const;
      await environment.finalizer.finalize(
        environment.context,
        finalizeInput(environment.context.workspaceId, {
          candidate: existingCandidate,
          confirmation: {
            candidateId: existingCandidate.candidateId,
            factId: existingFactId,
            expectedFactRevision: 0,
          },
          profilePatch: {
            expectedRevision: 1,
            projects: {
              upsert: [project('project-existing', '既有服务', 199)],
            },
          },
        }),
        'seed-existing-fact-head',
      );

      const freshCandidate = {
        candidateId: 'fresh-project-service',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'service',
          key: 'service.project-fresh.name',
          value: { name: '新服务' },
          scope: {
            storeId: environment.context.workspaceId,
            serviceId: 'project-fresh',
          },
          source: {
            kind: 'user_confirmation',
            referenceId: 'progressive-card',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      } as const;
      const freshFactId = 'store-project:project-fresh:service';
      const freshPriceCandidate = {
        candidateId: 'fresh-project-price',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.project-fresh.price',
          value: { amount: 299, currency: 'CNY' },
          scope: {
            storeId: environment.context.workspaceId,
            serviceId: 'project-fresh',
          },
          source: {
            kind: 'user_confirmation',
            referenceId: 'progressive-card',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      } as const;
      const multi: FinalizeStoreIntakeCommand = {
        batch: {
          batchId: 'multi-preflight',
          taskId: 'multi-preflight',
          source: {
            sourceId: 'progressive-card',
            kind: 'manual',
            referenceId: 'progressive-card',
            capabilityStatus: 'verified',
            sourceWorkspaceId: environment.context.workspaceId,
            capturedAt: now,
            example: false,
          },
          summary: '两条事实一起确认。',
          candidates: [
            freshCandidate,
            freshPriceCandidate,
            existingCandidate,
            existingPriceCandidate,
          ],
        },
        confirmations: [
          {
            candidateId: freshCandidate.candidateId,
            factId: freshFactId,
            expectedFactRevision: 0,
          },
          {
            candidateId: existingCandidate.candidateId,
            factId: existingFactId,
            expectedFactRevision: 0,
          },
          {
            candidateId: freshPriceCandidate.candidateId,
            factId: 'store-project:project-fresh:price',
            expectedFactRevision: 0,
          },
          {
            candidateId: existingPriceCandidate.candidateId,
            factId: 'store-project:project-existing:price',
            expectedFactRevision: 0,
          },
        ],
        profilePatch: {
          expectedRevision: 2,
          projects: {
            upsert: [
              project('project-fresh', '新服务', 299),
              project('project-existing', '既有服务', 199),
            ],
          },
        },
      };

      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          multi,
          'multi-preflight-stale',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_REVISION_CONFLICT',
      );
      assert.deepEqual(
        await environment.facts.history(
          environment.context.workspaceId,
          freshFactId,
        ),
        [],
      );
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            existingFactId,
          )
        ).length,
        1,
      );
    } finally {
      await environment.cleanup();
    }
  },
);

test(
  'an external writer racing after the first fact leaves durable reconciliation instead of terminal rejection',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    let releaseSecond: () => void = () => {};
    let reportSecondReached: () => void = () => {};
    const secondReleased = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const secondReached = new Promise<void>((resolve) => {
      reportSecondReached = resolve;
    });
    const environment = await createEnvironment(
      undefined,
      undefined,
      () => now,
      (intake) => ({
        async confirmFact(context, input) {
          if (input.candidateId === 'barrier-second-price') {
            reportSecondReached();
            await secondReleased;
          }
          return intake.confirmFact(context, input);
        },
        confirmedFactRevision: (...args) =>
          intake.confirmedFactRevision(...args),
        currentFact: (...args) => intake.currentFact(...args),
        currentFactRevision: (...args) => intake.currentFactRevision(...args),
        effectiveFactSnapshot: (...args) =>
          intake.effectiveFactSnapshot(...args),
        persistedBatch: (...args) => intake.persistedBatch(...args),
        recordBatch: (...args) => intake.recordBatch(...args),
        withPinnedFactHeads: (...args) => intake.withPinnedFactHeads(...args),
      }),
    );
    try {
      await seedStore(environment);
      const input = finalizeInput(environment.context.workspaceId, {
        profilePatch: {
          expectedRevision: 1,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 329)],
          },
        },
      });
      const batch = inlineBatch(input);
      const priceConfirmation = input.confirmations.find(
        (confirmation) =>
          confirmation.factId === 'store-project:project-a:price',
      );
      if (!priceConfirmation) {
        throw new Error('Expected the mapped project price confirmation.');
      }
      const priceCandidate = batch.candidates.find(
        (candidate) => candidate.candidateId === priceConfirmation.candidateId,
      );
      if (!priceCandidate || priceCandidate.objectKind !== 'store_fact') {
        throw new Error('Expected the mapped project price candidate.');
      }
      priceCandidate.candidateId = 'barrier-second-price';
      priceConfirmation.candidateId = 'barrier-second-price';

      const finalizing = environment.finalizer.finalize(
        environment.context,
        input,
        'barrier-finalize',
      );
      await secondReached;
      assert.equal(
        await environment.intake.confirmedFactRevision(
          environment.context.workspaceId,
          'barrier-finalize:fact:project-a-service',
          {
            batchId: batch.batchId,
            candidateId: 'project-a-service',
            factId: 'store-project:project-a:service',
            expectedFactRevision: 0,
          },
        ),
        1,
      );

      await environment.intake.recordBatch({
        batchId: 'external-race-batch',
        workspaceId: environment.context.workspaceId,
        taskId: 'external-race-task',
        source: {
          sourceId: 'external-user-confirmation',
          kind: 'manual',
          referenceId: 'external-user-confirmation',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: environment.context.workspaceId,
          capturedAt: now,
          example: false,
        },
        summary: 'External canonical writer wins the price fact head.',
        candidates: [
          {
            candidateId: 'external-price',
            status: 'pending',
            objectKind: 'store_fact',
            fact: {
              kind: 'price',
              key: 'service.project-a.price',
              value: { amount: 319, currency: 'CNY' },
              scope: {
                storeId: environment.context.workspaceId,
                serviceId: 'project-a',
              },
              source: {
                kind: 'user_confirmation',
                referenceId: 'external-user-confirmation',
                capturedAt: now,
              },
              effectiveFrom: now,
              expiresAt: null,
            },
          },
        ],
        createdAt: now,
      });
      await environment.intake.confirmFact(environment.context, {
        batchId: 'external-race-batch',
        candidateId: 'external-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 0,
        idempotencyKey: 'external-price-winner',
      });
      releaseSecond();

      await assert.rejects(
        finalizing,
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_REVISION_CONFLICT',
      );
      const firstOutbox = await environment.pool.query<{ status: string }>(
        `SELECT status
           FROM p1_store_intake_finalization_outbox
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [environment.context.workspaceId, 'barrier-finalize'],
      );
      assert.equal(firstOutbox.rows[0]?.status, 'needs_reconciliation');
      await assert.rejects(
        environment.finalizer.finalize(
          environment.context,
          input,
          'barrier-finalize',
        ),
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_REVISION_CONFLICT',
      );
      const outbox = await environment.pool.query<{ status: string }>(
        `SELECT status
           FROM p1_store_intake_finalization_outbox
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [environment.context.workspaceId, 'barrier-finalize'],
      );

      assert.equal(outbox.rows[0]?.status, 'needs_reconciliation');
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            'store-project:project-a:service',
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await environment.facts.history(
            environment.context.workspaceId,
            'store-project:project-a:price',
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await environment.product.bootstrap({
            ...environment.context,
            actor: 'user',
          })
        ).store?.revision,
        1,
      );
    } finally {
      releaseSecond();
      await environment.cleanup();
    }
  },
);

test(
  'a backing fact revoked after the mapping pass stops the profile write instead of re-asserting the old value',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    let releaseWrite: () => void = () => {};
    let reportWriteReached: () => void = () => {};
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeReached = new Promise<void>((resolve) => {
      reportWriteReached = resolve;
    });
    const environment = await createEnvironment(
      undefined,
      undefined,
      () => now,
      (intake) => ({
        async confirmFact(context, input) {
          if (input.candidateId === 'toctou-barrier') {
            reportWriteReached();
            await writeReleased;
          }
          return intake.confirmFact(context, input);
        },
        confirmedFactRevision: (...args) =>
          intake.confirmedFactRevision(...args),
        currentFact: (...args) => intake.currentFact(...args),
        currentFactRevision: (...args) => intake.currentFactRevision(...args),
        effectiveFactSnapshot: (...args) =>
          intake.effectiveFactSnapshot(...args),
        persistedBatch: (...args) => intake.persistedBatch(...args),
        recordBatch: (...args) => intake.recordBatch(...args),
        withPinnedFactHeads: (...args) => intake.withPinnedFactHeads(...args),
      }),
    );
    const workspaceId = environment.context.workspaceId;
    try {
      await seedStore(environment);
      // Both project-a streams now stand in the ledger, so a later command may
      // omit either one of them.
      await environment.finalizer.finalize(
        environment.context,
        finalizeInput(workspaceId, {
          profilePatch: {
            expectedRevision: 1,
            projects: {
              upsert: [project('project-a', '透亮猫眼', 299)],
            },
          },
        }),
        'toctou-seed',
      );

      // Only the service stream is confirmed here — the price rides on the
      // fact already standing behind it.
      const omitting: FinalizeStoreIntakeCommand = {
        batch: {
          batchId: 'toctou-batch',
          taskId: 'toctou-task',
          source: {
            sourceId: 'progressive-card',
            kind: 'manual',
            referenceId: 'progressive-card',
            capabilityStatus: 'verified',
            sourceWorkspaceId: workspaceId,
            capturedAt: now,
            example: false,
          },
          summary: '商家又确认了一次项目名称。',
          candidates: [
            {
              candidateId: 'toctou-barrier',
              status: 'pending',
              objectKind: 'store_fact',
              fact: {
                kind: 'service',
                key: 'service.project-a.name',
                value: { name: '透亮猫眼' },
                scope: { storeId: workspaceId, serviceId: 'project-a' },
                source: {
                  kind: 'user_confirmation',
                  referenceId: 'progressive-card',
                  capturedAt: now,
                },
                effectiveFrom: now,
                expiresAt: null,
              },
            },
          ],
        },
        confirmations: [
          {
            candidateId: 'toctou-barrier',
            factId: 'store-project:project-a:service',
            expectedFactRevision: 1,
          },
        ],
        profilePatch: {
          expectedRevision: 2,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      };

      const finalizing = environment.finalizer.finalize(
        environment.context,
        omitting,
        'toctou-finalize',
      );
      await writeReached;

      // The mapping pass has already read the price head and waved the omitted
      // stream through. An external writer now takes that head away.
      await environment.intake.recordBatch({
        batchId: 'toctou-revocation-batch',
        workspaceId,
        taskId: 'toctou-revocation-task',
        source: {
          sourceId: 'external-user-confirmation',
          kind: 'manual',
          referenceId: 'external-user-confirmation',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: workspaceId,
          capturedAt: now,
          example: false,
        },
        summary: '商家撤回了这条价格。',
        candidates: [
          {
            candidateId: 'toctou-revocation',
            status: 'pending',
            objectKind: 'store_fact',
            fact: {
              kind: 'price',
              key: 'service.project-a.price',
              value: null,
              revisionKind: 'revocation',
              scope: { storeId: workspaceId, serviceId: 'project-a' },
              source: {
                kind: 'user_confirmation',
                referenceId: 'external-user-confirmation',
                capturedAt: now,
              },
              effectiveFrom: now,
              expiresAt: null,
            },
          },
        ],
        createdAt: now,
      });
      await environment.intake.confirmFact(environment.context, {
        batchId: 'toctou-revocation-batch',
        candidateId: 'toctou-revocation',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 1,
        idempotencyKey: 'toctou-revocation',
      });
      releaseWrite();

      await assert.rejects(
        finalizing,
        (error) =>
          error instanceof StoreIntakeFinalizationError &&
          error.code === 'STORE_FACT_MAPPING_INVALID' &&
          /requires confirmation store-project:project-a:price/u.test(
            error.message,
          ),
      );
      // The revoked value never reached the profile: the store still stands at
      // the revision the seeding finalize left behind.
      assert.equal(
        (
          await environment.product.bootstrap({
            ...environment.context,
            actor: 'user',
          })
        ).store?.revision,
        2,
      );
      const outbox = await environment.pool.query<{ status: string }>(
        `SELECT status
           FROM p1_store_intake_finalization_outbox
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, 'toctou-finalize'],
      );
      assert.equal(outbox.rows[0]?.status, 'needs_reconciliation');
      assert.equal(
        (
          await environment.facts.history(
            workspaceId,
            'store-project:project-a:price',
          )
        ).length,
        2,
      );
    } finally {
      releaseWrite();
      await environment.cleanup();
    }
  },
);

test(
  'a revocation racing the profile merge waits behind the pinned backing head instead of orphaning the merged value',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    let releaseMerge: () => void = () => {};
    let reportMergeReached: () => void = () => {};
    const mergeReleased = new Promise<void>((resolve) => {
      releaseMerge = resolve;
    });
    const mergeReached = new Promise<void>((resolve) => {
      reportMergeReached = resolve;
    });
    // The barrier sits between the omitted-backer re-check and the profile
    // write — the window the re-check alone cannot cover.
    const environment = await createEnvironment((product) => ({
      completedRevision: (context, patch, idempotencyKey) =>
        product.completedStoreProfileMergeRevision(
          { ...context, actor: 'user' },
          patch,
          idempotencyKey,
        ),
      currentRevision: async (context) =>
        (await product.bootstrap({ ...context, actor: 'user' })).store
          ?.revision ?? 0,
      merge: async (context, patch, idempotencyKey) => {
        if (idempotencyKey === 'pin-finalize:profile') {
          reportMergeReached();
          await mergeReleased;
        }
        return product.mergeStoreProfile(
          { ...context, actor: 'user' },
          patch,
          idempotencyKey,
        );
      },
    }));
    const workspaceId = environment.context.workspaceId;
    let finalizing: Promise<unknown> = Promise.resolve();
    let revoking: Promise<unknown> = Promise.resolve();
    try {
      await seedStore(environment);
      // Both project-a streams now stand in the ledger, so the next command may
      // omit the price and ride on the standing fact.
      await environment.finalizer.finalize(
        environment.context,
        finalizeInput(workspaceId, {
          profilePatch: {
            expectedRevision: 1,
            projects: {
              upsert: [project('project-a', '透亮猫眼', 299)],
            },
          },
        }),
        'pin-seed',
      );

      const omitting: FinalizeStoreIntakeCommand = {
        batch: {
          batchId: 'pin-batch',
          taskId: 'pin-task',
          source: {
            sourceId: 'progressive-card',
            kind: 'manual',
            referenceId: 'progressive-card',
            capabilityStatus: 'verified',
            sourceWorkspaceId: workspaceId,
            capturedAt: now,
            example: false,
          },
          summary: '商家又确认了一次项目名称。',
          candidates: [
            {
              candidateId: 'pin-barrier',
              status: 'pending',
              objectKind: 'store_fact',
              fact: {
                kind: 'service',
                key: 'service.project-a.name',
                value: { name: '透亮猫眼' },
                scope: { storeId: workspaceId, serviceId: 'project-a' },
                source: {
                  kind: 'user_confirmation',
                  referenceId: 'progressive-card',
                  capturedAt: now,
                },
                effectiveFrom: now,
                expiresAt: null,
              },
            },
          ],
        },
        confirmations: [
          {
            candidateId: 'pin-barrier',
            factId: 'store-project:project-a:service',
            expectedFactRevision: 1,
          },
        ],
        profilePatch: {
          expectedRevision: 2,
          projects: {
            upsert: [project('project-a', '透亮猫眼', 299)],
          },
        },
      };

      finalizing = environment.finalizer.finalize(
        environment.context,
        omitting,
        'pin-finalize',
      );
      await mergeReached;

      // The re-check has already passed. An external writer now tries to take
      // the backing price away while the profile write is still in flight.
      await environment.intake.recordBatch({
        batchId: 'pin-revocation-batch',
        workspaceId,
        taskId: 'pin-revocation-task',
        source: {
          sourceId: 'external-user-confirmation',
          kind: 'manual',
          referenceId: 'external-user-confirmation',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: workspaceId,
          capturedAt: now,
          example: false,
        },
        summary: '商家撤回了这条价格。',
        candidates: [
          {
            candidateId: 'pin-revocation',
            status: 'pending',
            objectKind: 'store_fact',
            fact: {
              kind: 'price',
              key: 'service.project-a.price',
              value: null,
              revisionKind: 'revocation',
              scope: { storeId: workspaceId, serviceId: 'project-a' },
              source: {
                kind: 'user_confirmation',
                referenceId: 'external-user-confirmation',
                capturedAt: now,
              },
              effectiveFrom: now,
              expiresAt: null,
            },
          },
        ],
        createdAt: now,
      });
      let revoked = false;
      revoking = environment.intake
        .confirmFact(environment.context, {
          batchId: 'pin-revocation-batch',
          candidateId: 'pin-revocation',
          factId: 'store-project:project-a:price',
          expectedFactRevision: 1,
          idempotencyKey: 'pin-revocation',
        })
        .then(() => {
          revoked = true;
        });

      // Wait for the revocation to actually reach the head row and block on
      // it — a fixed sleep would call the race won before it started under a
      // slow connection, and pass for the wrong reason.
      await waitForHeadLockWaiter(environment.pool);
      // The pin is a lock, not another optimistic re-read: the revocation is
      // still waiting on the price head, so the ledger has nothing new.
      assert.equal(revoked, false);
      assert.equal(
        (await environment.facts.history(
          workspaceId,
          'store-project:project-a:price',
        )).length,
        1,
      );

      releaseMerge();
      const result = (await finalizing) as { profileRevision: number };
      assert.equal(result.profileRevision, 3);
      await revoking;

      // The merged price was still confirmed at the moment it was written, and
      // the revocation lands right after it — never inside it.
      assert.equal(revoked, true);
      assert.equal(
        (await environment.facts.history(
          workspaceId,
          'store-project:project-a:price',
        )).length,
        2,
      );
      const store = (
        await environment.product.bootstrap({
          ...environment.context,
          actor: 'user',
        })
      ).store;
      assert.equal(store?.revision, 3);
      assert.equal(
        store?.projects.find((entry) => entry.id === 'project-a')?.price,
        299,
      );
      const outbox = await environment.pool.query<{ status: string }>(
        `SELECT status
           FROM p1_store_intake_finalization_outbox
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, 'pin-finalize'],
      );
      assert.equal(outbox.rows[0]?.status, 'completed');
    } finally {
      releaseMerge();
      await Promise.allSettled([finalizing, revoking]);
      await environment.cleanup();
    }
  },
);

/**
 * Blocks until some other backend is parked on a lock over the fact-head table
 * — the observable form of "the revocation has reached the head row and is now
 * waiting behind the pin". Only then does `revoked === false` mean the pin held
 * the line, rather than the revocation simply not having arrived yet.
 */
async function waitForHeadLockWaiter(pool: Pool, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const waiting = await pool.query<{ query: string }>(
      `SELECT query
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE '%p1_store_fact_heads%FOR UPDATE%'`,
    );
    if (waiting.rowCount) return;
    if (Date.now() >= deadline) {
      const activity = await pool.query<{
        state: string | null;
        wait_event_type: string | null;
        query: string;
      }>(
        `SELECT state, wait_event_type, query
           FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
      throw new Error(
        `No backend blocked on p1_store_fact_heads within ${timeoutMs}ms: ${JSON.stringify(
          activity.rows,
        )}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface Environment {
  cleanup(): Promise<void>;
  context: P1Context;
  facts: PostgresStoreFactLedger;
  finalizer: StoreIntakeFinalizer;
  intake: AssetIntakeService;
  pool: Pool;
  product: ProductService;
}

async function createEnvironment(
  profilePortFactory?: (
    product: ProductService,
    context: P1Context,
  ) => StoreProfileMergePort,
  finalizationRepositoryFactory?: (
    repository: PostgresStoreIntakeFinalizationRepository,
  ) => StoreIntakeFinalizationRepository,
  clock: () => string = () => now,
  finalizerIntakeFactory?: (
    intake: AssetIntakeService,
  ) => StoreIntakeFinalizationIntakePort,
): Promise<Environment> {
  const pool = new Pool({ connectionString });
  const workspaceId = `w01-behavior-${randomUUID()}`;
  const userId = `w01-user-${randomUUID()}`;
  const context: P1Context = {
    actor: 'owner',
    correlationId: `w01-${randomUUID()}`,
    userId,
    workspaceId,
  };
  const productRepository = new PostgresProductRepository(pool);
  const product = new ProductService({
    acceptedWriteOwner: 'p1',
    repository: productRepository,
  });
  const facts = new PostgresStoreFactLedger(pool);
  const intakeRepository = new PostgresAssetIntakeRepository(pool);
  const finalizations = new PostgresStoreIntakeFinalizationRepository(pool);
  const intake = new AssetIntakeService(intakeRepository, facts, clock);

  await createWorkspace(pool, workspaceId, userId);
  await productRepository.migrate();
  await facts.migrate();
  await intakeRepository.migrate();
  await finalizations.migrate();
  const profiles =
    profilePortFactory?.(product, context) ??
    ({
      completedRevision: (projectionContext, patch, idempotencyKey) =>
        product.completedStoreProfileMergeRevision(
          { ...projectionContext, actor: 'user' },
          patch,
          idempotencyKey,
        ),
      currentRevision: async (projectionContext) =>
        (
          await product.bootstrap({
            ...projectionContext,
            actor: 'user',
          })
        ).store?.revision ?? 0,
      merge: (projectionContext, patch, idempotencyKey) =>
        product.mergeStoreProfile(
          { ...projectionContext, actor: 'user' },
          patch,
          idempotencyKey,
        ),
    } satisfies StoreProfileMergePort);
  const finalizationRepository =
    finalizationRepositoryFactory?.(finalizations) ?? finalizations;

  return {
    context,
    facts,
    finalizer: new StoreIntakeFinalizer(
      finalizerIntakeFactory?.(intake) ?? intake,
      finalizationRepository,
      profiles,
      clock,
    ),
    intake,
    pool,
    product,
    async cleanup() {
      await finalizations.deleteWorkspaceForTest(workspaceId);
      await intakeRepository.deleteWorkspaceForTest(workspaceId);
      await facts.deleteWorkspaceForTest(workspaceId);
      await pool.query(
        'DELETE FROM product_command_results WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM p1_write_ownership WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM content_package_write_ownership WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    },
  };
}

async function seedStore(environment: Environment) {
  await environment.product.execute(
    { ...environment.context, actor: 'user' },
    {
      type: 'confirm_store',
      store: {
        accounts: [
          { platform: 'xiaohongshu', nickname: '青禾小红书' },
          { platform: 'douyin', nickname: '青禾抖音' },
        ],
        address: '湖墅南路 88 号',
        booking: '提前一天预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: '青禾美甲',
        prohibitions: ['不虚构价格'],
        projects: [project('project-a', '透亮猫眼', 299)],
        regulated: false,
      },
    },
    `seed-${randomUUID()}`,
  );
}

function archiveCardFinalizeInput(
  workspaceId: string,
): FinalizeStoreIntakeCommand {
  const capturedAt = now;
  const profileFact = (
    candidateId: string,
    fact: {
      kind: 'other' | 'fulfillment';
      key: string;
      value: Record<string, string>;
    },
  ) =>
    ({
      candidateId,
      status: 'pending' as const,
      objectKind: 'store_fact' as const,
      fact: {
        kind: fact.kind,
        key: fact.key,
        value: fact.value,
        scope: { storeId: workspaceId },
        source: {
          kind: 'user_confirmation' as const,
          referenceId: 'archive-card',
          capturedAt,
        },
        effectiveFrom: capturedAt,
        expiresAt: null,
      },
    }) as const;
  return {
    batch: {
      batchId: 'v31-86-archive-batch',
      taskId: 'v31-86-archive-task',
      source: {
        sourceId: 'archive-card',
        kind: 'manual',
        referenceId: 'archive-card',
        capabilityStatus: 'assisted',
        sourceWorkspaceId: workspaceId,
        capturedAt,
        example: false,
      },
      summary: 'Merchant confirmed the prepared store card.',
      candidates: [
        profileFact('profile-name', {
          kind: 'other',
          key: 'store.profile.name',
          value: { name: '盘点美发工作室' },
        }),
        profileFact('profile-city', {
          kind: 'other',
          key: 'store.profile.city',
          value: { city: '市中心' },
        }),
        {
          candidateId: 'project-a-service',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'service',
            key: 'service.project-a.name',
            value: { name: '染发套餐' },
            scope: { storeId: workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'archive-card',
              capturedAt,
            },
            effectiveFrom: capturedAt,
            expiresAt: null,
          },
        },
        {
          candidateId: 'project-a-price',
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'price',
            key: 'service.project-a.price',
            value: { amount: 388, currency: 'CNY' },
            scope: { storeId: workspaceId },
            source: {
              kind: 'user_confirmation',
              referenceId: 'archive-card',
              capturedAt,
            },
            effectiveFrom: capturedAt,
            expiresAt: null,
          },
        },
      ],
    },
    confirmations: [
      {
        candidateId: 'profile-name',
        factId: 'store-profile:name:other',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'profile-city',
        factId: 'store-profile:city:other',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'project-a-service',
        factId: 'store-project:project-a:service',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'project-a-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: {
      expectedRevision: 0,
      name: '盘点美发工作室',
      city: '市中心',
      district: STORE_PROFILE_PLATFORM_DEFAULTS.district,
      address: STORE_PROFILE_PLATFORM_DEFAULTS.address,
      booking: STORE_PROFILE_PLATFORM_DEFAULTS.booking,
      brandVoice: '真实、克制、像熟客推荐',
      regulated: false,
      projects: {
        upsert: [project('project-a', '染发套餐', 388)],
      },
    },
    fieldProvenance: {
      name: 'merchant_stated',
      city: 'ai_suggestion',
      projectName: 'ai_suggestion',
      projectPrice: 'ai_suggestion',
      district: 'platform_default',
      address: 'platform_default',
      booking: 'platform_default',
    },
  };
}

function finalizeInput(
  workspaceId: string,
  overrides: {
    candidate?: AssetIntakeBatchInput['candidates'][number];
    candidateStoreId?: string;
    confirmation?: FinalizeStoreIntakeCommand['confirmations'][number];
    profilePatch?: StoreProfilePatch;
  } = {},
): FinalizeStoreIntakeCommand {
  const candidate =
    overrides.candidate ??
    ({
      candidateId: 'project-a-service',
      status: 'pending',
      objectKind: 'store_fact',
      fact: {
        kind: 'service',
        key: 'service.project-a.name',
        value: { name: '透亮猫眼' },
        scope: {
          storeId: overrides.candidateStoreId ?? workspaceId,
        },
        source: {
          kind: 'user_confirmation',
          referenceId: 'client-asserted-reference',
          capturedAt: '2020-01-01T00:00:00.000Z',
        },
        effectiveFrom: now,
        expiresAt: null,
      },
    } as const);
  const input: FinalizeStoreIntakeCommand = {
    batch: {
      batchId: `batch-${candidate.candidateId}`,
      taskId: `task-${candidate.candidateId}`,
      source: {
        sourceId: 'progressive-card',
        kind: 'manual',
        referenceId: 'progressive-card',
        capabilityStatus: 'verified',
        sourceWorkspaceId: workspaceId,
        capturedAt: now,
        example: false,
      },
      summary: '商家确认了门店项目。',
      candidates: [candidate],
    },
    confirmations: [
      overrides.confirmation ?? {
        candidateId: candidate.candidateId,
        factId: 'store-project:project-a:service',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: overrides.profilePatch ?? {
      expectedRevision: 0,
    },
  };
  appendMappedPatchConfirmations(input, workspaceId);
  return input;
}

function appendMappedPatchConfirmations(
  input: FinalizeStoreIntakeCommand,
  workspaceId: string,
) {
  if (!('candidates' in input.batch)) return;
  const batch = input.batch;
  type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };
  const add = (entry: {
    factId: string;
    kind: 'other' | 'fulfillment' | 'service' | 'price';
    key: string;
    value: JsonValue;
    serviceId?: string;
  }) => {
    if (input.confirmations.some((confirmation) => confirmation.factId === entry.factId)) {
      return;
    }
    const candidateId = `${batch.batchId}-${entry.factId.replaceAll(':', '-')}`;
    batch.candidates.push({
      candidateId,
      status: 'pending',
      objectKind: 'store_fact',
      fact: {
        kind: entry.kind,
        key: entry.key,
        value: entry.value,
        scope: {
          storeId: workspaceId,
          ...(entry.serviceId ? { serviceId: entry.serviceId } : {}),
        },
        source: {
          kind: 'user_confirmation',
          referenceId: batch.source.referenceId,
          capturedAt: batch.source.capturedAt,
        },
        effectiveFrom: batch.source.capturedAt,
        expiresAt: null,
      },
    });
    input.confirmations.push({
      candidateId,
      factId: entry.factId,
      expectedFactRevision: 0,
    });
  };

  const patch = input.profilePatch;
  if (patch.name !== undefined) {
    add({
      factId: 'store-profile:name:other',
      kind: 'other',
      key: 'store.profile.name',
      value: { name: patch.name },
    });
  }
  if (patch.city !== undefined) {
    add({
      factId: 'store-profile:city:other',
      kind: 'other',
      key: 'store.profile.city',
      value: { city: patch.city },
    });
  }
  if (patch.district !== undefined) {
    add({
      factId: 'store-profile:district:other',
      kind: 'other',
      key: 'store.profile.district',
      value: { district: patch.district },
    });
  }
  if (patch.address !== undefined) {
    add({
      factId: 'store-profile:address:fulfillment',
      kind: 'fulfillment',
      key: 'store.fulfillment.address',
      value: { address: patch.address },
    });
  }
  if (patch.booking !== undefined) {
    add({
      factId: 'store-profile:booking:fulfillment',
      kind: 'fulfillment',
      key: 'store.fulfillment.booking',
      value: { booking: patch.booking },
    });
  }
  for (const project of patch.projects?.upsert ?? []) {
    add({
      factId: `store-project:${project.id}:service`,
      kind: 'service',
      key: `service.${project.id}.name`,
      value: { name: project.name },
      serviceId: project.id,
    });
    add({
      factId: `store-project:${project.id}:price`,
      kind: 'price',
      key: `service.${project.id}.price`,
      value: { amount: project.price, currency: 'CNY' },
      serviceId: project.id,
    });
  }
}

function inlineBatch(
  input: FinalizeStoreIntakeCommand,
): AssetIntakeBatchInput {
  assert.ok('candidates' in input.batch);
  return input.batch;
}

function completePatch(): StoreProfilePatch {
  return {
    expectedRevision: 0,
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    projects: {
      upsert: [project('project-a', '透亮猫眼', 299)],
    },
    regulated: false,
  };
}

function project(id: string, name: string, price: number) {
  return {
    confirmed: true,
    durationMinutes: 90,
    id,
    name,
    price,
    priceValidUntil: null,
  };
}

async function createWorkspace(
  pool: Pool,
  workspaceId: string,
  userId: string,
) {
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
    CREATE TABLE IF NOT EXISTS p1_write_ownership (
      workspace_id text PRIMARY KEY,
      owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'p1')),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS content_package_write_ownership (
      workspace_id text PRIMARY KEY,
      owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'contentpackage')),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES ($1, 'W01 behavior test user', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, 'W01 behavior workspace')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id)
     VALUES ($1, $2)`,
    [workspaceId, userId],
  );
  await insertNewAccountWriteOwnership(pool, workspaceId);
}
