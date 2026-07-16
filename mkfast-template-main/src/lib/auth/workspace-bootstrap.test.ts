import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPersonalWorkspaceBootstrap,
  ensurePersonalWorkspace,
  getPersonalWorkspaceId,
} from './workspace-bootstrap';

describe('personal workspace bootstrap', () => {
  it('derives the same workspace and active owner membership for a verified user', () => {
    const user = {
      id: 'user-123',
      name: 'Mumu Nails',
      email: 'owner@example.test',
      emailVerified: true,
    };

    const first = buildPersonalWorkspaceBootstrap(user);
    const second = buildPersonalWorkspaceBootstrap(user);

    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      workspace: {
        id: 'ws_user-123',
        name: 'Mumu Nails',
      },
      membership: {
        workspaceId: 'ws_user-123',
        userId: 'user-123',
        role: 'owner',
      },
    });
  });

  it('uses a stable email-derived workspace name when the display name is blank', () => {
    const bootstrap = buildPersonalWorkspaceBootstrap({
      id: 'user-456',
      name: '   ',
      email: 'OWNER@EXAMPLE.TEST',
      emailVerified: true,
    });

    assert.equal(bootstrap.workspace.name, 'owner');
    assert.equal(getPersonalWorkspaceId('user-456'), 'ws_user-456');
  });

  it('rejects workspace creation before email verification', () => {
    assert.throws(
      () =>
        buildPersonalWorkspaceBootstrap({
          id: 'user-789',
          name: 'Unverified User',
          email: 'unverified@example.test',
          emailVerified: false,
        }),
      /verified user/
    );
  });

  it('persists the exact workspace and membership rows in one transaction', async () => {
    const insertedRows: Array<Record<string, string>> = [];
    let transactions = 0;
    const database = {
      transaction: async (
        callback: (transaction: {
          insert: () => {
            values: (row: Record<string, string>) => {
              onConflictDoNothing: () => Promise<void>;
            };
          };
        }) => Promise<unknown>
      ) => {
        transactions += 1;
        return callback({
          insert: () => ({
            values: (row) => {
              insertedRows.push(row);
              return {
                onConflictDoNothing: async () => undefined,
              };
            },
          }),
        });
      },
    };

    const bootstrap = await ensurePersonalWorkspace(
      {
        id: 'user-123',
        name: 'Mumu Nails',
        email: 'owner@example.test',
        emailVerified: true,
      },
      database as never
    );

    assert.equal(transactions, 1);
    assert.deepEqual(insertedRows, [
      { id: 'ws_user-123', name: 'Mumu Nails' },
      {
        workspaceId: 'ws_user-123',
        userId: 'user-123',
        role: 'owner',
      },
    ]);
    assert.equal(bootstrap.workspace.id, 'ws_user-123');
  });
});
