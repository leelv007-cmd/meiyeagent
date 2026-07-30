import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import type { AgentPrimitiveExecutionPort } from '../agent-primitives/foundation-module.js';
import type { AgentPrimitiveExecutionRequest } from '../agent-primitives/runtime.js';
import type { SkillRepository } from './repository.js';
import {
  PostgresStoreWorkflowCaptureRepository,
  StoreWorkflowCaptureService,
  StoreWorkflowRecordProposalPort,
  type StoreWorkflowCaptureSession,
  type StoreWorkflowRecipe,
} from './store-workflow-capture.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'store workflow capture persists merchant confirmation, immutable catalog revision, and Task/DBOS three-axis trace',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresStoreWorkflowCaptureRepository(pool);
    const clock = advancingClock();
    const primitives = new PostgresCapturePrimitivePort(repository, clock);
    const service = new StoreWorkflowCaptureService(
      repository,
      primitives,
      activeCaptureSkillRepository(),
      clock,
    );
    const suffix = randomUUID();
    const workspaceId = `workspace-capture-${suffix}`;
    const taskId = `task-capture-${suffix}`;
    const sessionId = `session-capture-${suffix}`;
    const context = {
      actor: 'operator' as const,
      correlationId: `corr-capture-${suffix}`,
      userId: `merchant-capture-${suffix}`,
      workspaceId,
    };

    try {
      await repository.migrate();
      const waiting = await service.start(context, {
        catalogRevision: 'catalog.copy@3',
        dbosWorkflowId: taskId,
        sessionId,
        sourceConversationId: `conversation-${suffix}`,
        taskId,
        workflowRevision: 7,
      }) as StoreWorkflowCaptureSession;
      assert.equal(waiting.status, 'awaiting_merchant');

      const proposed = await service.answer(context, {
        items: [
          {
            field: 'corrections',
            result: { state: 'answer', values: ['去掉夸张承诺'] },
          },
          {
            field: 'inputOutputFormats',
            result: {
              state: 'answer',
              values: ['已确认事实到小红书短文'],
            },
          },
        ],
        sessionId,
      }) as StoreWorkflowCaptureSession;
      assert.equal(proposed.status, 'proposed');
      assert.ok(proposed.proposalRef);
      assert.deepEqual(await repository.listRecipes(workspaceId), []);

      await assert.rejects(
        service.confirm(
          { ...context, actor: 'worker', userId: 'worker-capture' },
          { sessionId },
        ),
        { code: 'FORBIDDEN' },
      );
      assert.deepEqual(await repository.listRecipes(workspaceId), []);

      const recipe = await service.confirm(context, { sessionId }) as StoreWorkflowRecipe;
      assert.equal(recipe.confirmedBy, context.userId);
      assert.equal(recipe.platformSkillRevisionRef, 'skill.capture-store-workflow@1');
      assert.equal(recipe.promptVersion, 'harness/intent-naming@260');
      assert.equal(recipe.catalogRevision, 'catalog.copy@3');

      const restarted = new PostgresStoreWorkflowCaptureRepository(pool);
      assert.deepEqual(await restarted.listRecipes(workspaceId), [recipe]);
      assert.deepEqual(await restarted.listRecipes(`other-${workspaceId}`), []);
      assert.deepEqual(
        await service.confirm(
          { ...context, userId: 'different-merchant' },
          { sessionId },
        ),
        recipe,
      );

      const traces = await pool.query<{
        dbos_workflow_id: string;
        event_type: string;
        payload: {
          axes: Record<string, { kind: string; value?: string } | string>;
        };
        task_id: string;
      }>(
        `SELECT task_id, dbos_workflow_id, event_type, payload
           FROM p1_store_workflow_capture_events
          WHERE workspace_id = $1
          ORDER BY occurred_at, event_id`,
        [workspaceId],
      );
      assert.deepEqual(
        traces.rows.map(({ event_type }) => event_type),
        [
          'read_context',
          'ask_merchant',
          'proposed',
          'merchant_confirmed',
          'recorded',
        ],
      );
      for (const trace of traces.rows) {
        assert.equal(trace.task_id, taskId);
        assert.equal(trace.dbos_workflow_id, taskId);
        assert.deepEqual(trace.payload.axes, expectedAxes());
      }
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count
               FROM p1_store_workflow_recipe_revisions
              WHERE workspace_id = $1 AND recipe_id = $2`,
            [workspaceId, recipe.recipeId],
          )
        ).rows[0]?.count,
        1,
      );
    } finally {
      await pool.end();
    }
  },
);

class PostgresCapturePrimitivePort implements AgentPrimitiveExecutionPort {
  private readonly record: StoreWorkflowRecordProposalPort;

  constructor(
    repository: PostgresStoreWorkflowCaptureRepository,
    now: () => string,
  ) {
    this.record = new StoreWorkflowRecordProposalPort(repository, now);
  }

  async execute(input: AgentPrimitiveExecutionRequest) {
    if (input.primitiveId === 'read_context') {
      return {
        workflowCapture: {
          steps: ['读取事实', '写一个主推荐', '检查红线'],
          tools: ['read_context', 'generate', 'check'],
        },
      };
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

function expectedAxes() {
  return {
    axisScope: 'task_root',
    catalogRevision: { kind: 'bound', value: 'catalog.copy@3' },
    promptVersion: { kind: 'bound', value: 'harness/intent-naming@260' },
    scene: { kind: 'bound', value: 'capture-store-workflow' },
    skillRevision: {
      kind: 'bound',
      value: 'skill.capture-store-workflow@1',
    },
  };
}

function advancingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 30, 8, 0, tick++)).toISOString();
}
