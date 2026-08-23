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
 * The command binds to a thread, and only one thread can carry it: the
 * submission's own `agentBinding.threadId`, which Core reads back in
 * `STEERING_AUTHORITY_BINDING_SQL` (`apps/core/src/assembly/core-assembly.ts`).
 *
 * There used to be a `resolveSteeringThreadId` here that stood in a Workbench
 * thread, or opened a `legacy-work:<id>` one, whenever the run's own thread was
 * unknown. Neither is the bound thread, so every steer sent that way came back
 * 409 — the merchant read a refusal about her sentence for a binding she cannot
 * see (V31-105 §3). A run whose thread the browser does not hold is simply not
 * steerable, and `isSteeringEntryVisible` says so by not offering the entry.
 */
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
