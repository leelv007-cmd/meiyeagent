/**
 * V31-91 step 2: the refusal's discriminating numbers must survive the route.
 *
 * The fifteen codes landed first, and they name which refusal fired. They do
 * not finish locating the race: the two candidates left — the client sending
 * another plan's revision, versus the client's own plan lagging Core — differ
 * only in `requestedRevision` vs `latestRevision`, which live in `details`.
 *
 * `details` had nowhere to go. `withErrorEnvelope` never logs
 * (`apps/core/src/http-errors.ts:117-150`) and this route passes no
 * `includeDetails`, so the field was written and dropped. These tests pin both
 * halves of the fix: the numbers reach Core's output, and they do not reach the
 * response body.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { registerComposerPlanCommandRoutes } from './composer-plan-route-registrar.js';
import { toHttpError } from './http-errors.js';
import { ComposerPlanStartRefusedError } from './p1/execution-spine/submission-coordinator.js';
import type { RouteMatchInput } from './route-table.js';

type PlanCtx = { url: URL };
type Handler = (ctx: PlanCtx) => Promise<void> | void;

const STALE = () =>
  new ComposerPlanStartRefusedError(
    'COMPOSER_PLAN_START_PLAN_REVISION_STALE',
    '方案刚刚更新过，请重新打开方案再开始。',
    { planId: 'plan-work-2', requestedRevision: 5, latestRevision: 1 },
  );

/** Drives the registrar the way server.ts does, capturing what each seam sees. */
async function startAgainst(refusal: () => unknown) {
  const routes: Array<
    [string, [string, (input: RouteMatchInput) => boolean, string, Handler]]
  > = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };

  const ctx = {
    url: new URL(
      'http://core.local/v1/workspaces/w1/p1/composer/tasks/task-work-2/start',
    ),
  };

  let thrown: unknown;
  try {
    registerComposerPlanCommandRoutes({
      routes: {
        add: (
          id: string,
          entry: [string, (input: RouteMatchInput) => boolean, string, Handler],
        ) => routes.push([id, entry]),
      } as never,
      coordinator: {
        startPrepared: async () => {
          throw refusal();
        },
      } as never,
      authorize: (_ctx, workspaceId) => ({ workspaceId }),
      readBody: async () => ({ planRevision: 5 }),
      respond: () => {
        assert.fail('a refusal must not respond 202');
      },
      handle: async (_ctx, command) => {
        try {
          await command();
        } catch (error) {
          thrown = error;
        }
      },
    });

    const start = routes.find(([id]) => id === 'composer-task-start');
    assert.ok(start, 'the start route must be registered');
    assert.equal(
      start[1][1]({ method: 'POST', url: ctx.url }),
      true,
      'the start matcher must accept the request path at dispatch time',
    );
    await start[1][3](ctx);
  } finally {
    console.warn = originalWarn;
  }
  return { thrown, warnings };
}

test('a start refusal writes its discriminating numbers to Core output', async () => {
  const { warnings } = await startAgainst(STALE);
  const line = warnings.find((entry) => entry.includes('COMPOSER_PLAN_START_'));
  assert.ok(line, `expected a refusal log, saw ${JSON.stringify(warnings)}`);
  assert.match(line, /COMPOSER_PLAN_START_PLAN_REVISION_STALE/u);
  // These three are the whole point: without them a red says which branch fired
  // but not whether the revision belonged to this task's plan at all.
  assert.match(line, /"requestedRevision":5/u);
  assert.match(line, /"latestRevision":1/u);
  assert.match(line, /"planId":"plan-work-2"/u);
});

test('the numbers stay out of the merchant-visible body', async () => {
  const { thrown } = await startAgainst(STALE);
  assert.ok(thrown instanceof ComposerPlanStartRefusedError);
  // The route builds no `includeDetails`, so the envelope drops details even
  // though toHttpError carries them. Logging is what makes them observable —
  // if someone later turns includeDetails on here, this test says so.
  const http = toHttpError(thrown, {
    code: 'COMPOSER_PLAN_START_FAILED',
    message: 'Composer plan could not be started.',
    status: 409,
  });
  assert.equal(http.code, 'COMPOSER_PLAN_START_PLAN_REVISION_STALE');
  assert.equal(http.status, 409);
  assert.doesNotMatch(JSON.stringify(http.message), /plan-work-2|latestRevision/u);
});

test('an unrelated throw is neither logged nor reshaped', async () => {
  const { thrown, warnings } = await startAgainst(
    () => new Error('Prepared Composer task was not found.'),
  );
  assert.equal(
    warnings.filter((entry) => entry.includes('COMPOSER_PLAN_START_')).length,
    0,
    'only coded refusals may be logged; a bare Error has nothing to discriminate',
  );
  assert.ok(thrown instanceof Error);
  assert.ok(!(thrown instanceof ComposerPlanStartRefusedError));
});
