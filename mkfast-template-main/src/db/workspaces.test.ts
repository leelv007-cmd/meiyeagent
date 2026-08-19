import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveDefaultWorkspace,
  resolveWorkspaceMembership,
} from './workspaces';

function createDatabase(
  rows: Array<{
    id: string;
    role: 'owner' | 'operator' | 'reviewer' | 'admin';
  }>
) {
  const selectedRows = (selection: Record<string, unknown>) =>
    rows.map((row) =>
      Object.fromEntries(
        Object.keys(selection).map((key) => [key, row[key as keyof typeof row]])
      )
    );
  return {
    select: (selection: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: () => {
            const limit = async () => selectedRows(selection);
            return { limit, orderBy: () => ({ limit }) };
          },
        }),
      }),
    }),
  };
}

describe('workspace resolution', () => {
  it('uses the earliest membership only as the compatibility default', async () => {
    const workspace = await resolveDefaultWorkspace(
      'user-123',
      createDatabase([{ id: 'ws_user-123', role: 'operator' }]) as never
    );

    assert.deepEqual(workspace, { id: 'ws_user-123', role: 'operator' });
  });

  it('keeps the earliest membership as the active workspace when a user has two memberships', async () => {
    const workspace = await resolveDefaultWorkspace(
      'user-with-two-memberships',
      createDatabase([
        { id: 'workspace-earliest', role: 'owner' },
        { id: 'workspace-later', role: 'operator' },
      ]) as never
    );

    assert.deepEqual(workspace, {
      id: 'workspace-earliest',
      role: 'owner',
    });
  });

  it('returns no workspace when the user has no membership', async () => {
    assert.equal(
      await resolveDefaultWorkspace(
        'user-without-workspace',
        createDatabase([]) as never
      ),
      undefined
    );
  });

  it('resolves an explicitly requested workspace only from user membership', async () => {
    const workspace = await resolveWorkspaceMembership(
      'user-123',
      'workspace-explicit',
      createDatabase([{ id: 'workspace-explicit', role: 'reviewer' }]) as never
    );

    assert.deepEqual(workspace, {
      id: 'workspace-explicit',
      role: 'reviewer',
    });
    assert.equal(
      await resolveWorkspaceMembership(
        'user-123',
        'workspace-foreign',
        createDatabase([]) as never
      ),
      undefined
    );
  });
});
