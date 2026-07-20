import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationApplicationService } from './application-service.js';
import {
  IntegrationError,
  type SecretContext,
  type SecretStorePort,
} from './contracts.js';
import { IntegrationsFoundationModule } from './foundation-module.js';
import { MemoryIntegrationRepository } from './repository.js';
import { RecordedFeishuMcpAdapter } from './feishu.js';
import { FakeKmsSecretStore } from './secret-store.js';
import { RecordedDouyinAdapter } from './douyin.js';

const context = {
  correlationId: 'corr-a',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

class RecordingSecretStore implements SecretStorePort {
  puts = 0;
  uses = 0;
  revokes = 0;

  reference(secretContext: SecretContext) {
    return `recording://${secretContext.workspaceId}/${secretContext.credentialId}/v${secretContext.version}`;
  }

  async put(secretContext: SecretContext, _value: string) {
    this.puts += 1;
    return this.reference(secretContext);
  }

  async use() {
    this.uses += 1;
    return 'recorded-secret';
  }

  async revoke() {
    this.revokes += 1;
  }
}

async function rejectsInvalidInput(
  operation: Promise<unknown>,
  message: RegExp
) {
  await assert.rejects(
    operation,
    (error) =>
      error instanceof IntegrationError &&
      error.code === 'INVALID_INPUT' &&
      error.status === 400 &&
      message.test(error.message)
  );
}

test('integration HTTP module returns write-only connection views', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    })
  );
  const created = await module.execute({
    context,
    idempotencyKey: 'create-model-connection',
    input: {
      action: 'create_connection',
      payload: {
        credential: {
          scope: ['model.invoke'],
          value: 'secret-value-never-returned',
        },
        grantedCapabilities: ['model.invoke'],
        id: 'model-byok-a',
        identityMode: 'byok',
        provider: 'model',
        requestedCapabilities: ['model.invoke'],
      },
    },
  });
  const connections = await module.query({
    context,
    input: { action: 'connections', payload: {} },
  });

  assert.equal('secretRef' in (created as object), false);
  assert.equal(
    JSON.stringify(created).includes('secret-value-never-returned'),
    false
  );
  assert.equal(Array.isArray(connections), true);
  assert.equal('secretRef' in (connections as object[])[0]!, false);
});

test('platform admins manage provider credentials in the isolated global vault', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    }),
  );
  const adminContext = {
    actor: 'admin' as const,
    correlationId: 'corr-admin-provider',
    userId: 'admin-provider',
    workspaceId: 'request-workspace-is-ignored',
  };

  const stored = await module.execute({
    context: adminContext,
    idempotencyKey: 'store-platform-model-key',
    input: {
      action: 'admin_store_provider_credential',
      payload: {
        slot: 'model.direct',
        credential: { scope: ['models.read'], value: 'vault-only-secret' },
      },
    },
  });
  const listed = (await module.query({
    context: adminContext,
    input: { action: 'admin_provider_credentials', payload: {} },
  })) as Array<Record<string, unknown>>;

  assert.equal(JSON.stringify(stored).includes('vault-only-secret'), false);
  assert.equal(JSON.stringify(listed).includes('vault-only-secret'), false);
  assert.equal(listed[0]?.workspaceId, '__global__');
  assert.equal('secretRef' in (listed[0] ?? {}), false);
  await assert.rejects(
    module.query({
      context,
      input: { action: 'admin_provider_credentials', payload: {} },
    }),
    /Admin identity is required/,
  );
});

