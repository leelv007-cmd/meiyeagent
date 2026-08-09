import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';

import {
  createMakeRestartWorkflow,
  MAKE_RESTART_APP_NAME,
  makeRestartRequest,
  migrateMakeRestartReceipt,
} from './dbos-make-restart.fixture.js';
import { harnessRuntimeId } from './workspace-scope.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const workflowId = process.env.V31_MAKE_RESTART_WORKFLOW_ID;
const workspaceId = process.env.V31_MAKE_RESTART_WORKSPACE_ID;
const applicationVersion = process.env.V31_MAKE_RESTART_APP_VERSION;
if (
  !systemDatabaseUrl ||
  !databaseUrl ||
  !workflowId ||
  !workspaceId ||
  !applicationVersion
) {
  throw new Error('V31 Make restart fixture requires DBOS and application configuration.');
}

const pool = new Pool({ connectionString: databaseUrl });
await migrateMakeRestartReceipt(pool);
DBOS.setConfig({
  name: MAKE_RESTART_APP_NAME,
  systemDatabaseUrl,
  applicationVersion,
});
const workflow = createMakeRestartWorkflow({
  crashAfterDeliveryCommit: true,
  pool,
  workflowId,
  workspaceId,
});
await DBOS.launch();
await DBOS.startWorkflow(workflow, {
  workflowID: harnessRuntimeId(workspaceId, workflowId),
})(makeRestartRequest(workflowId, workspaceId));
await new Promise(() => {});
