import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveActiveWorkspace } from './workspaces';

function createDatabase(
  rows: Array<{
    id: string;
    role: 'owner' | 'operator' | 'reviewer' | 'admin';
  }>
) {
  return {
    select: (selection: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () =>
                rows.map((row) =>
                  Object.fromEntries(
                    Object.keys(selection).map((key) => [
                      key,
                      row[key as keyof typeof row],
                    ])
                  )
                ),
            }),
          }),
        }),
      }),
    }),
  };
}

describe('active workspace resolution', () => {
  it('returns the workspace id and persisted role from server-side membership', async () => {
    const workspace = await resolveActiveWorkspace(
      'user-123',
      createDatabase([{ id: 'ws_user-123', role: 'operator' }]) as never
    );

    assert.deepEqual(workspace, { id: 'ws_user-123', role: 'operator' });
  });

  it('returns no workspace when the user has no membership', async () => {
    assert.equal(
      await resolveActiveWorkspace(
        'user-without-workspace',
        createDatabase([]) as never
      ),
      undefined
    );
  });
});
