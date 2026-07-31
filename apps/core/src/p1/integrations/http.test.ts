import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  IntegrationApplicationService,
  IntegrationsFoundationModule,
  MemoryIntegrationRepository,
  type SecretContext,
  type SecretStorePort,
} from './index.js';

const emptyDiagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

class CountingSecretStore implements SecretStorePort {
  puts = 0;
  uses = 0;
  revokes = 0;

  reference(context: SecretContext) {
    return `counting://${context.workspaceId}/${context.credentialId}/v${context.version}`;
  }

  async put(context: SecretContext, _value: string) {
    this.puts += 1;
    return this.reference(context);
  }

  async use() {
    this.uses += 1;
    return 'counted-secret';
  }

  async revoke() {
    this.revokes += 1;
  }
}

test('P1 integration HTTP commands reject malformed nested inputs before secret effects', async (t) => {
  const foundation = new MemoryFoundationRepository();
  const secrets = new CountingSecretStore();
  foundation.grantOwner('workspace-a', 'owner-a');
  const integrations = new IntegrationApplicationService({
    repository: new MemoryIntegrationRepository(),
    secrets,
  });
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService: new P1ApplicationService(foundation, {
      operations: [new IntegrationsFoundationModule(integrations)],
    }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/commands`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-invalid-integration-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const invalidCredential = await fetch(url, {
    body: JSON.stringify({
      action: 'create_connection',
      module: 'integrations',
      payload: {
        credential: {
          scope: [{ id: 'model.invoke' }],
          value: { secret: 'must-not-reach-store' },
        },
        grantedCapabilities: ['model.invoke'],
        id: 'invalid-http-connection',
        identityMode: 'byok',
        provider: 'model',
        requestedCapabilities: ['model.invoke'],
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'invalid-http-credential',
    },
    method: 'POST',
  });
  assert.equal(invalidCredential.status, 400);
  assert.equal(
    ((await invalidCredential.json()) as { error: { code: string } }).error
      .code,
    'INVALID_INPUT'
  );
  assert.deepEqual(
    { puts: secrets.puts, revokes: secrets.revokes, uses: secrets.uses },
    { puts: 0, revokes: 0, uses: 0 }
  );

  const invalidShortcuts = await fetch(url, {
    body: JSON.stringify({
      action: 'set_feishu_shortcuts',
      module: 'integrations',
      payload: {
        connectionId: 'feishu-http',
        shortcuts: [
          { hidden: { value: false }, order: 0, toolId: 'doc.create' },
        ],
      },
    }),
    headers: { ...headers, 'idempotency-key': 'invalid-http-shortcuts' },
    method: 'POST',
  });
  assert.equal(invalidShortcuts.status, 400);
  assert.equal(
    ((await invalidShortcuts.json()) as { error: { code: string } }).error.code,
    'INVALID_INPUT'
  );
  assert.deepEqual(
    { puts: secrets.puts, revokes: secrets.revokes, uses: secrets.uses },
    { puts: 0, revokes: 0, uses: 0 }
  );
});
