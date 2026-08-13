import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPersonalWorkspaceBootstrap,
  ensurePersonalWorkspace,
  getPersonalWorkspaceId,
} from './workspace-bootstrap';
import {
  consumeWorkspaceProvisioning,
  bootstrapVerifiedWorkspaceIdentity,
  createCoreWorkspaceBootstrapper,
  createCoreWorkspaceProvisioner,
  WORKSPACE_PROVISION_MODEL_DEFAULT_KEY,
  WORKSPACE_PROVISION_TRIAL_KEY,
  type WorkspaceProvisioningOutboxPort,
  type WorkspaceProvisioningRecord,
} from './workspace-provisioning';

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

  it('persists workspace, membership, and provisioning outbox in one transaction', async () => {
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
      {
        workspaceId: 'ws_user-123',
        ownerUserId: 'user-123',
        ownerEmail: 'owner@example.test',
        ownerName: 'Mumu Nails',
        workspaceName: 'Mumu Nails',
      },
    ]);
    assert.equal(bootstrap.workspace.id, 'ws_user-123');
  });

  it('consumes trial then model-default with separate stable keys and completes status', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    const outbox = memoryProvisioningOutbox(record);
    const commands: Array<{ action: string; idempotencyKey: string }> = [];

    const result = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      {
        outbox,
        provisioner: {
          async execute(command) {
            commands.push({
              action: command.action,
              idempotencyKey: command.idempotencyKey,
            });
          },
        },
      }
    );

    assert.ok(result);
    assert.equal(result.status, 'completed');
    assert.deepEqual(commands, [
      {
        action: 'register_gift',
        idempotencyKey: WORKSPACE_PROVISION_TRIAL_KEY,
      },
      {
        action: 'provision_model_defaults',
        idempotencyKey: WORKSPACE_PROVISION_MODEL_DEFAULT_KEY,
      },
    ]);
  });

  it('returns a degraded record when model-default fails after trial completes', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    const outbox = memoryProvisioningOutbox(record);
    const result = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      {
        outbox,
        provisioner: {
          async execute(command) {
            if (command.action === 'provision_model_defaults') {
              throw Object.assign(
                new Error('Platform default models are not configured.'),
                { code: 'INVALID_STATE' }
              );
            }
          },
        },
      }
    );

    assert.ok(result);
    assert.equal(result.trialStatus, 'completed');
    assert.equal(result.modelDefaultStatus, 'pending');
    assert.notEqual(result.status, 'completed');
    assert.equal(result.lastErrorCode, 'INVALID_STATE');
  });

  it('still fails closed when the trial gift cannot be provisioned', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };

    await assert.rejects(
      consumeWorkspaceProvisioning(
        { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
        {
          outbox: memoryProvisioningOutbox(record),
          provisioner: {
            async execute() {
              throw Object.assign(
                new Error('Trial plan offer is not configured.'),
                {
                  code: 'INVALID_STATE',
                }
              );
            },
          },
        }
      ),
      /Trial plan offer is not configured/u
    );
    assert.equal(record.trialStatus, 'pending');
    assert.notEqual(record.status, 'completed');
  });

  it('retries only the unfinished model-default step after a partial failure', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    const outbox = memoryProvisioningOutbox(record);
    let failModel = true;
    const commands: string[] = [];
    const provisioner = {
      async execute(command: { action: string }) {
        commands.push(command.action);
        if (command.action === 'provision_model_defaults' && failModel) {
          failModel = false;
          throw Object.assign(new Error('Core unavailable'), {
            code: 'CORE_UNAVAILABLE',
          });
        }
      },
    };

    const first = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      { outbox, provisioner }
    );
    assert.ok(first);
    assert.equal(first.trialStatus, 'completed');
    assert.equal(first.modelDefaultStatus, 'pending');
    assert.equal(first.status, 'retry');

    const result = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      { outbox, provisioner }
    );
    assert.ok(result);
    assert.equal(result.status, 'completed');
    assert.deepEqual(commands, [
      'register_gift',
      'provision_model_defaults',
      'provision_model_defaults',
    ]);
  });

  it('does not treat another consumer processing lease as provisioned', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'processing',
      trialStatus: 'completed',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };

    const inFlight = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      {
        outbox: {
          ...memoryProvisioningOutbox(record),
          async claim() {
            return null;
          },
        },
        provisioner: { async execute() {} },
        processingPoll: { attempts: 1, intervalMs: 0 },
      }
    );
    assert.ok(inFlight);
    assert.equal(inFlight.status, 'processing');
    assert.equal(inFlight.trialStatus, 'completed');
    assert.notEqual(inFlight.status, 'completed');
  });

  it('waits for a concurrent provisioning claimant instead of failing sibling requests', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'completed',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'processing',
      trialStatus: 'completed',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    let reads = 0;
    const result = await consumeWorkspaceProvisioning(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      {
        outbox: {
          ...memoryProvisioningOutbox(record),
          async claim() {
            return null;
          },
          async get() {
            reads += 1;
            if (reads === 2) record.status = 'completed';
            return { ...record };
          },
        },
        processingPoll: { attempts: 3, intervalMs: 0 },
        provisioner: { async execute() {} },
      }
    );
    assert.equal(result?.status, 'completed');
    assert.equal(reads, 2);
  });

  it('fences a stale provisioning claimant after the lease is reclaimed', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    const outbox = memoryProvisioningOutbox(record);
    const first = await outbox.claim();
    const second = await outbox.claim();
    assert.ok(first?.claimToken);
    assert.ok(second?.claimToken);
    assert.notEqual(first.claimToken, second.claimToken);

    await assert.rejects(
      outbox.completeStep(record.workspaceId, first.claimToken, 'trial'),
      /claim was lost/iu
    );
    await outbox.completeStep(record.workspaceId, second.claimToken, 'trial');
    assert.equal(record.trialStatus, 'completed');
  });

  it('does not provision a legacy workspace without an outbox record', async () => {
    let commands = 0;
    const result = await consumeWorkspaceProvisioning(
      { ownerUserId: 'legacy-owner', workspaceId: 'legacy-workspace' },
      {
        outbox: {
          async claim() {
            return null;
          },
          async complete() {},
          async completeStep() {},
          async get() {
            return null;
          },
          async retry() {},
        },
        provisioner: {
          async execute() {
            commands += 1;
          },
        },
      }
    );

    assert.equal(result, null);
    assert.equal(commands, 0);
  });

  it('recovers Core bootstrap identity from the durable outbox after a failed attempt', async () => {
    const record: WorkspaceProvisioningRecord = {
      modelDefaultStatus: 'pending',
      ownerEmail: 'owner@example.test',
      ownerName: 'Mumu Nails',
      ownerUserId: 'user-123',
      status: 'pending',
      trialStatus: 'pending',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    };
    const calls: Array<Record<string, string>> = [];
    let failOnce = true;

    const dependencies = {
      outbox: {
        async get() {
          return { ...record };
        },
      },
      bootstrapper: {
        async bootstrap(input: Record<string, string>) {
          calls.push(input);
          if (failOnce) {
            failOnce = false;
            throw new Error('Core unavailable');
          }
        },
      },
    };

    await assert.rejects(
      bootstrapVerifiedWorkspaceIdentity(
        { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
        dependencies
      ),
      /Core unavailable/u
    );
    await bootstrapVerifiedWorkspaceIdentity(
      { ownerUserId: record.ownerUserId, workspaceId: record.workspaceId },
      dependencies
    );

    assert.deepEqual(calls, [
      {
        idempotencyKey: 'workspace-bootstrap:ws_user-123',
        ownerEmail: 'owner@example.test',
        ownerName: 'Mumu Nails',
        ownerUserId: 'user-123',
        workspaceId: 'ws_user-123',
        workspaceName: 'Mumu Nails',
      },
      {
        idempotencyKey: 'workspace-bootstrap:ws_user-123',
        ownerEmail: 'owner@example.test',
        ownerName: 'Mumu Nails',
        ownerUserId: 'user-123',
        workspaceId: 'ws_user-123',
        workspaceName: 'Mumu Nails',
      },
    ]);
  });

  it('sends trusted worker commands without tenant credential material', async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> =
      [];
    const provisioner = createCoreWorkspaceProvisioner({
      coreServiceToken: 'service-token',
      coreServiceUrl: 'http://core.test',
      fetch: async (input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: new Headers(init?.headers),
          url: String(input),
        });
        return Response.json({ data: { ok: true } });
      },
    });

    await provisioner.execute({
      action: 'provision_model_defaults',
      idempotencyKey: WORKSPACE_PROVISION_MODEL_DEFAULT_KEY,
      ownerUserId: 'user-123',
      workspaceId: 'ws_user-123',
    });

    assert.equal(requests[0]?.headers.get('x-core-actor'), 'worker');
    assert.equal(
      requests[0]?.headers.get('idempotency-key'),
      WORKSPACE_PROVISION_MODEL_DEFAULT_KEY
    );
    assert.deepEqual(requests[0]?.body, {
      action: 'provision_model_defaults',
      module: 'entitlements',
      payload: {},
    });
    assert.doesNotMatch(JSON.stringify(requests), /credential|byok|secret/iu);
  });

  it('bootstraps the Core workspace through the trusted worker boundary', async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> =
      [];
    const bootstrapper = createCoreWorkspaceBootstrapper({
      coreServiceToken: 'service-token',
      coreServiceUrl: 'http://core.test',
      fetch: async (input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: new Headers(init?.headers),
          url: String(input),
        });
        return Response.json({ data: { created: true } });
      },
    });

    await bootstrapper.bootstrap({
      idempotencyKey: 'workspace-bootstrap:ws_user-123',
      ownerEmail: 'owner@example.test',
      ownerUserId: 'user-123',
      ownerName: 'Mumu Nails',
      workspaceId: 'ws_user-123',
      workspaceName: 'Mumu Nails',
    });

    assert.equal(
      requests[0]?.url,
      'http://core.test/v1/workspaces/ws_user-123/bootstrap'
    );
    assert.equal(requests[0]?.headers.get('x-core-actor'), 'worker');
    assert.equal(
      requests[0]?.headers.get('idempotency-key'),
      'workspace-bootstrap:ws_user-123'
    );
    assert.deepEqual(requests[0]?.body, {
      name: 'Mumu Nails',
      owner: { email: 'owner@example.test', name: 'Mumu Nails' },
    });
    assert.doesNotMatch(JSON.stringify(requests), /credential|byok|secret/iu);
  });

  it('preserves the typed Core error code for durable retry diagnostics', async () => {
    const provisioner = createCoreWorkspaceProvisioner({
      coreServiceToken: 'service-token',
      coreServiceUrl: 'http://core.test',
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'P1_WRITE_DISABLED',
              message: 'New commands are owned by the legacy service.',
            },
          },
          { status: 409 }
        ),
    });

    await assert.rejects(
      provisioner.execute({
        action: 'register_gift',
        idempotencyKey: WORKSPACE_PROVISION_TRIAL_KEY,
        ownerUserId: 'user-123',
        workspaceId: 'ws_user-123',
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'P1_WRITE_DISABLED' &&
        error.message === 'New commands are owned by the legacy service.'
    );
  });
});

function memoryProvisioningOutbox(record: WorkspaceProvisioningRecord) {
  let claimSequence = 0;
  return {
    async claim() {
      if (record.status === 'completed') return null;
      record.status = 'processing';
      record.claimToken = `claim-${++claimSequence}`;
      return { ...record };
    },
    async completeStep(_workspaceId, claimToken, step) {
      assertProvisioningClaim(record, claimToken);
      if (step === 'trial') record.trialStatus = 'completed';
      else record.modelDefaultStatus = 'completed';
    },
    async complete(_workspaceId, claimToken) {
      assertProvisioningClaim(record, claimToken);
      record.status = 'completed';
      record.claimToken = null;
    },
    async get() {
      return { ...record };
    },
    async retry(_workspaceId, claimToken, errorCode) {
      if (record.claimToken !== claimToken) return;
      record.lastErrorCode = errorCode;
      record.status = 'retry';
      record.claimToken = null;
    },
  } satisfies WorkspaceProvisioningOutboxPort;
}

function assertProvisioningClaim(
  record: WorkspaceProvisioningRecord,
  claimToken: string
) {
  if (record.claimToken !== claimToken) {
    throw new Error('Verified workspace provisioning claim was lost.');
  }
}
