import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const moduleUrl = new URL(
  '../lib/auth/workspace-provisioning.ts',
  import.meta.url,
).href;

test('fault-injected PostgreSQL failures return request 503s and leave a later request usable', () => {
  const program = `
    const { ensureVerifiedWorkspaceProvisioned } =
      await import(process.env.WORKSPACE_PROVISIONING_MODULE_URL);
    const faults = [
      ['53300', 'sorry, too many clients already'],
      ['57P01', 'terminating connection due to administrator command'],
      ['CONNECTION_CLOSED', 'write CONNECTION_CLOSED localhost:5432'],
    ];
    globalThis.fetch = async () => new Response(null, { status: 204 });
    for (const [databaseCode, message] of faults) {
      let failFirstQuery = true;
      let healthyQueryCount = 0;
      const completed = {
        claimToken: null,
        lastErrorCode: null,
        modelDefaultStatus: 'completed',
        ownerEmail: 'owner@example.test',
        ownerName: 'Owner',
        ownerUserId: 'user-child-process',
        status: 'completed',
        trialStatus: 'completed',
        workspaceId: 'ws-child-process',
        workspaceName: 'Child Process Workspace',
      };
      const database = {
        async execute() {
          if (failFirstQuery) {
            failFirstQuery = false;
            throw Object.assign(new Error(message), { code: databaseCode });
          }
          healthyQueryCount += 1;
          if (healthyQueryCount === 2) return [];
          return [completed];
        },
      };
      try {
        await ensureVerifiedWorkspaceProvisioned({
          coreServiceToken: 'test-token',
          coreServiceUrl: 'http://core.test',
          database,
          ownerUserId: 'user-child-process',
          workspaceId: 'ws-child-process',
        });
        throw new Error('fault was unexpectedly accepted');
      } catch (error) {
        if (error?.statusCode !== 503 || error?.body?.code !== 'POSTGRES_UNAVAILABLE') {
          throw error;
        }
        console.log('request=503 code=' + databaseCode);
      }
      const result = await ensureVerifiedWorkspaceProvisioned({
        coreServiceToken: 'test-token',
        coreServiceUrl: 'http://core.test',
        database,
        ownerUserId: 'user-child-process',
        workspaceId: 'ws-child-process',
      });
      console.log('follow-up=200 status=' + result.status);
    }
  `;
  const child = spawnSync(
    process.execPath,
    ['--import=tsx', '--input-type=module', '--eval', program],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        WORKSPACE_PROVISIONING_MODULE_URL: moduleUrl,
      },
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null, child.stderr);
  assert.deepEqual(
    child.stdout.trim().split('\n'),
    [
      'request=503 code=53300',
      'follow-up=200 status=completed',
      'request=503 code=57P01',
      'follow-up=200 status=completed',
      'request=503 code=CONNECTION_CLOSED',
      'follow-up=200 status=completed',
    ],
  );
});
