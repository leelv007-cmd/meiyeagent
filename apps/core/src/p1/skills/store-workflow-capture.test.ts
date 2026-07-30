import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { ObservabilityAxisBinding } from '@meiye/contracts';

import type { AgentPrimitiveExecutionPort } from '../agent-primitives/foundation-module.js';
import type { AgentPrimitiveExecutionRequest } from '../agent-primitives/runtime.js';
import type { P1Context } from '../foundation/domain.js';
import {
  MemorySkillRepository,
  type SkillRepository,
} from './repository.js';
import { SkillService } from './service.js';
import { SkillFoundationModule } from './foundation-module.js';
import {
  StoreWorkflowCaptureService,
  StoreWorkflowRecordProposalPort,
  type StoreWorkflowCaptureRepository,
  type StoreWorkflowCaptureSession,
  type StoreWorkflowCaptureTrace,
  type StoreWorkflowProposal,
  type StoreWorkflowRecipe,
} from './store-workflow-capture.js';

const NOW = '2026-07-30T08:00:00.000Z';
const CONTEXT: P1Context = {
  actor: 'owner',
  correlationId: 'corr-capture-260',
  userId: 'merchant-260',
  workspaceId: 'workspace-260',
};
const START = {
  catalogRevision: 'catalog.copy@3',
  dbosWorkflowId: 'task-260',
  sessionId: 'session-260',
  sourceConversationId: 'conversation-260',
  taskId: 'task-260',
  workflowRevision: 4,
};

