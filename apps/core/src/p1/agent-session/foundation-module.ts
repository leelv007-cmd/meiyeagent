/**
 * Agent-session P1 module (V31-05): Thread list + Workbench session restore.
 *
 * Consumes AgentSessionStore only. Merchant-facing queries; open_legacy is the
 * sole write command on this surface (lazy legacy Thread, V3.1 §33.2).
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  AgentSessionError,
  type AgentSessionStore,
} from './agent-session-store.js';
import {
  listWorkbenchThreads,
  resolveWorkbenchSession,
} from './workbench-session.js';

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
  if (error instanceof AgentSessionError) {
    if (error.code === 'AGENT_THREAD_NOT_FOUND') {
      throw new P1DomainError('NOT_FOUND', error.message);
    }
    if (
      error.code === 'AGENT_THREAD_ID_TAKEN' ||
      error.code === 'AGENT_SESSION_REVISION_CONFLICT' ||
      error.code === 'AGENT_ACTIVE_TURN_CONFLICT' ||
      error.code === 'AGENT_RUN_LINK_CONFLICT' ||
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

export class AgentSessionFoundationModule implements P1OperationModule {
  readonly name = 'agent-session';

  constructor(private readonly store: AgentSessionStore) {}

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
