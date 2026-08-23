/**
 * Agent-session P1 module (V31-05 / V31-16):
 * Thread list + Workbench session restore + steering_submit.
 *
 * open_legacy / create_thread / steering_submit are the write commands.
 * list_threads / get_workbench_session / get_thread / list_steering_commands /
 * steering_gate are queries.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  AgentSessionError,
  type AgentSessionStore,
} from './agent-session-store.js';
import type { ThreadWorkAuthorityReader } from './thread-work-authority.js';
import {
  listWorkbenchThreads,
  resolveWorkbenchSession,
} from './workbench-session.js';
import {
  SteeringService,
  SteeringServiceError,
} from './steering-service.js';

function actionName(input: Record<string, unknown>): string {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'An agent-session action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>): Record<string, unknown> {
  const value = input.payload;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'An agent-session payload is required.',
    );
  }
  return value as Record<string, unknown>;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError(
      'INVALID_STATE',
      parsed.error.message,
    );
  }
  return parsed.data;
}

function resourceIdOf(context: P1Context): string {
  return context.workspaceId;
}

function mapSessionError(error: unknown): never {
  if (error instanceof SteeringServiceError) {
    if (error.code === 'NOT_FOUND') {
      throw new P1DomainError('NOT_FOUND', error.message);
    }
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
    }
    throw new P1DomainError('INVALID_STATE', error.message);
  }
  if (error instanceof AgentSessionError) {
    if (error.code === 'AGENT_THREAD_NOT_FOUND') {
      throw new P1DomainError('NOT_FOUND', error.message);
    }
    if (
      error.code === 'AGENT_THREAD_ID_TAKEN' ||
      error.code === 'AGENT_SESSION_REVISION_CONFLICT' ||
      error.code === 'AGENT_ACTIVE_TURN_CONFLICT' ||
      error.code === 'AGENT_RUN_STATE_CONFLICT'
    ) {
      throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
    }
    throw new P1DomainError('INVALID_STATE', error.message);
  }
  throw error;
}

const listThreadsPayloadSchema = z
  .object({
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const getWorkbenchSessionPayloadSchema = z
  .object({
    threadId: z.string().trim().min(1).optional(),
  })
  .strict();

const getThreadPayloadSchema = z
  .object({
    threadId: z.string().trim().min(1),
  })
  .strict();

const openLegacyPayloadSchema = z
  .object({
    legacyWorkId: z.string().trim().min(1),
    threadId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    now: z.iso.datetime().optional(),
  })
  .strict();

const createThreadPayloadSchema = z
  .object({
    threadId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(500),
    now: z.iso.datetime().optional(),
  })
  .strict();

const unitProgressSchema = z
  .object({
    unitId: z.string().trim().min(1),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    label: z.string().trim().min(1).max(200).optional(),
    pageIndex: z.number().int().nonnegative().max(50).optional(),
  })
  .strict();

/** V31-16 P1 action steering_submit (V3.1 §21.3). */
const steeringSubmitPayloadSchema = z
  .object({
    commandId: z.string().trim().min(1).max(200).optional(),
    threadId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    instruction: z.string().trim().min(1).max(4_000),
    queueModeHint: z.enum(['steer', 'follow_up']).optional(),
    createdAt: z.iso.datetime().optional(),
    // Compatibility-only fields for already-open browser tabs. They are parsed
    // then ignored: execution scope, progress, plan revision and billing facts
    // are projected from the admitted server task below.
    workId: z.string().trim().min(1).optional(),
    sourcePlanRevision: z.number().int().positive().optional(),
    sourceContentVersionIds: z.array(z.string().trim().min(1)).max(50).optional(),
    snapshotHash: z.string().trim().min(1).max(128).optional(),
    units: z.array(unitProgressSchema).max(100).default([]),
    applyImmediately: z.boolean().optional(),
    signals: z
      .object({
        affectedUnitIds: z.array(z.string().trim().min(1)).max(100).optional(),
        changesQuantity: z.boolean().optional(),
        changesPlatform: z.boolean().optional(),
        changesModel: z.boolean().optional(),
        changesCost: z.boolean().optional(),
        changesFacts: z.boolean().optional(),
        conflictReason: z.string().trim().min(1).max(2_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const listSteeringPayloadSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .strict();

export class AgentSessionFoundationModule implements P1OperationModule {
  readonly name = 'agent-session';

  constructor(
    private readonly store: AgentSessionStore,
    /**
     * V31-105 §2: Thread → its Works, read from the submission's own
     * `agentBinding` rather than a `durability = 'sync'` run nothing writes.
     * Required, so a caller cannot silently reinstate the empty projection.
     */
    private readonly workAuthority: ThreadWorkAuthorityReader,
    /** V31-16 Make Steering — optional so read-only session surfaces stay thin. */
    private readonly steering?: SteeringService,
  ) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<unknown> {
    const action = actionName(args.input);
    const value = payload(args.input);
    const resourceId = resourceIdOf(args.context);

    try {
      switch (action) {
        case 'open_legacy_work_thread': {
          const input = parse(openLegacyPayloadSchema, value);
          const now = input.now ?? new Date().toISOString();
          const threadId =
            input.threadId ?? `legacy-work:${input.legacyWorkId}`;
          const title = input.title ?? `历史作品 ${input.legacyWorkId}`;
          const opened = await this.store.openLegacyWorkThread({
            resourceId,
            legacyWorkId: input.legacyWorkId,
            threadId,
            title,
            now,
          });
          return {
            thread: opened.thread,
            created: opened.created,
            session: {
              resourceId: opened.thread.resourceId,
              threadId: opened.thread.threadId,
              sessionRevision: opened.thread.sessionRevision,
              title: opened.thread.title,
            },
          };
        }
        case 'create_thread': {
          const input = parse(createThreadPayloadSchema, value);
          const now = input.now ?? new Date().toISOString();
          const threadId = input.threadId ?? `thread:${randomUUID()}`;
          const thread = await this.store.createThread({
            resourceId,
            threadId,
            title: input.title,
            now,
          });
          return {
            thread,
            session: {
              resourceId: thread.resourceId,
              threadId: thread.threadId,
              sessionRevision: thread.sessionRevision,
              title: thread.title,
            },
          };
        }
        case 'steering_submit': {
          if (!this.steering) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Steering service is not assembled on agent-session (V31-16).',
            );
          }
          const input = parse(steeringSubmitPayloadSchema, value);
          const result = await this.steering.submitAuthoritative({
            commandId: input.commandId ?? args.idempotencyKey,
            workspaceId: resourceId,
            threadId: input.threadId,
            taskId: input.taskId,
            actorId: args.context.userId,
            instruction: input.instruction,
            queueModeHint: input.queueModeHint,
            createdAt: input.createdAt,
          });
          return {
            command: result.command,
            classification: result.classification,
            queueMode: result.queueMode,
            applicationStatus: result.applicationStatus,
            impactSummary: result.impactSummary,
            preservedUnitIds: result.preservedUnitIds,
            affectedUnitIds: result.affectedUnitIds,
            // Scope + credits are Core's projection; the browser renders it.
            impact: result.impact,
            nextAction: result.nextAction,
            replayed: result.replayed,
          };
        }
        default:
          throw new P1DomainError(
            'INVALID_STATE',
            `Unknown agent-session command ${action}.`,
          );
      }
    } catch (error) {
      mapSessionError(error);
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = actionName(args.input);
    const value = payload(args.input);
    const resourceId = resourceIdOf(args.context);

    try {
      switch (action) {
        case 'list_threads': {
          const input = parse(listThreadsPayloadSchema, value);
          const threads = await listWorkbenchThreads(this.store, {
            resourceId,
            limit: input.limit,
          });
          return { threads };
        }
        case 'get_workbench_session': {
          const input = parse(getWorkbenchSessionPayloadSchema, value);
          const resolved = await resolveWorkbenchSession(this.store, {
            resourceId,
            explicitThreadId: input.threadId ?? null,
            workAuthority: this.workAuthority,
          });
          // Explicit miss is a not-found, not silent Idle.
          if (input.threadId && !resolved.session) {
            throw new P1DomainError(
              'NOT_FOUND',
              `Agent thread ${input.threadId} does not exist for this workspace.`,
            );
          }
          return resolved;
        }
        case 'get_thread': {
          const input = parse(getThreadPayloadSchema, value);
          const thread = await this.store.getThread({
            resourceId,
            threadId: input.threadId,
          });
          if (!thread) {
            throw new P1DomainError(
              'NOT_FOUND',
              `Agent thread ${input.threadId} does not exist for this workspace.`,
            );
          }
          return { thread };
        }
        case 'steering_gate': {
          if (!this.steering) {
            return { enabled: false, reason: 'feature_flag_off' };
          }
          return this.steering.gate();
        }
        case 'list_steering_commands': {
          if (!this.steering) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Steering service is not assembled on agent-session (V31-16).',
            );
          }
          const input = parse(listSteeringPayloadSchema, value);
          const commands = await this.steering.listByTask({
            workspaceId: resourceId,
            taskId: input.taskId,
          });
          return { commands };
        }
        default:
          throw new P1DomainError(
            'INVALID_STATE',
            `Unknown agent-session query ${action}.`,
          );
      }
    } catch (error) {
      mapSessionError(error);
    }
  }
}
