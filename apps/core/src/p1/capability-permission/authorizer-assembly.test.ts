import assert from 'node:assert/strict';
import test from 'node:test';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { P1DomainError } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { createPermissionAuthorizer } from './authorizer.js';

const probeModule: P1OperationModule = {
  name: 'admin-config',
  async execute() {
    return { ok: true };
  },
  async query() {
    return { ok: true };
  },
};

test('P1ApplicationService authorizer port denies unregistered module actions', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-a', 'owner-a');
  const service = new P1ApplicationService(repository, {
    authorizer: createPermissionAuthorizer(),
    operations: [probeModule],
  });

  await assert.rejects(
    () =>
      service.executeModule(
        {
          workspaceId: 'workspace-a',
          userId: 'owner-a',
          actor: 'owner',
          correlationId: 'corr-1',
        },
        'admin-config',
        { action: 'not_a_real_action' },
        'idem-1',
      ),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
});

test('P1ApplicationService authorizer port grants admin config_list', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-a', 'admin-a');
  // Admin actor is trusted at membership layer.
  const service = new P1ApplicationService(repository, {
    authorizer: createPermissionAuthorizer(),
    operations: [probeModule],
  });

  const result = await service.queryModule(
    {
      workspaceId: 'workspace-a',
      userId: 'admin-a',
      actor: 'admin',
      correlationId: 'corr-2',
    },
    'admin-config',
    { action: 'config_list' },
  );
  assert.deepEqual(result, { ok: true });
});
