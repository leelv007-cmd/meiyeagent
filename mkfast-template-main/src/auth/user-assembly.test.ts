import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleVerifiedUser } from './user-assembly';

test('assembles workspace and default supply immediately for a verified user', async () => {
  const calls: string[] = [];

  const result = await assembleVerifiedUser(
    {
      id: 'user-assembly',
      email: 'owner@example.test',
      emailVerified: true,
      name: 'Example Store',
    },
    {
      ensureWorkspace: async () => {
        calls.push('workspace');
        return {
          membership: {
            role: 'owner',
            userId: 'user-assembly',
            workspaceId: 'ws_user-assembly',
          },
          workspace: { id: 'ws_user-assembly', name: 'Example Store' },
        };
      },
      provisionWorkspace: async (input) => {
        calls.push(`provision:${input.workspaceId}:${input.ownerUserId}`);
        return { status: 'completed' };
      },
    }
  );

  assert.deepEqual(result, { status: 'completed' });
  assert.deepEqual(calls, [
    'workspace',
    'provision:ws_user-assembly:user-assembly',
  ]);
});

test('does not assemble an unverified user', async () => {
  let called = false;

  const result = await assembleVerifiedUser(
    {
      id: 'user-unverified',
      email: 'owner@example.test',
      emailVerified: false,
      name: 'Example Store',
    },
    {
      ensureWorkspace: async () => {
        called = true;
        throw new Error('must not run');
      },
      provisionWorkspace: async () => {
        called = true;
        throw new Error('must not run');
      },
    }
  );

  assert.equal(result, null);
  assert.equal(called, false);
});