test('production assembles the capture repository, composite record port, and Skill module consumer', async () => {
  const source = await readFile(new URL('../../main.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /new PostgresStoreWorkflowCaptureRepository\(pool\)[\s\S]*?storeWorkflowCaptureRepository,[\s\S]*?new CompositeRecordProposalPort\([\s\S]*?new StoreWorkflowRecordProposalPort\(storeWorkflowCaptureRepository\)[\s\S]*?attachCaptureWorkflow\([\s\S]*?new StoreWorkflowCaptureService\(/u,
  );
  assert.match(
    source,
    /input\.scope !== 'conversation\.current'/u,
  );
});

test('ordinary capture session reads, proposes, waits for merchant confirmation, records, and becomes catalog-visible', async () => {
  const repository = new MemoryCaptureRepository();
  const primitives = new CapturePrimitivePort(repository, {
    corrections: ['标题不要夸张'],
    inputOutputFormats: ['门店事实到小红书短文'],
    steps: ['读取已确认事实', '生成一个主推荐', '检查红线'],
    tools: ['read_context', 'generate', 'check'],
  });
  const module = captureModule(repository, primitives);

  const proposed = await execute(module, CONTEXT, 'store_workflow_capture_start', START) as StoreWorkflowCaptureSession;
  assert.equal(proposed.status, 'proposed');
  assert.ok(proposed.proposalRef);
  assert.deepEqual(primitives.calls.map(({ primitiveId }) => primitiveId), [
    'read_context',
    'record',
  ]);
  assert.deepEqual(
    await query(module, CONTEXT, 'store_workflow_catalog', {}),
    { items: [] },
  );

  const recipe = await execute(
    module,
    CONTEXT,
    'store_workflow_capture_confirm',
    { sessionId: START.sessionId },
  ) as StoreWorkflowRecipe;
  assert.equal(recipe.confirmedBy, CONTEXT.userId);
  assert.equal(recipe.platformSkillRevisionRef, 'skill.capture-store-workflow@1');
  assert.equal(recipe.promptVersion, 'harness/intent-naming@260');
  assert.equal(recipe.catalogRevision, START.catalogRevision);
  assert.deepEqual(
    await query(module, CONTEXT, 'store_workflow_catalog', {}),
    { items: [recipe] },
  );
  assert.deepEqual(
    repository.traces.map(({ eventType }) => eventType),
    ['read_context', 'proposed', 'merchant_confirmed', 'recorded'],
  );
  for (const trace of repository.traces) {
    assert.equal(trace.taskId, START.taskId);
    assert.equal(trace.dbosWorkflowId, START.dbosWorkflowId);
    assert.deepEqual(trace.axes, expectedAxes());
  }
});

test('missing capture fields are asked once and non-merchants or mismatched DBOS identity cannot confirm', async () => {
  const repository = new MemoryCaptureRepository();
  const primitives = new CapturePrimitivePort(repository, {
    steps: ['先选事实', '再写文案'],
    tools: ['read_context', 'generate'],
  });
  const module = captureModule(repository, primitives);

  const waiting = await execute(module, CONTEXT, 'store_workflow_capture_start', START) as StoreWorkflowCaptureSession;
  assert.equal(waiting.status, 'awaiting_merchant');
  assert.deepEqual(waiting.missingFields, ['corrections', 'inputOutputFormats']);
  assert.deepEqual(primitives.calls.map(({ primitiveId }) => primitiveId), [
    'read_context',
    'ask_merchant',
  ]);
  assert.deepEqual(await query(module, CONTEXT, 'store_workflow_catalog', {}), {
    items: [],
  });

  const proposed = await execute(
    module,
    CONTEXT,
    'store_workflow_capture_answer',
    {
      items: [
        { field: 'corrections', result: { state: 'deferred' } },
        { field: 'inputOutputFormats', result: { state: 'skipped' } },
      ],
      sessionId: START.sessionId,
    },
  ) as StoreWorkflowCaptureSession;
  assert.equal(proposed.status, 'proposed');
  assert.equal(
    primitives.calls.filter(({ primitiveId }) => primitiveId === 'ask_merchant').length,
    1,
  );
  assert.deepEqual(await query(module, CONTEXT, 'store_workflow_catalog', {}), {
    items: [],
  });

  await assert.rejects(
    execute(
      module,
      { ...CONTEXT, actor: 'worker', userId: 'worker-260' },
      'store_workflow_capture_confirm',
      { sessionId: START.sessionId },
    ),
    { code: 'FORBIDDEN' },
  );
  assert.deepEqual(await query(module, CONTEXT, 'store_workflow_catalog', {}), {
    items: [],
  });
  await execute(module, CONTEXT, 'store_workflow_capture_confirm', {
    sessionId: START.sessionId,
  });
  assert.equal(
    (await query(
      module,
      { ...CONTEXT, workspaceId: 'workspace-other' },
      'store_workflow_catalog',
      {},
    ) as { items: unknown[] }).items.length,
    0,
  );

  await assert.rejects(
    execute(module, CONTEXT, 'store_workflow_capture_start', {
      ...START,
      dbosWorkflowId: 'forged-dbos-workflow',
      sessionId: 'session-forged',
    }),
    /Task and DBOS workflow identity must match/u,
  );
});

function captureModule(
  repository: StoreWorkflowCaptureRepository,
  primitives: AgentPrimitiveExecutionPort,
) {
  const module = new SkillFoundationModule(
    new SkillService(new MemorySkillRepository(), () => NOW),
  );
  module.attachCaptureWorkflow(
    new StoreWorkflowCaptureService(
      repository,
      primitives,
      activeCaptureSkillRepository(),
      () => NOW,
    ),
  );
  return module;
}

function execute(
  module: SkillFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.execute({
    context,
    idempotencyKey: `${action}:${String(payload.sessionId ?? 'catalog')}`,
    input: { action, payload },
  });
}

function query(
  module: SkillFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.query({ context, input: { action, payload } });
}

function activeCaptureSkillRepository() {
  return {
    async getCatalog() {
      return { activeRevisionRef: 'skill.capture-store-workflow@1' };
    },
    async getRevision() {
      return {
        prompt: { name: 'harness/intent-naming', version: '260' },
        skillRevisionRef: 'skill.capture-store-workflow@1',
        status: 'accepted_frozen',
      };
    },
  } as unknown as SkillRepository;
}

function expectedAxes(): ObservabilityAxisBinding {
  return {
    axisScope: 'task_root',
    catalogRevision: { kind: 'bound', value: START.catalogRevision },
    promptVersion: { kind: 'bound', value: 'harness/intent-naming@260' },
    scene: { kind: 'bound', value: 'capture-store-workflow' },
    skillRevision: {
      kind: 'bound',
      value: 'skill.capture-store-workflow@1',
    },
  };
}

class CapturePrimitivePort implements AgentPrimitiveExecutionPort {
  readonly calls: AgentPrimitiveExecutionRequest[] = [];
  private readonly record: StoreWorkflowRecordProposalPort;

  constructor(
    repository: StoreWorkflowCaptureRepository,
    private readonly context: Record<string, string[]>,
  ) {
    this.record = new StoreWorkflowRecordProposalPort(repository, () => NOW);
  }

  async execute(input: AgentPrimitiveExecutionRequest) {
    this.calls.push(structuredClone(input));
    if (input.primitiveId === 'read_context') {
      return { workflowCapture: structuredClone(this.context) };
    }
    if (input.primitiveId === 'ask_merchant') {
      return { requestRef: `${input.serverContext.taskId}:question` };
    }
    if (input.primitiveId === 'record') {
      const modelInput = input.modelInput as Pick<
        Parameters<StoreWorkflowRecordProposalPort['propose']>[0],
        'kind' | 'payload' | 'provenance'
      >;
      return this.record.propose({
        execution: {
          actorId: input.serverContext.actorId,
          correlationId: input.serverContext.correlationId,
          taskId: input.serverContext.taskId,
        },
        idempotencyKey: input.serverContext.idempotencyKey,
        kind: modelInput.kind,
        payload: modelInput.payload,
        provenance: modelInput.provenance,
        workspaceId: input.serverContext.workspaceId,
      });
    }
    throw new Error(`Unexpected primitive: ${input.primitiveId}`);
  }
}

class MemoryCaptureRepository implements StoreWorkflowCaptureRepository {
  readonly sessions = new Map<string, StoreWorkflowCaptureSession>();
  readonly proposals = new Map<string, StoreWorkflowProposal>();
  readonly recipes = new Map<string, StoreWorkflowRecipe>();
  readonly traces: StoreWorkflowCaptureTrace[] = [];

  async putSession(session: StoreWorkflowCaptureSession) {
    this.sessions.set(key(session.workspaceId, session.sessionId), structuredClone(session));
    return structuredClone(session);
  }

  async updateSession(session: StoreWorkflowCaptureSession, expectedRevision: number) {
    const current = await this.getSession(session.workspaceId, session.sessionId);
    if (!current || current.revision !== expectedRevision) throw new Error('Session revision conflict.');
    this.sessions.set(key(session.workspaceId, session.sessionId), structuredClone(session));
    return structuredClone(session);
  }

  async getSession(workspaceId: string, sessionId: string) {
    return structuredClone(this.sessions.get(key(workspaceId, sessionId)) ?? null);
  }

  async putProposal(proposal: StoreWorkflowProposal) {
    this.proposals.set(key(proposal.workspaceId, proposal.proposalRef), structuredClone(proposal));
    return structuredClone(proposal);
  }

  async getProposal(workspaceId: string, proposalRef: string) {
    return structuredClone(this.proposals.get(key(workspaceId, proposalRef)) ?? null);
  }

  async rejectProposal(input: {
    workspaceId: string;
    proposalRef: string;
    rejectedAt: string;
    rejectedBy: string;
  }) {
    const proposal = await this.requiredProposal(input.workspaceId, input.proposalRef);
    const rejected = { ...proposal, status: 'rejected' as const };
    this.proposals.set(key(input.workspaceId, input.proposalRef), rejected);
    return structuredClone(rejected);
  }

  async confirmProposal(input: {
    workspaceId: string;
    proposalRef: string;
    confirmedAt: string;
    confirmedBy: string;
  }) {
    const existing = [...this.recipes.values()].find(
      ({ workspaceId, sourceProposalRef }) =>
        workspaceId === input.workspaceId && sourceProposalRef === input.proposalRef,
    );
    if (existing) return structuredClone(existing);
    const proposal = await this.requiredProposal(input.workspaceId, input.proposalRef);
    const axes = proposal.axes;
    const recipe: StoreWorkflowRecipe = {
      catalogRevision: bound(axes.catalogRevision),
      confirmedAt: input.confirmedAt,
      confirmedBy: input.confirmedBy,
      fields: structuredClone(proposal.fields),
      messageRange: structuredClone(proposal.messageRange),
      platformSkillRevisionRef: bound(axes.skillRevision),
      promptVersion: bound(axes.promptVersion),
      recipeId: `recipe:${proposal.proposalRef}`,
      revision: 1,
      sourceConversationId: proposal.sourceConversationId,
      sourceProposalRef: proposal.proposalRef,
      sourceTurnId: proposal.sourceTurnId,
      title: proposal.title,
      workspaceId: proposal.workspaceId,
    };
    this.recipes.set(key(recipe.workspaceId, recipe.recipeId), structuredClone(recipe));
    for (const eventType of ['merchant_confirmed', 'recorded'] as const) {
      this.traces.push({
        axes: structuredClone(proposal.axes),
        dbosWorkflowId: proposal.dbosWorkflowId,
        eventId: `${proposal.sessionId}:${eventType}`,
        eventType,
        occurredAt: input.confirmedAt,
        payload: { proposalRef: proposal.proposalRef, recipeId: recipe.recipeId },
        taskId: proposal.taskId,
        workspaceId: proposal.workspaceId,
      });
    }
    return structuredClone(recipe);
  }

  async listRecipes(workspaceId: string) {
    return [...this.recipes.values()]
      .filter((recipe) => recipe.workspaceId === workspaceId)
      .map((recipe) => structuredClone(recipe));
  }

  async appendTrace(input: StoreWorkflowCaptureTrace) {
    this.traces.push(structuredClone(input));
  }

  private async requiredProposal(workspaceId: string, proposalRef: string) {
    const proposal = await this.getProposal(workspaceId, proposalRef);
    if (!proposal) throw new Error('Proposal not found.');
    return proposal;
  }
}

function key(workspaceId: string, id: string) {
  return `${workspaceId}:${id}`;
}

function bound(axis: { kind: 'bound'; value: string } | { kind: 'absent' }) {
  if (axis.kind !== 'bound') throw new Error('Expected a bound axis.');
  return axis.value;
}
