import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import { PostgresSecurityRejectionAuditRepository } from './postgres-security-rejection-audit-repository.js';

test('persists and reads rejection audit evidence through the existing workspace audit table', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const event = {
    actorId: 'attacker-user',
    correlationId: 'security-correlation',
    createdAt: '2026-07-16T12:00:00.000Z',
    id: `security-rejection-${'a'.repeat(24)}`,
    objectKind: 'asset' as const,
    outcome: 'opaque_not_found' as const,
    requestAction: 'getAsset',
    targetDigest: 'b'.repeat(64),
    workspaceId: 'attacker-workspace',
  };
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return sql.includes('SELECT detail')
        ? { rows: [{ detail: event }] }
        : { rows: [] };
    },
  } as unknown as Pool;
  const repository = new PostgresSecurityRejectionAuditRepository(pool);

  await repository.append(event);
  assert.deepEqual(
    await repository.list({
      actorId: 'attacker-user',
      workspaceId: 'attacker-workspace',
    }),
    [event]
  );

  assert.match(queries[0]?.sql ?? '', /INSERT INTO pro_studio_audit_events/u);
  assert.deepEqual(queries[0]?.values.slice(0, 3), [
    'attacker-workspace',
    'security.object_access_rejected',
    'attacker-user',
  ]);
  assert.equal(JSON.stringify(queries[0]?.values).includes('foreign-'), false);
  assert.match(
    queries[1]?.sql ?? '',
    /workspace_id = \$1[\s\S]*actor_id = \$2[\s\S]*action = 'security\.object_access_rejected'/u
  );
  assert.deepEqual(queries[1]?.values, ['attacker-workspace', 'attacker-user']);
});
