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
  FakeKmsSecretStore,
  IntegrationApplicationService,
  IntegrationsFoundationModule,
  MemoryIntegrationRepository,
  RecordedDouyinAdapter,
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

test('P1 integration HTTP query exposes recorded Douyin as not integrated', async (t) => {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  const integrations = new IntegrationApplicationService({
    repository: new MemoryIntegrationRepository(),
    secrets: new FakeKmsSecretStore(),
    douyin: new RecordedDouyinAdapter(),
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

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/query`,
    {
      body: JSON.stringify({
        action: 'douyin_integration_status',
        module: 'integrations',
        payload: {},
      }),
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': 'corr-douyin-status-http',
        'x-service-token': 'test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      method: 'POST',
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (
      (await response.json()) as {
        data: {
          executionMode: string;
          integrated: boolean;
          provider: string;
        };
      }
    ).data,
    {
      provider: 'douyin',
      integrated: false,
      executionMode: 'recorded',
    },
  );
});

test('Douyin authorization evidence is accepted only from the trusted callback boundary', async (t) => {
  const repository = new MemoryIntegrationRepository();
  const integrations = new IntegrationApplicationService({
    repository,
    secrets: new FakeKmsSecretStore(),
  });
  await integrations.createConnection(
    {
      correlationId: 'create-douyin',
      role: 'owner',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    {
      credential: {
        scope: ['video.create.bind'],
        status: 'unverified',
        value: 'recorded-oauth',
      },
      grantedCapabilities: [],
      id: 'douyin-a',
      identityMode: 'oauth_user',
      provider: 'douyin',
      requestedCapabilities: ['publish'],
      subject: 'open-id-a',
    },
    'create-douyin-a'
  );

  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    douyinCallbackToken: 'test-callback-token',
    integrationService: integrations,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/integrations/douyin/authorization-events`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-douyin-event',
  };
  const event = {
    capability: 'publish',
    connectionId: 'douyin-a',
    eventId: 'provider-event-1',
    evidence: {
      endpoint: 'recorded://douyin/publish',
      revision: 'provider-contract-r1',
      scopes: ['video.create.bind'],
      verifiedAt: '2026-07-11T00:00:00.000Z',
    },
    type: 'contract_authorize',
  };

  const rejected = await fetch(url, {
    body: JSON.stringify(event),
    headers: {
      ...headers,
      'x-core-actor': 'worker',
      'x-service-token': 'test-service-token',
    },
    method: 'POST',
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(url, {
    body: JSON.stringify(event),
    headers: { ...headers, 'x-douyin-callback-token': 'test-callback-token' },
    method: 'POST',
  });
  assert.equal(accepted.status, 200);
  const payload = (await accepted.json()) as {
    data: {
      capabilityEvidence: { publish?: { revision: string } };
      credential: { status: string };
      credentialTransition?: unknown;
      grantedCapabilities: string[];
      secretRef?: string;
    };
  };
  assert.deepEqual(payload.data.grantedCapabilities, ['publish']);
  assert.equal(
    payload.data.capabilityEvidence.publish?.revision,
    'provider-contract-r1'
  );
  assert.equal(payload.data.secretRef, undefined);
  assert.equal(payload.data.credentialTransition, undefined);
  assert.equal(payload.data.credential.status, 'active');

  const transitioning = await repository.getConnection(
    'workspace-a',
    'douyin-a'
  );
  assert.ok(transitioning);
  transitioning.status = 'disabled';
  transitioning.credentialTransition = {
    kind: 'disconnect',
    operationId: 'disconnect-operation',
    payloadHash: 'private-payload-hash',
    phase: 'secret_revoke_pending',
    previousSecretRef: transitioning.secretRef,
    previousVersion: transitioning.credential.version,
  };
  await repository.saveConnection(transitioning);

  const replayed = await fetch(url, {
    body: JSON.stringify(event),
    headers: { ...headers, 'x-douyin-callback-token': 'test-callback-token' },
    method: 'POST',
  });
  assert.equal(replayed.status, 200);
  const replayedPayload = (await replayed.json()) as {
    data: { credentialTransition?: unknown; secretRef?: string };
  };
  assert.equal(replayedPayload.data.secretRef, undefined);
  assert.equal(replayedPayload.data.credentialTransition, undefined);
});

test('Douyin publish callback reconciles a claimed job only through the trusted boundary', async (t) => {
  const repository = new MemoryIntegrationRepository();
  const integrations = new IntegrationApplicationService({
    repository,
    secrets: new FakeKmsSecretStore(),
  });
  await repository.saveDouyinPublishJob({
    acceptance: 'acceptance_unknown',
    confirmationId: 'confirmation-callback',
    connectionId: 'douyin-callback',
    createdAt: '2026-07-11T00:00:00.000Z',
    effectState: 'reconciliation_required',
    id: 'job-callback',
    status: 'unknown',
    updatedAt: '2026-07-11T00:00:00.000Z',
    workspaceId: 'workspace-a',
  });
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    douyinCallbackToken: 'test-callback-token',
    integrationService: integrations,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/integrations/douyin/publish-events`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-douyin-publish-event',
  };
  const event = {
    connectionId: 'douyin-callback',
    eventId: 'provider-publish-event-1',
    itemId: 'item-callback',
    jobId: 'job-callback',
    occurredAt: '2026-07-11T01:00:00.000Z',
    status: 'published',
  };

  const rejected = await fetch(url, {
    body: JSON.stringify(event),
    headers: {
      ...headers,
      'x-core-actor': 'worker',
      'x-service-token': 'test-service-token',
    },
    method: 'POST',
  });
  assert.equal(rejected.status, 401);
  const accepted = await fetch(url, {
    body: JSON.stringify(event),
    headers: { ...headers, 'x-douyin-callback-token': 'test-callback-token' },
    method: 'POST',
  });
  assert.equal(accepted.status, 200);
  const payload = (await accepted.json()) as {
    data: { itemId: string; status: string };
  };
  assert.deepEqual(payload.data, {
    acceptance: 'accepted',
    confirmationId: 'confirmation-callback',
    connectionId: 'douyin-callback',
    createdAt: '2026-07-11T00:00:00.000Z',
    effectState: 'settled',
    id: 'job-callback',
    itemId: 'item-callback',
    providerEventId: 'provider-publish-event-1',
    providerOccurredAt: '2026-07-11T01:00:00.000Z',
    pollingState: 'completed',
    status: 'published',
    updatedAt: '2026-07-11T01:00:00.000Z',
    workspaceId: 'workspace-a',
  });
});
