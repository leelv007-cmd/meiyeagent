import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';

import {
  createMediaAdmissionWorkflow,
  mediaAdmissionRequest,
} from './dbos-media-admission-fixture.js';
import { PostgresNoteMediaAdmissionCoordinator } from './note-media-admission.js';
import { harnessRuntimeId } from './workspace-scope.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const workflowId = process.env.S6_MEDIA_ADMISSION_WORKFLOW_ID;
const workspaceId = process.env.S6_MEDIA_ADMISSION_WORKSPACE_ID;
const applicationVersion = process.env.S6_MEDIA_ADMISSION_APP_VERSION;
const crashMode = process.env.S6_MEDIA_ADMISSION_CRASH_MODE as
  | 'wait'
  | 'after-claim'
  | undefined;
if (
  !systemDatabaseUrl ||
  !databaseUrl ||
  !workflowId ||
  !workspaceId ||
  !applicationVersion
) {
  throw new Error(
    'S6 media admission fixture requires DBOS, application and workflow configuration.',
  );
}

const pool = new Pool({ connectionString: databaseUrl });
const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
await noteAdmission.migrate();
DBOS.setConfig({
  name: 'beauty-marketing-harness-media-admission',
  systemDatabaseUrl,
  applicationVersion,
});
const workflow = createMediaAdmissionWorkflow(
  noteAdmission,
  crashMode ?? 'wait',
);
await DBOS.launch();
await DBOS.startWorkflow(workflow, {
  workflowID: harnessRuntimeId(workspaceId, workflowId),
})(mediaAdmissionRequest(workflowId, workspaceId));

await new Promise(() => {});
