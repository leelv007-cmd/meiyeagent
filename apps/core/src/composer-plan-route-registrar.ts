import { z } from 'zod';

import { ComposerPlanStartRefusedError } from './p1/execution-spine/submission-coordinator.js';
import type { CreationSubmissionCoordinator } from './p1/execution-spine/submission-coordinator.js';
import type { RouteTable } from './route-table.js';

export type ComposerPlanTaskRoute = { workspaceId: string; taskId: string };

type ComposerPlanCoordinator = Pick<
  CreationSubmissionCoordinator,
  'answerClarification' | 'revisePrepared' | 'startPrepared' | 'cancelRunning'
>;

type CommandErrorFallback = {
  code: string;
  message: string;
  status: number;
};

export function registerComposerPlanCommandRoutes(input: {
  routes: RouteTable;
  pathname: string;
  coordinator?: Partial<ComposerPlanCoordinator>;
  authorize(workspaceId: string): { workspaceId: string };
  readBody(): Promise<unknown>;
  respond(status: number, payload: unknown): void;
  handle(
    command: () => Promise<void>,
    fallback: CommandErrorFallback,
  ): Promise<void>;
}): void {
  registerCommand(input, 'cancel', 'composer-task-cancel', async (route) => {
    const context = input.authorize(route.workspaceId);
    const result = await input.coordinator!.cancelRunning!({
      workspaceId: context.workspaceId,
      taskId: route.taskId,
    });
    input.respond(200, result);
  });
  registerCommand(input, 'start', 'composer-task-start', async (route) => {
    const context = input.authorize(route.workspaceId);
    const body = startBodySchema.parse(await input.readBody());
    const result = await input.coordinator!.startPrepared!({
      workspaceId: context.workspaceId,
      taskId: route.taskId,
      planRevision: body.planRevision,
    });
    input.respond(202, result);
  });
  registerCommand(input, 'revise', 'composer-task-revise', async (route) => {
    const context = input.authorize(route.workspaceId);
    const body = reviseBodySchema.parse(await input.readBody());
    const result = await input.coordinator!.revisePrepared!({
      workspaceId: context.workspaceId,
      taskId: route.taskId,
      planRevision: body.planRevision,
      merchantInstruction: body.merchantInstruction,
    });
    input.respond(200, result);
  });
  registerCommand(input, 'answer', 'composer-task-answer', async (route) => {
    const context = input.authorize(route.workspaceId);
    const body = answerBodySchema.parse(await input.readBody());
    const result = await input.coordinator!.answerClarification!({
      workspaceId: context.workspaceId,
      taskId: route.taskId,
      merchantAnswer: body.merchantAnswer,
    });
    input.respond(200, result);
  });
}

function registerCommand(
  input: Parameters<typeof registerComposerPlanCommandRoutes>[0],
  command: 'answer' | 'cancel' | 'revise' | 'start',
  routeId:
    | 'composer-task-answer'
    | 'composer-task-cancel'
    | 'composer-task-revise'
    | 'composer-task-start',
  execute: (route: ComposerPlanTaskRoute) => Promise<void>,
): void {
  const route = taskRoute(input.pathname, command);
  const available = Boolean(input.coordinator?.[commandMethod(command)]);
  input.routes.add(routeId, [
    'POST',
    () => available && Boolean(route),
    'service-token',
    () =>
      input.handle(() => executeLoggingRefusals(command, () => execute(route!)), {
        code: `COMPOSER_PLAN_${command.toUpperCase()}_FAILED`,
        message:
          command === 'answer'
            ? 'Composer plan clarification could not be continued.'
            : command === 'revise'
              ? 'Composer plan could not be revised.'
              : command === 'cancel'
                ? 'Running Composer work could not be cancelled.'
              : 'Composer plan could not be started.',
        status: 409,
      }),
  ]);
}

/**
 * V31-91 step 2: make the refusal's `details` observable without shipping them.
 *
 * The codes landed in d95aef263, so a red now names which of the fifteen
 * refusals fired. That is not enough to finish locating the race: the two
 * remaining candidates — the client sending *another plan's* revision, versus
 * the client's own plan being behind Core — are told apart only by the numbers,
 * which live in `details`.
 *
 * Those numbers had nowhere to go. `withErrorEnvelope` does not log
 * (`http-errors.ts:117-150`) and this route does not pass `includeDetails`, so
 * `details` was written and then dropped. Logging here rather than emitting it
 * keeps `planId` / run ids out of a merchant-visible body while still putting
 * them in the journey job's captured Core output.
 */
async function executeLoggingRefusals(
  command: 'answer' | 'cancel' | 'revise' | 'start',
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ComposerPlanStartRefusedError) {
      console.warn(
        `Composer plan ${command} refused: ${error.code}`,
        JSON.stringify(error.details ?? {}),
      );
    }
    throw error;
  }
}

function commandMethod(command: 'answer' | 'cancel' | 'revise' | 'start') {
  if (command === 'answer') return 'answerClarification' as const;
  if (command === 'revise') return 'revisePrepared' as const;
  if (command === 'cancel') return 'cancelRunning' as const;
  return 'startPrepared' as const;
}

const startBodySchema = z.object({ planRevision: z.number().int().positive() }).strict();
const reviseBodySchema = z
  .object({
    planRevision: z.number().int().positive(),
    merchantInstruction: z.string().trim().min(1).max(4_000),
  })
  .strict();
const answerBodySchema = z
  .object({ merchantAnswer: z.string().trim().min(1).max(4_000) })
  .strict();

function taskRoute(
  pathname: string,
  command: 'answer' | 'cancel' | 'revise' | 'start',
): ComposerPlanTaskRoute | null {
  const match = pathname.match(
    new RegExp(
      `^/v1/workspaces/([^/]+)/p1/composer/tasks/([^/]+)/${command}$`,
      'u',
    ),
  );
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      workspaceId: decodeURIComponent(match[1]),
      taskId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}