test('platform admin credential query reports each boot-time effective source', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    }),
    {
      providerCredentialSources: {
        arkMedia: { source: 'env_fallback' },
        modelDirect: { source: 'vault', credentialVersion: 1 },
      },
    },
  );
  const adminContext = {
    actor: 'admin' as const,
    correlationId: 'corr-admin-provider-sources',
    userId: 'admin-provider',
    workspaceId: 'request-workspace-is-ignored',
  };
  for (const slot of [
    'model.direct',
    'ark.media',
    'douyin.platform',
  ] as const) {
    await module.execute({
      context: adminContext,
      idempotencyKey: `store-platform-${slot}`,
      input: {
        action: 'admin_store_provider_credential',
        payload: {
          slot,
          credential: { scope: ['provider.connect'], value: `value-${slot}` },
        },
      },
    });
  }

  const listed = (await module.query({
    context: adminContext,
    input: { action: 'admin_provider_credentials', payload: {} },
  })) as Array<{ effectiveSource: string; id: string }>;

  assert.deepEqual(
    Object.fromEntries(
      listed.map((connection) => [connection.id, connection.effectiveSource]),
    ),
    {
      'platform:ark.media': 'env_fallback',
      'platform:douyin.platform': 'env',
      'platform:model.direct': 'vault',
    },
  );
});

test('platform admin credential query reports boot-time sources for empty vault slots', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    }),
    {
      providerCredentialSources: {
        arkMedia: { source: 'env_fallback' },
        modelDirect: { source: 'env_fallback' },
      },
    },
  );

  const listed = (await module.query({
    context: {
      actor: 'admin',
      correlationId: 'corr-empty-provider-sources',
      userId: 'admin-provider',
      workspaceId: '__global__',
    },
    input: { action: 'admin_provider_credentials', payload: {} },
  })) as Array<{ effectiveSource: string; id: string; credential?: unknown }>;

  assert.deepEqual(listed, [
    {
      effectiveSource: 'env_fallback',
      id: 'platform:model.direct',
    },
    {
      effectiveSource: 'env_fallback',
      id: 'platform:ark.media',
    },
    {
      effectiveSource: 'env',
      id: 'platform:douyin.platform',
    },
  ]);
});

test('platform admin tests a provider credential without exposing or activating it', async () => {
  const observedCredentials: string[] = [];
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      providerConnectivity: {
        async probe(input) {
          observedCredentials.push(input.credential);
          return { errorCode: 'http_401', status: 'unauthorized' };
        },
      },
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    }),
  );
  const adminContext = {
    actor: 'admin' as const,
    correlationId: 'corr-admin-provider-test',
    userId: 'admin-provider',
    workspaceId: 'ignored-request-workspace',
  };
  await module.execute({
    context: adminContext,
    idempotencyKey: 'store-platform-model-key-for-test',
    input: {
      action: 'admin_store_provider_credential',
      payload: {
        slot: 'model.direct',
        credential: {
          scope: ['models.read'],
          value: 'provider-test-secret',
        },
      },
    },
  });

  const tested = (await module.execute({
    context: adminContext,
    idempotencyKey: 'test-platform-model-key',
    input: {
      action: 'admin_test_provider_connection',
      payload: { slot: 'model.direct' },
    },
  })) as Record<string, any>;
  const listed = (await module.query({
    context: adminContext,
    input: { action: 'admin_provider_credentials', payload: {} },
  })) as Array<Record<string, any>>;

  assert.deepEqual(observedCredentials, ['provider-test-secret']);
  assert.equal(tested.status, 'available');
  assert.equal(tested.credential.testStatus, 'unauthorized');
  assert.equal(tested.credential.testErrorCode, 'http_401');
  assert.equal(Number.isFinite(Date.parse(tested.credential.testedAt)), true);
  assert.equal(listed[0]?.credential.testStatus, 'unauthorized');
  assert.equal(JSON.stringify(tested).includes('provider-test-secret'), false);
  assert.equal(JSON.stringify(tested).includes('secretRef'), false);
  assert.equal(JSON.stringify(tested).includes('activationEvidence'), false);
});

