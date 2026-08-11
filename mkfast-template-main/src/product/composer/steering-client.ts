/**
 * Mid-run steering transports (V31-27) — `agent-session` P1 seam only.
 *
 * steering_submit is the sole classifier of a mid-run instruction, and
 * list_steering_commands is the sole history: both live on Core (V31-16), so a
 * reload or a restored session reads the same commands the Make queue does.
 */

import { commandP1, queryP1 } from '@/p1/client';

import type {
  SteeringGate,
  SteeringSubmitResult,
  StoredSteeringCommandView,
} from './steering-composer';

export async function resolveSteeringGate(
  signal?: AbortSignal
): Promise<SteeringGate> {
  return queryP1<SteeringGate>(
    'agent-session',
    { action: 'steering_gate', payload: {} },
    signal
  );
}

export async function listSteeringCommands(
  taskId: string,
  signal?: AbortSignal
): Promise<StoredSteeringCommandView[]> {
  const result = await queryP1<{ commands?: StoredSteeringCommandView[] }>(
    'agent-session',
    { action: 'list_steering_commands', payload: { taskId } },
    signal
  );
  return result.commands ?? [];
}

/**
 * The command binds to a thread. A Composer run started from 段① has no
 * Workbench thread yet, so open the work's own thread first — `legacy-work:<id>`
 * is Core's naming and the call is idempotent, which keeps the steering command
 * pointed at a thread that exists instead of at a string we made up.
 */
export async function resolveSteeringThreadId(input: {
  workbenchThreadId: string | null;
  workId: string;
}): Promise<string> {
  if (input.workbenchThreadId) return input.workbenchThreadId;
  const opened = await commandP1<{ thread: { threadId: string } }>(
    'agent-session',
    {
      action: 'open_legacy_work_thread',
      payload: { legacyWorkId: input.workId },
    },
    `steering-thread:${input.workId}`
  );
  return opened.thread.threadId;
}

export async function submitSteering(input: {
  threadId: string;
  taskId: string;
  instruction: string;
  /** Becomes the append-only commandId; a retry of the same ask replays. */
  commandId: string;
}): Promise<SteeringSubmitResult> {
  return commandP1<SteeringSubmitResult>(
    'agent-session',
    {
      action: 'steering_submit',
      payload: {
        commandId: input.commandId,
        threadId: input.threadId,
        taskId: input.taskId,
        instruction: input.instruction,
      },
    },
    input.commandId
  );
}
