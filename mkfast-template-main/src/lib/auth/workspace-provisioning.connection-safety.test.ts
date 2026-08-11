import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureVerifiedWorkspaceProvisioned } from './workspace-provisioning';

test('workspace provisioning returns a retryable correlated 503 for a PostgreSQL connection failure', async () => {
  const database = {
    async execute() {
      throw Object.assign(
        new Error('terminating connection due to administrator command'),
        {
          code: '57P01',
        }
      );
    },
  };

  await assert.rejects(
    ensureVerifiedWorkspaceProvisioned({
      coreServiceToken: 'test-token',
      coreServiceUrl: 'http://core.test',
      database: database as never,
      ownerUserId: 'user-connection-safety',
      workspaceId: 'ws-connection-safety',
    }),
    (error: unknown) => {
      const apiError = error as {
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
        statusCode?: number;
      };
      assert.equal(apiError.statusCode, 503);
      assert.equal(apiError.body?.code, 'POSTGRES_UNAVAILABLE');
      assert.match(
        String(apiError.body?.correlationId),
        /^workspace-provisioning:/u
      );
      assert.equal(apiError.headers?.['retry-after'], '5');
      return true;
    }
  );
});