test('provider credential rotation clears the previous connectivity result', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      providerConnectivity: {
        async probe() {
          return { status: 'passed' } as const;
        },
      },
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    }),
  );
  const adminContext = {
    actor: 'admin' as const,
    correlationId: 'corr-admin-provider-rotate',
    userId: 'admin-provider',
    workspaceId: 'ignored-request-workspace',
  };
  await module.execute({
    context: adminContext,
    idempotencyKey: 'store-provider-before-rotate',
    input: {
      action: 'admin_store_provider_credential',
      payload: {
        slot: 'ark.media',
        credential: { scope: ['models.read'], value: 'old-secret' },
      },
    },
  });
  await module.execute({
    context: adminContext,
    idempotencyKey: 'test-provider-before-rotate',
    input: {
      action: 'admin_test_provider_connection',
      payload: { slot: 'ark.media' },
    },
  });

  const rotated = (await module.execute({
    context: adminContext,
    idempotencyKey: 'rotate-provider-after-test',
    input: {
      action: 'admin_rotate_provider_credential',
      payload: {
        slot: 'ark.media',
        credential: { scope: ['models.read'], value: 'new-secret' },
      },
    },
  })) as Record<string, any>;

  assert.equal(rotated.credential.version, 2);
  assert.equal(rotated.credential.testedAt, undefined);
  assert.equal(rotated.credential.testStatus, undefined);
  assert.equal(rotated.credential.testErrorCode, undefined);
});

test('integration module exposes the runtime Douyin integration status', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
      douyin: new RecordedDouyinAdapter(),
    }),
  );

  assert.deepEqual(
    await module.query({
      context,
      input: { action: 'douyin_integration_status', payload: {} },
    }),
    {
      provider: 'douyin',
      integrated: false,
      executionMode: 'recorded',
    },
  );
});

test('public OAuth commands cannot self-grant Douyin capabilities or evidence', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    })
  );
  const created = (await module.execute({
    context,
    idempotencyKey: 'create-douyin-unverified',
    input: {
      action: 'create_connection',
      payload: {
        credential: {
          scope: ['video.create.bind'],
          status: 'active',
          value: 'unverified-oauth-token',
        },
        grantedCapabilities: ['publish'],
        id: 'douyin-unverified',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
      },
    },
  })) as { grantedCapabilities: string[]; credential: { status: string } };

  assert.deepEqual(created.grantedCapabilities, []);
  assert.equal(created.credential.status, 'unverified');
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'activate-with-browser-evidence',
      input: {
        action: 'activate_douyin_capability',
        payload: {
          capability: 'publish',
          connectionId: 'douyin-unverified',
          evidence: {
            revision: 'browser-forged',
            scopes: ['video.create.bind'],
            verifiedAt: '2026-07-11T00:00:00.000Z',
          },
        },
      },
    }),
    (error) =>
      error instanceof IntegrationError &&
      error.code === 'CAPABILITY_NOT_GRANTED'
  );
});

test('Feishu activity query exposes only safe product fields and HTTPS links', async () => {
  const repository = new MemoryIntegrationRepository();
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository,
      secrets: new FakeKmsSecretStore(),
    })
  );
  await module.execute({
    context,
    idempotencyKey: 'create-feishu-safe-view',
    input: {
      action: 'create_connection',
      payload: {
        credential: { scope: ['mcp.tools'], value: 'uat-secret' },
        grantedCapabilities: [],
        id: 'feishu-safe-view',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
    },
  });
  await repository.appendActivity({
    connectionId: 'feishu-safe-view',
    executedAt: '2026-07-11T00:00:00.000Z',
    externalUrl: 'javascript:alert(1)',
    id: 'activity-safe-view',
    intentId: 'private-intent',
    objectId: 'private-object',
    providerLogId: 'private-provider-log',
    status: 'completed',
    toolId: 'doc.create',
    workspaceId: context.workspaceId,
  });

  const activity = (await module.query({
    context,
    input: {
      action: 'feishu_activity',
      payload: { connectionId: 'feishu-safe-view' },
    },
  })) as Array<Record<string, unknown>>;
  assert.deepEqual(activity, [
    {
      executedAt: '2026-07-11T00:00:00.000Z',
      id: 'activity-safe-view',
      status: 'completed',
      toolId: 'doc.create',
    },
  ]);
});

