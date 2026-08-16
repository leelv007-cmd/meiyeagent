import assert from 'node:assert/strict';
import test from 'node:test';
import type { P1Context } from '../foundation/domain.js';
import { ModelSupplyControlPlaneService } from './foundation-module.js';

/**
 * D-170 retired advanced-canvas generation, and until now nothing checked it.
 * `quoteCanvasGeneration` and `submitCanvasGeneration` each threw
 * COMMANDS_FROZEN with a comment saying so; `retryCanvasGeneration`, sitting
 * directly below them, kept a full body that built a fresh submission and
 * dispatched it. Two frozen verbs and one open one is what an enforcement made
 * of remembering looks like, so the test covers all three together rather than
 * the one that was found.
 */
const context = {
  correlationId: 'corr-1',
  userId: 'user-1',
  workspaceId: 'workspace-1'
} as P1Context;

/**
 * Built off the prototype on purpose. A STOP-WRITE has to refuse before it
 * reaches any dependency, so a service with no dependencies at all is the
 * sharpest thing to run it against: if any verb touched a repository, a clock,
 * or the application service first, this would throw the wrong error.
 */
const controlPlane = Object.create(
  ModelSupplyControlPlaneService.prototype
) as ModelSupplyControlPlaneService;

const frozen = { code: 'COMMANDS_FROZEN' };

test('advanced-canvas quote is frozen', async () => {
  await assert.rejects(
    controlPlane.quoteCanvasGeneration(context, {} as never, 'idem-1'),
    frozen
  );
});

test('advanced-canvas submit is frozen', async () => {
  await assert.rejects(
    controlPlane.submitCanvasGeneration(
      context,
      {} as never,
      'quote-1',
      'idem-1'
    ),
    frozen
  );
});

test('advanced-canvas retry is frozen', async () => {
  await assert.rejects(
    controlPlane.retryCanvasGeneration(
      context,
      'project-1',
      'job-1',
      'idem-1'
    ),
    frozen
  );
});
