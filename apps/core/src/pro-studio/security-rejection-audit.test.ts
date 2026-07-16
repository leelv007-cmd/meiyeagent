import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemorySecurityRejectionAuditRepository,
  SecurityRejectionAuditService,
} from './security-rejection-audit.js';

test('persists opaque rejection evidence under the attacker workspace without raw target IDs', async () => {
  const repository = new MemorySecurityRejectionAuditRepository();
  const service = new SecurityRejectionAuditService(repository, {
    clock: () => new Date('2026-07-16T12:00:00.000Z'),
  });
  const context = {
    correlationId: 'security-correlation-1',
    userId: 'attacker-user',
    workspaceId: 'attacker-workspace',
  };

  await service.record(context, {
    objectKind: 'project',
    requestAction: 'loadProject',
    targetId: 'foreign-project-secret',
  });

  const events = await service.list(context);
  assert.deepEqual(events, [
    {
      actorId: 'attacker-user',
      correlationId: 'security-correlation-1',
      createdAt: '2026-07-16T12:00:00.000Z',
      id: events[0]?.id,
      objectKind: 'project',
      outcome: 'opaque_not_found',
      requestAction: 'loadProject',
      targetDigest: events[0]?.targetDigest,
      workspaceId: 'attacker-workspace',
    },
  ]);
  assert.match(events[0]?.id ?? '', /^security-rejection-[a-f0-9]{24}$/u);
  assert.match(events[0]?.targetDigest ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(
    JSON.stringify(events).includes('foreign-project-secret'),
    false
  );
  assert.deepEqual(
    await service.list({ ...context, userId: 'different-user' }),
    []
  );
  assert.deepEqual(
    await service.list({ ...context, workspaceId: 'different-workspace' }),
    []
  );
});

test('accepts exactly the seven frozen Ticket 25 object kinds', async () => {
  const repository = new MemorySecurityRejectionAuditRepository();
  const service = new SecurityRejectionAuditService(repository);
  const context = {
    correlationId: 'security-correlation-kinds',
    userId: 'attacker-user',
    workspaceId: 'attacker-workspace',
  };
  const objectKinds = [
    'project',
    'revision',
    'asset',
    'job',
    'package',
    'grant',
    'confirmation',
  ] as const;

  for (const objectKind of objectKinds) {
    await service.record(
      { ...context, correlationId: `correlation-${objectKind}` },
      {
        objectKind,
        requestAction: `reject-${objectKind}`,
        targetId: `foreign-${objectKind}`,
      }
    );
  }

  assert.deepEqual(
    (await service.list(context)).map((event) => event.objectKind),
    objectKinds
  );
});