test('Douyin operations query omits internal claim and callback identifiers', async () => {
  const repository = new MemoryIntegrationRepository();
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      contentSnapshots: {
        async list() {
          return [
            {
              artifactId: 'artifact-safe-view',
              contentId: 'content-safe-view',
              contentVersionId: 'content-version-safe-view',
              createdAt: '2026-07-11T00:00:00.000Z',
              id: 'snapshot-safe-view',
              platform: 'douyin',
              revision: 'snapshot-revision-safe-view',
              source: 'product_handoff',
              title: '真实门店视频',
            },
          ];
        },
        async resolve() {
          return undefined;
        },
      },
      repository,
      secrets: new FakeKmsSecretStore(),
    })
  );
  await module.execute({
    context,
    idempotencyKey: 'create-douyin-operations-view',
    input: {
      action: 'create_connection',
      payload: {
        credential: { scope: ['video.create.bind'], value: 'oauth-secret' },
        id: 'douyin-operations-view',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
      },
    },
  });
  await repository.saveDouyinPublishJob({
    acceptance: 'accepted',
    confirmationId: 'confirmation-safe-view',
    connectionId: 'douyin-operations-view',
    createdAt: '2026-07-11T00:00:00.000Z',
    effectState: 'settled',
    id: 'job-safe-view',
    itemId: 'item-safe-view',
    payloadHash: 'private-claim-hash',
    providerEventId: 'private-provider-event',
    providerOccurredAt: '2026-07-11T00:30:00.000Z',
    status: 'published',
    updatedAt: '2026-07-11T01:00:00.000Z',
    workspaceId: context.workspaceId,
  });

  const snapshot = (await module.query({
    context,
    input: {
      action: 'douyin_operations_snapshot',
      payload: { connectionId: 'douyin-operations-view' },
    },
  })) as { publishJobs: Array<Record<string, unknown>> };

  assert.equal(snapshot.publishJobs[0]?.payloadHash, undefined);
  assert.equal(snapshot.publishJobs[0]?.providerEventId, undefined);
  assert.equal(snapshot.publishJobs[0]?.providerOccurredAt, undefined);
  assert.equal(snapshot.publishJobs[0]?.status, 'published');

  const contentSnapshots = (await module.query({
    context,
    input: { action: 'douyin_content_snapshots', payload: {} },
  })) as Array<Record<string, unknown>>;
  assert.deepEqual(contentSnapshots, [
    {
      artifactId: 'artifact-safe-view',
      contentId: 'content-safe-view',
      contentVersionId: 'content-version-safe-view',
      createdAt: '2026-07-11T00:00:00.000Z',
      id: 'snapshot-safe-view',
      platform: 'douyin',
      revision: 'snapshot-revision-safe-view',
      source: 'product_handoff',
      title: '真实门店视频',
    },
  ]);
});

test('integration side-effect commands reject malformed boundary payloads', async () => {
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    })
  );

  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'malformed-douyin-submit',
      input: {
        action: 'submit_douyin_publish',
        payload: {
          confirmationId: 'confirmation-a',
          contentSnapshotId: 'snapshot-a',
        },
      },
    }),
    /scheduledAt is required/
  );
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'malformed-feishu-execute',
      input: {
        action: 'execute_feishu_intent',
        payload: {
          arguments: [],
          connectionId: 'feishu-a',
          fields: [],
          sideEffect: 'create',
          source: 'explicit_user',
          toolId: 'doc.create',
        },
      },
    }),
    /Integration input must be an object/
  );
});

