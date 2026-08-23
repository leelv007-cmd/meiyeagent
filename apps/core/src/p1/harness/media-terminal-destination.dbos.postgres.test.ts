import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';

import { sendHarnessMediaJobTerminal } from './dbos-workflow.js';
import { harnessMediaJobTopic } from './workflow-core.js';
import { harnessRuntimeId } from './workspace-scope.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;

/**
 * V31-105 §13. Every other Harness DBOS send resolves its destination through
 * the admission's recorded runtime id (`HarnessRuntimeIdResolver`:
 * dbos-workflow.ts resumeHarnessDbosWorkflow / resumeHarnessDbosInteraction-
 * Workflow / abandonReleasedHarnessReservation / createHarnessInterruptResume-
 * Bridge). The media terminal signal was the one exception: it derived the
 * destination from `payload.submission.correlationId` alone, so a run whose
 * workflow is registered under a different runtime id than that correlation
 * spells received nothing back from pg-boss — the merchant's delivery card
 * never appears while the media job burns its retries and dead-letters with
 * `Sent to non-existent destination workflow UUID`.
 */
test(
  'the media terminal signal reaches the workflow the admission registered, not the correlation id',
  {
    skip: systemDatabaseUrl
      ? false
      : 'TEST_DBOS_SYSTEM_DATABASE_URL is required',
  },
  async () => {
    if (!systemDatabaseUrl) {
      throw new Error('The DBOS system database is required.');
    }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const workspaceId = `workspace_v31105_${suffix}`;
    // What the frozen media submission carries.
    const correlationId = `composer-task:${suffix}`;
    // What admission actually registered (a prepared attempt / successor).
    const registeredLogicalId = `${correlationId}:plan-r2`;
    const registeredRuntimeId = harnessRuntimeId(
      workspaceId,
      registeredLogicalId,
    );
    const jobId = `model-${suffix}`;
    let dbosLaunched = false;

    try {
      const workflow = DBOS.registerWorkflow(
        async () =>
          DBOS.recv<{ jobId: string; status: string }>(
            harnessMediaJobTopic(jobId),
            30,
          ),
        { name: `v31105MediaTerminal_${suffix}` },
      );
      DBOS.setConfig({
        name: `meiye-v31105-${suffix}`,
        runAdminServer: false,
        systemDatabaseUrl,
        applicationVersion: `v31105-media-terminal-${suffix}`,
      });
      await DBOS.launch();
      dbosLaunched = true;
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: registeredRuntimeId,
      })();

      const delivered = await sendHarnessMediaJobTerminal(
        {
          workspaceId,
          jobId,
          kind: 'model.media-generation',
          payload: {
            submission: { correlationId, workspaceId },
          },
          status: 'completed',
          output: { result: { status: 'completed' } },
        },
        {
          async workflowRuntimeId(scope, logicalId) {
            assert.equal(scope, workspaceId);
            assert.equal(logicalId, correlationId);
            return registeredRuntimeId;
          },
        },
      );

      assert.equal(delivered, true);
      assert.deepEqual(await handle.getResult(), {
        jobId,
        status: 'completed',
        output: { result: { status: 'completed' } },
      });
    } finally {
      if (dbosLaunched) {
        await DBOS.shutdown({ deregister: true }).catch(() => undefined);
      }
    }
  },
);
