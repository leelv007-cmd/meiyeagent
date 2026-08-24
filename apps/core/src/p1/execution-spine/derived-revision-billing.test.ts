/**
 * V31-45 / R-P0-05: a derived revision creates a new quoted submission. It
 * never writes the source ContentPackage as a shortcut around billing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeSteeringCommandSchema,
  type BuildProductQuoteInput,
} from '@meiye/contracts';

import {
  SteeringDerivedWorkflowCoordinator,
  type SteeringDerivedSource,
  type SteeringDerivedWorkflowRecord,
  type SteeringDerivedWorkflowStore,
} from '../agent-session/steering-derived-workflow.js';
import {
  projectSteeringImpact,
  type SteeringConsumerInput,
} from '../agent-session/steering-service.js';

class MemoryWorkflowStore implements SteeringDerivedWorkflowStore {
  record: SteeringDerivedWorkflowRecord | null = null;
  readonly events: string[] = [];

  async findByCommandId(commandId: string) {
    return this.record?.commandId === commandId
      ? structuredClone(this.record)
      : null;
  }

  async markLaunched(input: {
    commandId: string;
    derivedPackageId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }) {
    assert.equal(this.record?.commandId, input.commandId);
    this.events.push('launched');
    this.record = {
      ...this.record!,
      ...input,
      status: 'launched',
    };
  }

  async markPrepared(input: {
    commandId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }) {
    assert.equal(this.record?.commandId, input.commandId);
    this.events.push('prepared');
    this.record = {
      ...this.record!,
      ...input,
      status: 'prepared',
    };
  }

  async putPending(record: SteeringDerivedWorkflowRecord) {
    this.events.push('pending');
    if (!this.record) this.record = structuredClone(record);
    return structuredClone(this.record);
  }
}

const source: SteeringDerivedSource = {
  currentVersionId: 'version-source',
  generated: { assetIds: ['asset-cover'] },
  id: 'package-source',
  revision: 7,
  source: {
    creationExecutionSnapshot: { id: 'snapshot-source' },
    workflowId: 'task-source',
    workId: 'work-source',
  },
  versions: [
    {
      id: 'version-source',
      orderedAssetIds: ['asset-cover'],
      note: {
        plan: {
          pages: [{ id: 'page-cover', imageAssetId: 'asset-cover' }],
        },
      },
    },
  ],
};

const steeringInput: SteeringConsumerInput = {
  affectedUnitIds: ['page-cover'],
  command: makeSteeringCommandSchema.parse({
    actorId: 'merchant-1',
    affectedUnitIds: ['page-cover'],
    classification: {
      completedUnits: ['page-cover'],
      kind: 'derived_revision',
      requiresRequote: true,
    },
    commandId: 'steer-derived-1',
    createdAt: '2026-08-11T09:00:00.000Z',
    instruction: '把封面改成夏日风格',
    queueMode: 'steer',
    schemaVersion: 'steering-command/v1',
    sourceContentVersionIds: ['version-source'],
    sourcePlanRevision: 3,
    taskId: 'task-source',
    threadId: 'thread-source',
    workId: 'work-source',
  }),
  instruction: '把封面改成夏日风格',
  preservedUnitIds: [],
  sourcePlanRevision: 3,
  taskId: 'task-source',
  threadId: 'thread-source',
  workId: 'work-source',
  workspaceId: 'workspace-source',
};

test('V31-45 derived steering durably launches the quoted Composer submission once', async () => {
  const store = new MemoryWorkflowStore();
  const events: string[] = [];
  const quoteInputs: BuildProductQuoteInput[] = [];
  const coordinator = new SteeringDerivedWorkflowCoordinator({
    billing: {
      buildQuote(input: BuildProductQuoteInput) {
        events.push('quote');
        quoteInputs.push(input);
        return { quoteId: input.quoteId, revision: 'quote-r1' };
      },
    },
    commands: {
      async adjust(_context, command) {
        events.push('adjust');
        if (!('derivedTaskId' in command)) {
          throw new Error('Derived steering must use a frozen ContentPackage source.');
        }
        assert.equal(command.source.kind, 'content_package_snapshot');
        assert.equal(command.billingQuoteId, 'steering-derived:quote:steer-derived-1');
        assert.equal(command.derivedTaskId, 'task-derived');
        assert.equal(command.derivedWorkId, 'work-derived');
        assert.deepEqual(command.scope, { assetId: 'asset-cover', kind: 'asset' });
        return {
          contentPackage: { id: 'package-derived' },
          task: { id: 'task-derived' },
          work: { id: 'work-derived' },
        };
      },
      async prepareAdjust(_context, command) {
        events.push('prepare');
        assert.deepEqual(command.source, {
          expectedPackageRevision: 7,
          kind: 'content_package_snapshot',
          packageId: 'package-source',
          snapshotId: 'snapshot-source',
          workflowId: 'task-source',
        });
        return {
          quoteIntent: {
            catalogModelId: 'image-model-1',
            operation: 'image.generate',
            quantity: 1,
          },
          task: { id: 'task-derived' },
          work: { id: 'work-derived' },
        };
      },
    },
    operations: {
      async getCreativeWorkbench() {
        events.push('workbench');
        return { works: [{ id: 'work-source', updatedAt: '2026-08-11T08:00:00.000Z' }] };
      },
    },
    quoteAuthority: {
      async resolve(input) {
        events.push('quote-authority');
        return {
          billingMode: 'per_request',
          catalogModelId: input.catalogModelId,
          creditCost: 8,
          failureRefundsCredits: true,
          operation: input.operation,
          outputCount: input.quantity,
          outputLabel: '1 张图片',
          quoteId: input.quoteId,
          quotePolicyRevision: 'policy-r1',
          unitRate: 8,
          workspaceId: input.workspaceId,
        };
      },
    },
    resolveSource: async () => {
      events.push('source');
      return structuredClone(source);
    },
    store,
  });

  const first = await coordinator.launch(steeringInput);
  const replay = await coordinator.launch(steeringInput);

  assert.deepEqual(first, { status: 'launched' });
  assert.deepEqual(replay, { status: 'launched' });
  assert.deepEqual(events, [
    'source',
    'workbench',
    'prepare',
    'quote-authority',
    'quote',
    'adjust',
  ]);
  assert.deepEqual(store.events, ['pending', 'prepared', 'launched']);
  assert.equal(store.record?.status, 'launched');
  assert.equal(store.record?.derivedPackageId, 'package-derived');
  assert.equal(quoteInputs.length, 1);
  assert.equal(quoteInputs[0]?.quoteId, 'steering-derived:quote:steer-derived-1');
});

test('V31-45 refuses a derived steering command before quote or reservation when scope is not frozen', async () => {
  let quoted = false;
  let submitted = false;
  const coordinator = new SteeringDerivedWorkflowCoordinator({
    billing: {
      buildQuote() {
        quoted = true;
        return { quoteId: 'unexpected', revision: 'unexpected' };
      },
    },
    commands: {
      async adjust() {
        submitted = true;
        return {
          contentPackage: { id: 'unexpected' },
          task: { id: 'unexpected' },
          work: { id: 'unexpected' },
        };
      },
      async prepareAdjust() {
        throw new Error('prepare must not run without frozen target assets');
      },
    },
    operations: {
      async getCreativeWorkbench() {
        return { works: [{ id: 'work-source', updatedAt: '2026-08-11T08:00:00.000Z' }] };
      },
    },
    quoteAuthority: {
      async resolve() {
        throw new Error('quote authority must not run without frozen target assets');
      },
    },
    resolveSource: async () => ({
      ...source,
      generated: { assetIds: [] },
      versions: [
        {
          id: 'version-source',
          orderedAssetIds: [],
          note: { plan: { pages: [{ id: 'page-cover' }] } },
        },
      ],
    }),
    store: new MemoryWorkflowStore(),
  });

  await assert.rejects(
    () => coordinator.launch(steeringInput),
    /no canonical source assets/u,
  );
  assert.equal(quoted, false);
  assert.equal(submitted, false);
});

test('V31-45 derived_revision quote is the only credit writer and matches merchant rebilled copy', async () => {
  const quoteInputs: BuildProductQuoteInput[] = [];
  const reservedQuoteIds: string[] = [];
  let resolvedCreditCost: number | undefined;
  const coordinator = new SteeringDerivedWorkflowCoordinator({
    billing: {
      buildQuote(input: BuildProductQuoteInput) {
        quoteInputs.push(input);
        return { quoteId: input.quoteId, revision: 'quote-r1' };
      },
    },
    commands: {
      async adjust(_context, command) {
        if (!('derivedTaskId' in command)) {
          throw new Error('Derived steering must use a frozen ContentPackage source.');
        }
        reservedQuoteIds.push(command.billingQuoteId);
        return {
          contentPackage: { id: 'package-derived' },
          task: { id: 'task-derived' },
          work: { id: 'work-derived' },
        };
      },
      async prepareAdjust() {
        return {
          quoteIntent: {
            catalogModelId: 'image-model-1',
            operation: 'image.generate',
            quantity: 1,
          },
          task: { id: 'task-derived' },
          work: { id: 'work-derived' },
        };
      },
    },
    operations: {
      async getCreativeWorkbench() {
        return { works: [{ id: 'work-source', updatedAt: '2026-08-11T08:00:00.000Z' }] };
      },
    },
    quoteAuthority: {
      async resolve(input) {
        const quoted: BuildProductQuoteInput = {
          billingMode: 'per_request',
          catalogModelId: input.catalogModelId,
          creditCost: 8,
          failureRefundsCredits: true,
          operation: input.operation,
          outputCount: input.quantity,
          outputLabel: '1 张图片',
          quoteId: input.quoteId,
          quotePolicyRevision: 'policy-r1',
          unitRate: 8,
          workspaceId: input.workspaceId,
        };
        resolvedCreditCost = quoted.creditCost;
        return quoted;
      },
    },
    resolveSource: async () => structuredClone(source),
    store: new MemoryWorkflowStore(),
  });

  await coordinator.launch(steeringInput);

  assert.equal(quoteInputs.length, 1, 'quote path writes once');
  assert.equal(quoteInputs[0]?.creditCost, resolvedCreditCost);
  assert.equal(quoteInputs[0]?.creditCost, 8);
  assert.deepEqual(reservedQuoteIds, [quoteInputs[0]?.quoteId]);
  assert.equal(
    quoteInputs[0]?.quoteId,
    'steering-derived:quote:steer-derived-1',
  );

  const impact = projectSteeringImpact({
    classificationKind: 'derived_revision',
    applicationStatus: 'accepted',
    affectedUnitIds: ['page-cover'],
    preservedUnitIds: [],
    units: [
      {
        unitId: 'page-cover',
        status: 'completed',
        label: '封面',
        pageIndex: 0,
      },
    ],
  });
  assert.equal(impact.rebilled, true);
  assert.match(impact.feeNote, /积分/u);
  assert.doesNotMatch(impact.feeNote, /成本|上游|供应商|token|USD|\$/iu);
  assert.doesNotMatch(impact.settledNote ?? '', /成本|上游|供应商|token|USD|\$/iu);
});
