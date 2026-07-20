import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPermissionAuditFields,
  projectPermissionAudit,
} from './audit.js';

test('permission audit projection carries actor/permission/target/reason/before-after/correlation/time', () => {
  const projection = projectPermissionAudit({
    actor: { userId: 'admin-1', role: 'admin' },
    permission: 'config.publish',
    target: {
      kind: 'command',
      module: 'admin-config',
      action: 'config_apply',
      resourceId: 'model.execution.mode',
      resourceType: 'config_key',
    },
    reason: 'Prepare direct execution',
    before: { revision: 1, value: 'gateway' },
    after: { revision: 2, value: 'direct' },
    correlationId: 'corr-audit-1',
    occurredAt: '2026-07-20T12:00:00.000Z',
  });

  assertPermissionAuditFields(projection);
  assert.equal(projection.actor.userId, 'admin-1');
  assert.equal(projection.actor.role, 'admin');
  assert.equal(projection.permission, 'config.publish');
  assert.equal(projection.target.module, 'admin-config');
  assert.equal(projection.target.action, 'config_apply');
  assert.equal(projection.target.resourceId, 'model.execution.mode');
  assert.equal(projection.reason, 'Prepare direct execution');
  assert.deepEqual(projection.before, { revision: 1, value: 'gateway' });
  assert.deepEqual(projection.after, { revision: 2, value: 'direct' });
  assert.equal(projection.correlationId, 'corr-audit-1');
  assert.equal(projection.occurredAt, '2026-07-20T12:00:00.000Z');
});

test('assertPermissionAuditFields rejects incomplete projections', () => {
  assert.throws(
    () =>
      assertPermissionAuditFields({
        actor: { userId: '' },
        permission: null,
        target: { kind: 'command', module: 'x', action: 'y' },
        reason: 'why',
        before: null,
        after: null,
        correlationId: 'c',
        occurredAt: 'not-a-date',
      }),
    /occurredAt/
  );
});
