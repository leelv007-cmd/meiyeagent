import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  observabilityAxisBindingSchema,
  type ObservabilityAxisBinding,
  type QuestionCard,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import type { RecordProposalPort } from '../agent-primitives/core-handlers.js';
import type { AgentPrimitiveExecutionPort } from '../agent-primitives/foundation-module.js';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { SkillRepository } from './repository.js';
import { PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID } from './platform-provisioning.js';

const captureFieldNames = [
  'tools',
  'steps',
  'corrections',
  'inputOutputFormats',
] as const;
type CaptureFieldName = (typeof captureFieldNames)[number];

const captureFieldValueSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('answer'), values: z.array(z.string().trim().min(1)).min(1) }).strict(),
  z.object({ state: z.literal('deferred') }).strict(),
  z.object({ state: z.literal('skipped') }).strict(),
]);
type CaptureFieldValue = z.infer<typeof captureFieldValueSchema>;

const captureFieldsSchema = z.object({
  tools: captureFieldValueSchema.nullable(),
  steps: captureFieldValueSchema.nullable(),
  corrections: captureFieldValueSchema.nullable(),
  inputOutputFormats: captureFieldValueSchema.nullable(),
}).strict();
type CaptureFields = z.infer<typeof captureFieldsSchema>;

export interface StoreWorkflowCaptureSession {
  sessionId: string;
  workspaceId: string;
  taskId: string;
  dbosWorkflowId: string;
  workflowRevision: number;
  sourceConversationId: string;
  status: 'awaiting_merchant' | 'proposed' | 'confirmed' | 'rejected';
  fields: CaptureFields;
  missingFields: CaptureFieldName[];
  questionRef: string | null;
  proposalRef: string | null;
  axes: ObservabilityAxisBinding;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoreWorkflowProposal {
  proposalRef: string;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  dbosWorkflowId: string;
  title: string;
  fields: Record<CaptureFieldName, CaptureFieldValue>;
  sourceConversationId: string;
  sourceTurnId: string;
  messageRange: { start: number; end: number };
  axes: ObservabilityAxisBinding;
  status: 'proposed' | 'confirmed' | 'rejected';
  proposedAt: string;
}

export interface StoreWorkflowRecipe {
  recipeId: string;
  revision: 1;
  workspaceId: string;
  title: string;
  fields: Record<CaptureFieldName, CaptureFieldValue>;
  sourceConversationId: string;
  sourceTurnId: string;
  messageRange: { start: number; end: number };
  sourceProposalRef: string;
  platformSkillRevisionRef: string;
  promptVersion: string;
  catalogRevision: string;
  confirmedAt: string;
  confirmedBy: string;
}

export interface StoreWorkflowCaptureRepository {
  putSession(session: StoreWorkflowCaptureSession): Promise<StoreWorkflowCaptureSession>;
  updateSession(
    session: StoreWorkflowCaptureSession,
    expectedRevision: number,
  ): Promise<StoreWorkflowCaptureSession>;
  getSession(workspaceId: string, sessionId: string): Promise<StoreWorkflowCaptureSession | null>;
  putProposal(proposal: StoreWorkflowProposal): Promise<StoreWorkflowProposal>;
  getProposal(workspaceId: string, proposalRef: string): Promise<StoreWorkflowProposal | null>;
  rejectProposal(input: {
    workspaceId: string;
    proposalRef: string;
    rejectedAt: string;
    rejectedBy: string;
  }): Promise<StoreWorkflowProposal>;
  confirmProposal(input: {
    workspaceId: string;
    proposalRef: string;
    confirmedAt: string;
    confirmedBy: string;
  }): Promise<StoreWorkflowRecipe>;
  listRecipes(workspaceId: string): Promise<StoreWorkflowRecipe[]>;
  appendTrace(input: StoreWorkflowCaptureTrace): Promise<void>;
}

export interface StoreWorkflowCaptureTrace {
  eventId: string;
  workspaceId: string;
  taskId: string;
  dbosWorkflowId: string;
  eventType:
    | 'read_context'
    | 'ask_merchant'
    | 'proposed'
    | 'merchant_confirmed'
    | 'recorded'
    | 'rejected';
  axes: ObservabilityAxisBinding;
  occurredAt: string;
  payload: Record<string, unknown>;
}

type PayloadRow<T> = { payload: T };

export class PostgresStoreWorkflowCaptureRepository
  implements StoreWorkflowCaptureRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_store_workflow_capture_sessions (
        workspace_id text NOT NULL,
        session_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        status text NOT NULL CHECK (status IN ('awaiting_merchant', 'proposed', 'confirmed', 'rejected')),
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS p1_store_workflow_proposals (
        workspace_id text NOT NULL,
        proposal_ref text NOT NULL,
        session_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected')),
        payload jsonb NOT NULL,
        proposed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, proposal_ref)
      );
      CREATE TABLE IF NOT EXISTS p1_store_workflow_recipe_revisions (
        workspace_id text NOT NULL,
        recipe_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision = 1),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, recipe_id, revision)
      );
      CREATE TABLE IF NOT EXISTS p1_store_workflow_capture_events (
        workspace_id text NOT NULL,
        event_id text NOT NULL,
        task_id text NOT NULL,
        dbos_workflow_id text NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS p1_store_workflow_recipe_catalog_idx
        ON p1_store_workflow_recipe_revisions (workspace_id, created_at DESC, recipe_id);
      CREATE UNIQUE INDEX IF NOT EXISTS p1_store_workflow_recipe_proposal_idx
        ON p1_store_workflow_recipe_revisions (workspace_id, (payload->>'sourceProposalRef'));
      CREATE INDEX IF NOT EXISTS p1_store_workflow_capture_trace_idx
        ON p1_store_workflow_capture_events (workspace_id, task_id, occurred_at, event_id);
    `);
  }

  async putSession(session: StoreWorkflowCaptureSession) {
    const result = await this.pool.query<PayloadRow<StoreWorkflowCaptureSession>>(
      `INSERT INTO p1_store_workflow_capture_sessions
         (workspace_id, session_id, revision, status, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workspace_id, session_id) DO NOTHING
       RETURNING payload`,
      [session.workspaceId, session.sessionId, session.revision, session.status, JSON.stringify(session), session.updatedAt],
    );
    if (result.rows[0]) return structuredClone(result.rows[0].payload);
    const existing = await this.getSession(session.workspaceId, session.sessionId);
    if (existing && isDeepStrictEqual(existing, session)) return existing;
    throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Capture session already has different facts.');
  }

  async updateSession(session: StoreWorkflowCaptureSession, expectedRevision: number) {
    const result = await this.pool.query<PayloadRow<StoreWorkflowCaptureSession>>(
      `UPDATE p1_store_workflow_capture_sessions
          SET revision = $3, status = $4, payload = $5::jsonb, updated_at = $6::timestamptz
        WHERE workspace_id = $1 AND session_id = $2 AND revision = $7
        RETURNING payload`,
      [session.workspaceId, session.sessionId, session.revision, session.status, JSON.stringify(session), session.updatedAt, expectedRevision],
    );
    if (!result.rows[0]) throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Capture session head changed.');
    return structuredClone(result.rows[0].payload);
  }

  async getSession(workspaceId: string, sessionId: string) {
    return this.readOne<StoreWorkflowCaptureSession>(
      'p1_store_workflow_capture_sessions',
      'session_id',
      workspaceId,
      sessionId,
    );
  }

  async putProposal(proposal: StoreWorkflowProposal) {
    const result = await this.pool.query<PayloadRow<StoreWorkflowProposal>>(
      `INSERT INTO p1_store_workflow_proposals
         (workspace_id, proposal_ref, session_id, status, payload, proposed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workspace_id, proposal_ref) DO NOTHING
       RETURNING payload`,
      [proposal.workspaceId, proposal.proposalRef, proposal.sessionId, proposal.status, JSON.stringify(proposal), proposal.proposedAt],
    );
    if (result.rows[0]) return structuredClone(result.rows[0].payload);
    const existing = await this.getProposal(proposal.workspaceId, proposal.proposalRef);
    if (existing && isDeepStrictEqual(existing, proposal)) return existing;
    throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Store workflow proposal already has different facts.');
  }

  async getProposal(workspaceId: string, proposalRef: string) {
    return this.readOne<StoreWorkflowProposal>(
      'p1_store_workflow_proposals',
      'proposal_ref',
      workspaceId,
      proposalRef,
    );
  }

  async rejectProposal(input: {
    workspaceId: string;
    proposalRef: string;
    rejectedAt: string;
    rejectedBy: string;
  }) {
    const proposal = await this.getProposal(input.workspaceId, input.proposalRef);
    if (!proposal) throw new P1DomainError('NOT_FOUND', 'Store workflow proposal was not found.');
    if (proposal.status === 'confirmed') throw new P1DomainError('INVALID_STATE', 'A confirmed workflow cannot be rejected.');
    if (proposal.status === 'rejected') return proposal;
    const rejected = { ...proposal, status: 'rejected' as const };
    const result = await this.pool.query<PayloadRow<StoreWorkflowProposal>>(
      `UPDATE p1_store_workflow_proposals
          SET status = 'rejected', payload = $3::jsonb
        WHERE workspace_id = $1 AND proposal_ref = $2 AND status = 'proposed'
        RETURNING payload`,
      [input.workspaceId, input.proposalRef, JSON.stringify(rejected)],
    );
    if (!result.rows[0]) throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Store workflow proposal decision raced.');
    return structuredClone(result.rows[0].payload);
  }

  async confirmProposal(input: {
    workspaceId: string;
    proposalRef: string;
    confirmedAt: string;
    confirmedBy: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<PayloadRow<StoreWorkflowProposal>>(
        `SELECT payload FROM p1_store_workflow_proposals
          WHERE workspace_id = $1 AND proposal_ref = $2 FOR UPDATE`,
        [input.workspaceId, input.proposalRef],
      );
      const proposal = row.rows[0]?.payload;
      if (!proposal) throw new P1DomainError('NOT_FOUND', 'Store workflow proposal was not found.');
      if (proposal.status === 'rejected') throw new P1DomainError('INVALID_STATE', 'A rejected workflow cannot be confirmed.');
      const existing = await client.query<PayloadRow<StoreWorkflowRecipe>>(
        `SELECT payload FROM p1_store_workflow_recipe_revisions
          WHERE workspace_id = $1 AND payload->>'sourceProposalRef' = $2`,
        [input.workspaceId, input.proposalRef],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return structuredClone(existing.rows[0].payload);
      }
      const axes = observabilityAxisBindingSchema.parse(proposal.axes);
      const recipe: StoreWorkflowRecipe = {
        recipeId: `store-workflow.${digest([input.workspaceId, input.proposalRef])}`,
        revision: 1,
        workspaceId: input.workspaceId,
        title: proposal.title,
        fields: structuredClone(proposal.fields),
        sourceConversationId: proposal.sourceConversationId,
        sourceTurnId: proposal.sourceTurnId,
        messageRange: structuredClone(proposal.messageRange),
        sourceProposalRef: proposal.proposalRef,
        platformSkillRevisionRef: boundAxis(axes.skillRevision, 'skillRevision'),
        promptVersion: boundAxis(axes.promptVersion, 'promptVersion'),
        catalogRevision: boundAxis(axes.catalogRevision, 'catalogRevision'),
        confirmedAt: input.confirmedAt,
        confirmedBy: input.confirmedBy,
      };
      await client.query(
        `INSERT INTO p1_store_workflow_recipe_revisions
           (workspace_id, recipe_id, revision, payload, created_at)
         VALUES ($1, $2, 1, $3::jsonb, $4::timestamptz)`,
        [input.workspaceId, recipe.recipeId, JSON.stringify(recipe), input.confirmedAt],
      );
      await client.query(
        `UPDATE p1_store_workflow_proposals
            SET status = 'confirmed', payload = jsonb_set(payload, '{status}', '"confirmed"')
          WHERE workspace_id = $1 AND proposal_ref = $2`,
        [input.workspaceId, input.proposalRef],
      );
      for (const eventType of ['merchant_confirmed', 'recorded'] as const) {
        await insertTrace(client, {
          eventId: `${proposal.sessionId}:${eventType}`,
          workspaceId: input.workspaceId,
          taskId: proposal.taskId,
          dbosWorkflowId: proposal.dbosWorkflowId,
          eventType,
          axes,
          occurredAt: input.confirmedAt,
          payload: { proposalRef: proposal.proposalRef, recipeId: recipe.recipeId, confirmedBy: input.confirmedBy },
        });
      }
      await client.query('COMMIT');
      return structuredClone(recipe);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecipes(workspaceId: string) {
    const result = await this.pool.query<PayloadRow<StoreWorkflowRecipe>>(
      `SELECT payload FROM p1_store_workflow_recipe_revisions
        WHERE workspace_id = $1 ORDER BY created_at DESC, recipe_id`,
      [workspaceId],
    );
    return result.rows.map(({ payload }) => structuredClone(payload));
  }

  appendTrace(input: StoreWorkflowCaptureTrace) {
    return this.pool.connect().then(async (client) => {
      try {
        await insertTrace(client, input);
      } finally {
        client.release();
      }
    });
  }

  private async readOne<T>(table: string, idColumn: string, workspaceId: string, id: string) {
    const result = await this.pool.query<PayloadRow<T>>(
      `SELECT payload FROM ${table} WHERE workspace_id = $1 AND ${idColumn} = $2`,
      [workspaceId, id],
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }
}

export class StoreWorkflowRecordProposalPort implements RecordProposalPort {
  constructor(
    private readonly repository: StoreWorkflowCaptureRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async propose(input: Parameters<RecordProposalPort['propose']>[0]) {
    if (input.kind !== 'propose_store_workflow') {
      throw new Error(`Unsupported store-workflow proposal kind: ${input.kind}`);
    }
    const payload = z.object({
      sessionId: z.string().trim().min(1),
      title: z.string().trim().min(1),
      fields: captureFieldsSchema.refine(
        (fields) => captureFieldNames.every((field) => fields[field] !== null),
        'Store workflow proposal fields must be complete.',
      ),
      dbosWorkflowId: z.string().trim().min(1),
      axes: observabilityAxisBindingSchema,
    }).strict().parse(input.payload);
    const provenance = z.object({
      sourceConversationId: z.string().trim().min(1),
      sourceTurnId: z.string().trim().min(1),
      messageRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict(),
    }).strict().parse(input.provenance);
    const proposalRef = `store-workflow-proposal-${digest([input.workspaceId, input.idempotencyKey])}`;
    const existing = await this.repository.getProposal(input.workspaceId, proposalRef);
    if (existing) {
      if (
        existing.sessionId !== payload.sessionId ||
        existing.taskId !== input.execution.taskId ||
        existing.dbosWorkflowId !== payload.dbosWorkflowId ||
        existing.title !== payload.title ||
        !isDeepStrictEqual(existing.fields, payload.fields) ||
        existing.sourceConversationId !== provenance.sourceConversationId ||
        existing.sourceTurnId !== provenance.sourceTurnId ||
        !isDeepStrictEqual(existing.messageRange, provenance.messageRange) ||
        !isDeepStrictEqual(existing.axes, payload.axes)
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Store workflow proposal retry contains different facts.',
        );
      }
      await this.repository.appendTrace({
        eventId: `${payload.sessionId}:proposed`,
        workspaceId: input.workspaceId,
        taskId: input.execution.taskId,
        dbosWorkflowId: payload.dbosWorkflowId,
        eventType: 'proposed',
        axes: payload.axes,
        occurredAt: existing.proposedAt,
        payload: { proposalRef },
      });
      return { proposalRef, status: 'proposed' };
    }
    const proposal = await this.repository.putProposal({
      proposalRef,
      sessionId: payload.sessionId,
      workspaceId: input.workspaceId,
      taskId: input.execution.taskId,
      dbosWorkflowId: payload.dbosWorkflowId,
      title: payload.title,
      fields: payload.fields as Record<CaptureFieldName, CaptureFieldValue>,
      sourceConversationId: provenance.sourceConversationId,
      sourceTurnId: provenance.sourceTurnId,
      messageRange: provenance.messageRange,
      axes: payload.axes,
      status: 'proposed',
      proposedAt: this.now(),
    });
    await this.repository.appendTrace({
      eventId: `${payload.sessionId}:proposed`,
      workspaceId: input.workspaceId,
      taskId: input.execution.taskId,
      dbosWorkflowId: payload.dbosWorkflowId,
      eventType: 'proposed',
      axes: payload.axes,
      occurredAt: proposal.proposedAt,
      payload: { proposalRef },
    });
    return { proposalRef, status: 'proposed' };
  }
}

export class CompositeRecordProposalPort implements RecordProposalPort {
  constructor(
    private readonly preferences: RecordProposalPort,
    private readonly storeWorkflows: RecordProposalPort,
  ) {}

  propose(input: Parameters<RecordProposalPort['propose']>[0]) {
    return input.kind === 'propose_store_workflow'
      ? this.storeWorkflows.propose(input)
      : this.preferences.propose(input);
  }
}

export interface StoreWorkflowCapturePort {
  start(context: P1Context, input: Record<string, unknown>): Promise<unknown>;
  answer(context: P1Context, input: Record<string, unknown>): Promise<unknown>;
  confirm(context: P1Context, input: Record<string, unknown>): Promise<unknown>;
  reject(context: P1Context, input: Record<string, unknown>): Promise<unknown>;
  get(workspaceId: string, input: Record<string, unknown>): Promise<unknown>;
  catalog(workspaceId: string): Promise<unknown>;
}

export class StoreWorkflowCaptureService implements StoreWorkflowCapturePort {
  constructor(
    private readonly repository: StoreWorkflowCaptureRepository,
    private readonly primitives: AgentPrimitiveExecutionPort,
    private readonly skills: SkillRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async start(context: P1Context, raw: Record<string, unknown>) {
    requireMerchant(context);
    const input = z.object({
      sessionId: z.string().trim().min(1),
      taskId: z.string().trim().min(1),
      dbosWorkflowId: z.string().trim().min(1),
      workflowRevision: z.number().int().positive(),
      sourceConversationId: z.string().trim().min(1),
      catalogRevision: z.string().trim().min(1),
    }).strict().parse(raw);
    if (input.taskId !== input.dbosWorkflowId) {
      throw new P1DomainError('INVALID_STATE', 'Capture Task and DBOS workflow identity must match.');
    }
    const existing = await this.repository.getSession(context.workspaceId, input.sessionId);
    if (existing) {
      assertSameCapture(existing, input);
      return this.advanceAfterRead(context, existing);
    }
    const axes = await this.axes(input.catalogRevision);
    const readResult = await this.executePrimitive({
      context,
      input,
      axes,
      primitiveId: 'read_context',
      modelInput: {
        scope: 'conversation.current',
        query: { text: input.sourceConversationId, limit: 20 },
      },
      step: 'read-context',
    });
    const fields = fieldsFromContext(readResult);
    const missingFields = captureFieldNames.filter((field) => fields[field] === null);
    const timestamp = this.now();
    const session = await this.repository.putSession({
      ...input,
      workspaceId: context.workspaceId,
      status: 'awaiting_merchant',
      fields,
      missingFields,
      questionRef: null,
      proposalRef: null,
      axes,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.advanceAfterRead(context, session);
  }

  async answer(context: P1Context, raw: Record<string, unknown>) {
    requireMerchant(context);
    const input = z.object({
      sessionId: z.string().trim().min(1),
      items: z.array(z.object({
        field: z.enum(captureFieldNames),
        result: captureFieldValueSchema,
      }).strict()).min(1).max(4),
    }).strict().parse(raw);
    const session = await this.requiredSession(context.workspaceId, input.sessionId);
    if (session.status !== 'awaiting_merchant') {
      throw new P1DomainError('INVALID_STATE', 'Capture session is not waiting for merchant details.');
    }
    const byField = new Map(input.items.map((item) => [item.field, item.result]));
    for (const field of session.missingFields) {
      if (!byField.has(field)) throw new P1DomainError('INVALID_STATE', `Capture answer is missing ${field}.`);
    }
    const fields = structuredClone(session.fields);
    for (const field of session.missingFields) fields[field] = byField.get(field)!;
    const updated = await this.repository.updateSession({
      ...session,
      fields,
      missingFields: [],
      revision: session.revision + 1,
      updatedAt: this.now(),
    }, session.revision);
    return this.propose(context, updated);
  }

  async confirm(context: P1Context, raw: Record<string, unknown>) {
    requireMerchant(context);
    const input = z.object({ sessionId: z.string().trim().min(1) }).strict().parse(raw);
    const session = await this.requiredSession(context.workspaceId, input.sessionId);
    if (session.status === 'confirmed') {
      return this.repository.confirmProposal({
        workspaceId: context.workspaceId,
        proposalRef: session.proposalRef!,
        confirmedAt: session.updatedAt,
        confirmedBy: context.userId,
      });
    }
    if (session.status !== 'proposed' || !session.proposalRef) {
      throw new P1DomainError('INVALID_STATE', 'Only a proposed workflow can be confirmed.');
    }
    const confirmedAt = this.now();
    const recipe = await this.repository.confirmProposal({
      workspaceId: context.workspaceId,
      proposalRef: session.proposalRef,
      confirmedAt,
      confirmedBy: context.userId,
    });
    await this.repository.updateSession({
      ...session,
      status: 'confirmed',
      revision: session.revision + 1,
      updatedAt: confirmedAt,
    }, session.revision);
    return recipe;
  }

  async reject(context: P1Context, raw: Record<string, unknown>) {
    requireMerchant(context);
    const input = z.object({ sessionId: z.string().trim().min(1) }).strict().parse(raw);
    const session = await this.requiredSession(context.workspaceId, input.sessionId);
    if (session.status !== 'proposed' || !session.proposalRef) {
      throw new P1DomainError('INVALID_STATE', 'Only a proposed workflow can be rejected.');
    }
    const rejectedAt = this.now();
    await this.repository.rejectProposal({
      workspaceId: context.workspaceId,
      proposalRef: session.proposalRef,
      rejectedAt,
      rejectedBy: context.userId,
    });
    const rejected = await this.repository.updateSession({
      ...session,
      status: 'rejected',
      revision: session.revision + 1,
      updatedAt: rejectedAt,
    }, session.revision);
    await this.repository.appendTrace(trace(rejected, 'rejected', rejectedAt, { proposalRef: session.proposalRef }));
    return rejected;
  }

  get(workspaceId: string, raw: Record<string, unknown>) {
    const input = z.object({ sessionId: z.string().trim().min(1) }).strict().parse(raw);
    return this.requiredSession(workspaceId, input.sessionId);
  }

  async catalog(workspaceId: string) {
    return { items: await this.repository.listRecipes(workspaceId) };
  }

  private async advanceAfterRead(
    context: P1Context,
    session: StoreWorkflowCaptureSession,
  ) {
    await this.repository.appendTrace(
      trace(session, 'read_context', session.createdAt, {}),
    );
    if (session.status !== 'awaiting_merchant') return session;
    if (session.missingFields.length === 0) return this.propose(context, session);
    if (session.questionRef) {
      await this.repository.appendTrace(
        trace(session, 'ask_merchant', session.updatedAt, {
          questionRef: session.questionRef,
        }),
      );
      return session;
    }
    const question = captureQuestion(session, session.missingFields);
    const requested = await this.executePrimitive({
      context,
      input: session,
      axes: session.axes,
      primitiveId: 'ask_merchant',
      modelInput: {
        question: question.question,
        options: question.options.map(({ label }) => ({ label })),
      },
      step: 'ask-merchant',
      question,
    }) as { requestRef?: string };
    const questionRef = requested.requestRef?.trim() || null;
    if (!questionRef) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Capture question was not durably requested.',
      );
    }
    const updated = await this.repository.updateSession({
      ...session,
      questionRef,
      revision: session.revision + 1,
      updatedAt: this.now(),
    }, session.revision);
    await this.repository.appendTrace(
      trace(updated, 'ask_merchant', updated.updatedAt, { questionRef }),
    );
    return updated;
  }

  private async propose(context: P1Context, session: StoreWorkflowCaptureSession) {
    const result = await this.executePrimitive({
      context,
      input: session,
      axes: session.axes,
      primitiveId: 'record',
      modelInput: {
        kind: 'propose_store_workflow',
        payload: {
          sessionId: session.sessionId,
          title: '从当前对话记住的做法',
          fields: session.fields,
          dbosWorkflowId: session.dbosWorkflowId,
          axes: session.axes,
        },
        provenance: {
          sourceConversationId: session.sourceConversationId,
          sourceTurnId: session.taskId,
          messageRange: { start: 0, end: 0 },
        },
      },
      step: 'record-proposal',
    }) as { proposalRef?: string; status?: string };
    if (result.status !== 'proposed' || !result.proposalRef?.trim()) {
      throw new P1DomainError('INVALID_STATE', 'Capture record primitive did not return a proposal.');
    }
    return this.repository.updateSession({
      ...session,
      status: 'proposed',
      proposalRef: result.proposalRef.trim(),
      revision: session.revision + 1,
      updatedAt: this.now(),
    }, session.revision);
  }

  private executePrimitive(input: {
    context: P1Context;
    input: { sessionId: string; taskId: string; dbosWorkflowId: string; workflowRevision: number };
    axes: ObservabilityAxisBinding;
    primitiveId: string;
    modelInput: unknown;
    step: string;
    question?: QuestionCard;
  }) {
    return this.primitives.execute({
      primitiveId: input.primitiveId,
      modelInput: input.modelInput,
      serverContext: {
        actorId: 'capture-store-workflow',
        correlationId: input.context.correlationId,
        idempotencyKey: `${input.input.sessionId}:${input.step}`,
        observability: input.axes,
        taskId: input.input.taskId,
        workspaceId: input.context.workspaceId,
        ...(input.question
          ? { harness: { stage: 'intent_naming' as const, question: input.question } }
          : {}),
      },
    });
  }

  private async axes(catalogRevision: string) {
    const catalog = await this.skills.getCatalog(PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID);
    if (!catalog?.activeRevisionRef) throw new P1DomainError('INVALID_STATE', 'Capture store workflow platform Skill is not active.');
    const revision = await this.skills.getRevision(catalog.activeRevisionRef);
    if (!revision || revision.status !== 'accepted_frozen') throw new P1DomainError('INVALID_STATE', 'Capture store workflow platform Skill is not frozen.');
    return observabilityAxisBindingSchema.parse({
      axisScope: 'task_root',
      skillRevision: { kind: 'bound', value: revision.skillRevisionRef },
      promptVersion: { kind: 'bound', value: `${revision.prompt.name}@${revision.prompt.version}` },
      catalogRevision: { kind: 'bound', value: catalogRevision },
      scene: { kind: 'bound', value: 'capture-store-workflow' },
    });
  }

  private async requiredSession(workspaceId: string, sessionId: string) {
    const session = await this.repository.getSession(workspaceId, sessionId);
    if (!session) throw new P1DomainError('NOT_FOUND', 'Capture session was not found.');
    return session;
  }
}

function fieldsFromContext(input: unknown): CaptureFields {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? ((input as Record<string, unknown>).workflowCapture ?? input)
    : {};
  const record = source && typeof source === 'object' && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
  return captureFieldsSchema.parse(Object.fromEntries(
    captureFieldNames.map((field) => {
      const value = record[field];
      return [
        field,
        Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim())
          ? { state: 'answer', values: value.map((item) => String(item).trim()) }
          : null,
      ];
    }),
  ));
}

function captureQuestion(
  input: { sessionId: string; taskId: string; workflowRevision: number },
  missingFields: CaptureFieldName[],
): QuestionCard {
  const labels: Record<CaptureFieldName, string> = {
    tools: '所用工具',
    steps: '步骤顺序',
    corrections: '你做过的纠正',
    inputOutputFormats: '输入输出格式',
  };
  return {
    questionId: `${input.sessionId}:capture-details`,
    workflowId: input.taskId,
    workflowRevision: input.workflowRevision,
    question: `请一次补充：${missingFields.map((field) => labels[field]).join('、')}。`,
    options: [
      { id: 'deferred', label: '暂未确定' },
      { id: 'skipped', label: '整组跳过' },
    ],
    freeText: { enabled: true, placeholder: '一次写清缺少的内容' },
    response: { field: 'storeWorkflowCapture', reason: '补齐当前对话里没有出现的做法信息。' },
    unattended: 'hold',
    scope: 'workspace',
  };
}

function requireMerchant(context: P1Context) {
  if (context.actor !== 'owner' && context.actor !== 'operator') {
    throw new P1DomainError('FORBIDDEN', 'Store workflow confirmation requires an authenticated merchant.');
  }
}

function assertSameCapture(
  session: StoreWorkflowCaptureSession,
  input: {
    taskId: string;
    dbosWorkflowId: string;
    workflowRevision: number;
    sourceConversationId: string;
    catalogRevision: string;
  },
) {
  if (
    session.taskId !== input.taskId ||
    session.dbosWorkflowId !== input.dbosWorkflowId ||
    session.workflowRevision !== input.workflowRevision ||
    session.sourceConversationId !== input.sourceConversationId ||
    boundAxis(session.axes.catalogRevision, 'catalogRevision') !==
      input.catalogRevision
  ) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Capture session already belongs to different workflow facts.',
    );
  }
}

function trace(
  session: StoreWorkflowCaptureSession,
  eventType: StoreWorkflowCaptureTrace['eventType'],
  occurredAt: string,
  payload: Record<string, unknown>,
): StoreWorkflowCaptureTrace {
  return {
    eventId: `${session.sessionId}:${eventType}`,
    workspaceId: session.workspaceId,
    taskId: session.taskId,
    dbosWorkflowId: session.dbosWorkflowId,
    eventType,
    axes: session.axes,
    occurredAt,
    payload,
  };
}

function boundAxis(
  axis: { kind: 'bound'; value: string } | { kind: 'absent' },
  label: string,
) {
  if (axis.kind !== 'bound') throw new P1DomainError('INVALID_STATE', `Capture ${label} axis is absent.`);
  return axis.value;
}

function digest(values: string[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
}

async function insertTrace(client: PoolClient, input: StoreWorkflowCaptureTrace) {
  const stored = { ...input, axes: observabilityAxisBindingSchema.parse(input.axes) };
  const result = await client.query(
    `INSERT INTO p1_store_workflow_capture_events
       (workspace_id, event_id, task_id, dbos_workflow_id, event_type, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
     ON CONFLICT (workspace_id, event_id) DO NOTHING`,
    [stored.workspaceId, stored.eventId, stored.taskId, stored.dbosWorkflowId, stored.eventType, JSON.stringify(stored), stored.occurredAt],
  );
  if ((result.rowCount ?? 0) > 0) return;
  const existing = await client.query<PayloadRow<StoreWorkflowCaptureTrace>>(
    `SELECT payload FROM p1_store_workflow_capture_events WHERE workspace_id = $1 AND event_id = $2`,
    [stored.workspaceId, stored.eventId],
  );
  if (!isDeepStrictEqual(existing.rows[0]?.payload, stored)) {
    throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Capture trace already has different facts.');
  }
}