test('nested integration command payloads are validated before secret or provider effects', async () => {
  const secrets = new RecordingSecretStore();
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets,
    })
  );
  const createPayload = {
    credential: {
      scope: ['model.invoke'],
      status: 'active',
      value: 'model-secret',
    },
    grantedCapabilities: ['model.invoke'],
    id: 'strict-model-connection',
    identityMode: 'byok',
    provider: 'model',
    requestedCapabilities: ['model.invoke'],
  };
  const invalidCreates: Array<{
    message: RegExp;
    payload: Record<string, unknown>;
  }> = [
    {
      message: /value is required/,
      payload: {
        ...createPayload,
        credential: { ...createPayload.credential, value: { secret: 'x' } },
      },
    },
    {
      message: /scope must be a string array/,
      payload: {
        ...createPayload,
        credential: {
          ...createPayload.credential,
          scope: [{ capability: 'model.invoke' }],
        },
      },
    },
    {
      message: /status is invalid/,
      payload: {
        ...createPayload,
        credential: { ...createPayload.credential, status: 'enabled' },
      },
    },
    {
      message: /expiresAt must be a timestamp/,
      payload: {
        ...createPayload,
        credential: {
          ...createPayload.credential,
          expiresAt: 'not-a-timestamp',
        },
      },
    },
    {
      message: /requestedCapabilities must be a string array/,
      payload: {
        ...createPayload,
        requestedCapabilities: [{ id: 'model.invoke' }],
      },
    },
    {
      message: /grantedCapabilities must be a string array/,
      payload: {
        ...createPayload,
        grantedCapabilities: [{ id: 'model.invoke' }],
      },
    },
  ];

  for (const [index, invalid] of invalidCreates.entries()) {
    await rejectsInvalidInput(
      module.execute({
        context,
        idempotencyKey: `invalid-create-${index}`,
        input: { action: 'create_connection', payload: invalid.payload },
      }),
      invalid.message
    );
  }
  assert.equal(secrets.puts, 0);

  await module.execute({
    context,
    idempotencyKey: 'valid-create-before-invalid-rotation',
    input: { action: 'create_connection', payload: createPayload },
  });
  assert.equal(secrets.puts, 1);

  await rejectsInvalidInput(
    module.execute({
      context,
      idempotencyKey: 'invalid-rotation',
      input: {
        action: 'rotate_credential',
        payload: {
          connectionId: createPayload.id,
          credential: {
            refreshExpiresAt: 'tomorrow',
            scope: ['model.invoke'],
            value: 'replacement-secret',
          },
        },
      },
    }),
    /refreshExpiresAt must be a timestamp/
  );
  assert.equal(secrets.puts, 1);
  assert.equal(secrets.revokes, 0);

  await rejectsInvalidInput(
    module.execute({
      context,
      idempotencyKey: 'invalid-byok-submit',
      input: {
        action: 'submit_strict_byok',
        payload: {
          catalogModelId: 'model-a',
          connectionId: createPayload.id,
          endpointProfileId: 'profile-a',
          prompt: { text: 'invalid nested prompt' },
        },
      },
    }),
    /prompt is required/
  );
  assert.equal(secrets.uses, 0);

  for (const action of [
    'activate_douyin_capability',
    'deactivate_douyin_capability',
  ]) {
    await rejectsInvalidInput(
      module.execute({
        context,
        idempotencyKey: `invalid-${action}`,
        input: {
          action,
          payload: { capability: 'delete', connectionId: 'douyin-a' },
        },
      }),
      /capability is invalid/
    );
  }

  const invalidShortcutLists: Array<{
    message: RegExp;
    shortcuts: unknown;
  }> = [
    { message: /shortcuts must be an array/, shortcuts: {} },
    { message: /shortcuts\[0\] must be an object/, shortcuts: [null] },
    {
      message: /order must be a non-negative integer/,
      shortcuts: [{ hidden: false, order: '0', toolId: 'doc.create' }],
    },
    {
      message: /hidden must be a boolean/,
      shortcuts: [{ hidden: 'false', order: 0, toolId: 'doc.create' }],
    },
  ];
  for (const [index, invalid] of invalidShortcutLists.entries()) {
    await rejectsInvalidInput(
      module.execute({
        context,
        idempotencyKey: `invalid-shortcuts-${index}`,
        input: {
          action: 'set_feishu_shortcuts',
          payload: { connectionId: 'feishu-a', shortcuts: invalid.shortcuts },
        },
      }),
      invalid.message
    );
  }
});

test('only trusted admins synchronize and publish Feishu tool revisions', async () => {
  const repository = new MemoryIntegrationRepository();
  const feishu = new RecordedFeishuMcpAdapter([
    {
      id: 'docx.v1.document.create',
      inputSchema: {
        properties: { title: { type: 'string' } },
        required: ['title'],
        type: 'object',
      },
      remoteRevision: 'official-r1',
      risk: 'write',
      source: 'recorded://feishu',
    },
  ]);
  const module = new IntegrationsFoundationModule(
    new IntegrationApplicationService({
      feishu,
      repository,
      secrets: new FakeKmsSecretStore(),
    }),
    { adminActorIds: ['catalog-admin'] }
  );
  await module.execute({
    context,
    idempotencyKey: 'create-feishu-admin-gate',
    input: {
      action: 'create_connection',
      payload: {
        credential: { scope: ['docx:document'], value: 'uat-secret' },
        id: 'feishu-admin-gate',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
    },
  });

  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'owner-sync-denied',
      input: {
        action: 'sync_feishu_tools',
        payload: { connectionId: 'feishu-admin-gate' },
      },
    }),
    (error) =>
      error instanceof IntegrationError && error.code === 'ADMIN_REQUIRED'
  );
  const [draft] = (await module.execute({
    context: { ...context, userId: 'catalog-admin' },
    idempotencyKey: 'admin-sync-allowed',
    input: {
      action: 'sync_feishu_tools',
      payload: { connectionId: 'feishu-admin-gate' },
    },
  })) as Array<{ id: string; revision: string; status: string }>;
  assert.equal(draft?.status, 'draft');
  assert.deepEqual(
    await module.query({
      context,
      input: {
        action: 'feishu_tool_catalog',
        payload: { connectionId: 'feishu-admin-gate' },
      },
    }),
    []
  );
  await module.execute({
    context: { ...context, userId: 'catalog-admin' },
    idempotencyKey: 'admin-publish-allowed',
    input: {
      action: 'publish_feishu_tool',
      payload: { revisionId: draft!.revision, toolId: draft!.id },
    },
  });
  const catalog = (await module.query({
    context,
    input: {
      action: 'feishu_tool_catalog',
      payload: { connectionId: 'feishu-admin-gate' },
    },
  })) as Array<{ status: string }>;
  assert.deepEqual(catalog.map((revision) => revision.status), ['published']);
  await assert.rejects(
    module.query({
      context,
      input: { action: 'admin_feishu_tool_catalog', payload: {} },
    }),
    (error) =>
      error instanceof IntegrationError && error.code === 'ADMIN_REQUIRED'
  );
  const adminCatalog = (await module.query({
    context: { ...context, userId: 'catalog-admin' },
    input: { action: 'admin_feishu_tool_catalog', payload: {} },
  })) as Array<{ compatibility: { status: string }; schemaHash: string }>;
  assert.equal(adminCatalog[0]?.compatibility.status, 'compatible');
  assert.equal(adminCatalog[0]?.schemaHash.length, 64);

  feishu.setTools([
    {
      id: 'docx.v1.document.read',
      inputSchema: {
        properties: { document_id: { type: 'string' } },
        type: 'object',
      },
      remoteRevision: 'official-r1',
      risk: 'read',
      source: 'recorded://feishu',
    },
  ]);
  const synchronized = (await module.execute({
    context: { ...context, userId: 'catalog-admin' },
    idempotencyKey: 'admin-sync-publish-allowed',
    input: {
      action: 'sync_publish_feishu_tools',
      payload: { connectionId: 'feishu-admin-gate' },
    },
  })) as { publishedRevisionCount: number };
  assert.equal(synchronized.publishedRevisionCount, 1);

  await module.execute({
    context,
    idempotencyKey: 'create-feishu-user-connection',
    input: {
      action: 'create_connection',
      payload: {
        credential: { scope: ['docx:document'], value: 'user-uat-secret' },
        id: 'feishu-user-connection',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
    },
  });
  const executeInput = {
    action: 'execute_feishu_intent',
    payload: {
      arguments: { title: '周内容计划' },
      connectionId: 'feishu-user-connection',
      fields: ['title'],
      sideEffect: 'delete',
      source: 'autonomous',
      toolId: 'docx.v1.document.create',
    },
  };
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'execute-before-feishu-verification',
      input: executeInput,
    }),
    (error) =>
      error instanceof IntegrationError && error.code === 'CREDENTIAL_UNVERIFIED'
  );
  const verified = (await module.execute({
    context,
    idempotencyKey: 'verify-feishu-user-connection',
    input: {
      action: 'verify_feishu_connection',
      payload: { connectionId: 'feishu-user-connection' },
    },
  })) as {
    capabilityEvidence: Record<string, unknown>;
    credential: { status: string };
    grantedCapabilities: string[];
  };
  assert.equal(verified.credential.status, 'active');
  assert.deepEqual(verified.grantedCapabilities, ['mcp.tools']);
  assert.ok(verified.capabilityEvidence['mcp.tools']);
  feishu.queueCallResult({ objectId: 'doc-a', status: 'ok' });
  const executed = (await module.execute({
    context,
    idempotencyKey: 'execute-after-feishu-verification',
    input: executeInput,
  })) as { intent: { sideEffect: string; source: string }; status: string };
  assert.equal(executed.status, 'completed');
  feishu.queueCallResult({
    errorCode: 'transport_after_write',
    status: 'unknown',
  });
  const unknownWrite = (await module.execute({
    context,
    idempotencyKey: 'execute-feishu-write-unknown',
    input: {
      ...executeInput,
      payload: {
        ...executeInput.payload,
        arguments: { title: '待对账内容计划' },
      },
    },
  })) as { intent: { id: string }; status: string };
  assert.equal(unknownWrite.status, 'unknown');
  feishu.queueReconciliationResult({
    objectId: 'doc-reconciled',
    status: 'completed',
  });
  const reconciled = (await module.execute({
    context,
    idempotencyKey: 'reconcile-feishu-write-unknown',
    input: {
      action: 'reconcile_feishu_intent',
      payload: { intentId: unknownWrite.intent.id },
    },
  })) as { intent: { effectState: string }; status: string };
  assert.equal(reconciled.status, 'completed');
  assert.equal(reconciled.intent.effectState, 'settled');
  assert.equal(feishu.calls().length, 2);
  assert.equal(feishu.reconciliations().length, 1);
  assert.equal(executed.intent.sideEffect, 'create');
  assert.equal(executed.intent.source, 'explicit_user');

  await module.execute({
    context,
    idempotencyKey: 'create-expired-feishu-connection',
    input: {
      action: 'create_connection',
      payload: {
        credential: {
          expiresAt: '2026-01-01T00:00:00.000Z',
          scope: ['docx:document'],
          value: 'expired-uat-secret',
        },
        id: 'expired-feishu-connection',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
    },
  });
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'verify-expired-feishu-connection',
      input: {
        action: 'verify_feishu_connection',
        payload: { connectionId: 'expired-feishu-connection' },
      },
    }),
    (error) =>
      error instanceof IntegrationError &&
      error.code === 'CONNECTION_UNAVAILABLE'
  );
});
