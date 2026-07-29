import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import { FakeKmsSecretStore } from '../integrations/secret-store.js';
import { ProductionAdminSupplyDomain } from './postgres-admin-supply-runtime.js';
import { createCredentialAccount } from './credential-account.js';
import {
  PostgresCapabilityHotAssemblyMigration,
  PostgresCapabilityHotAssemblyPort,
} from './postgres-hot-assembly.js';
import { PostgresSupplyControlPlaneRepository } from './postgres-control-plane.js';
import type { RuntimeCapabilityRevision } from './hot-assembly.js';
import {
  putCredentialSecret,
  RequestTimeSecretBroker,
} from './secret-broker.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function revision(
  revisionId: string,
  number: number,
  deploymentId: string,
  previousRevisionId?: string,
): RuntimeCapabilityRevision {
  return {
    revisionId,
    number,
    entries: [
      {
        deploymentId,
        catalogModelId: 'llm-openai',
        apiFamily: 'openai-compatible',
        channel: 'direct',
        region: 'global',
        executionChannelId: 'channel-direct',
        adapterKey: 'direct-llm',
      },
    ],
    publishedAt: `2026-07-20T00:00:0${number}.000Z`,
    ...(previousRevisionId ? { previousRevisionId } : {}),
  };
}

describe(
  'Postgres capability hot assembly',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const repository = new PostgresSupplyControlPlaneRepository(pool);
    const workspaceId = `hot-assembly-${randomUUID()}`;
    const http = new PostgresCapabilityHotAssemblyPort(
      pool,
      repository,
      workspaceId,
    );
    const worker = new PostgresCapabilityHotAssemblyPort(
      pool,
      repository,
      workspaceId,
    );

    before(async () => {
      await repository.migrate();
      const client = await pool.connect();
      try {
        await new PostgresCapabilityHotAssemblyMigration().migrate(client);
      } finally {
        client.release();
      }
    });

    after(async () => {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.query(
        'DELETE FROM p1_supply_channel_in_flight WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_channel_lifecycle WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    it('shares the new-task revision and channel admission across HTTP and Worker without restart', async () => {
      const first = revision('cap-r1', 1, 'deployment-a');
      await http.seedIfEmpty(first);
      assert.equal(await worker.getEffectiveRevisionId(), first.revisionId);

      const second = revision('cap-r2', 2, 'deployment-b', first.revisionId);
      await worker.applyCapabilityRevision(second);
      assert.equal(await http.getEffectiveRevisionId(), second.revisionId);
      assert.equal(
        await http.supportsDeployment({
          id: 'deployment-b',
          catalogModelId: 'llm-openai',
          apiFamily: 'openai-compatible',
          channel: 'direct',
          region: 'global',
          executionChannelId: 'channel-direct',
        }),
        true,
      );
      assert.equal(
        await http.supportsDeployment({
          id: 'deployment-a',
          catalogModelId: 'llm-openai',
          apiFamily: 'openai-compatible',
          channel: 'direct',
          region: 'global',
          executionChannelId: 'channel-direct',
        }),
        false,
      );

      await http.isolateChannel(
        'channel-direct',
        'operator isolated failing channel',
      );
      const isolated = await worker.getChannelLifecycle('channel-direct');
      assert.equal(
        (isolated as { lifecycleRevision?: string }).lifecycleRevision,
        'channel-direct:lifecycle:r1',
      );
      assert.equal(
        (await worker.decideAdmission('channel-direct', 'new_submit')).admitted,
        false,
      );
      assert.equal(
        (await worker.decideAdmission('channel-direct', 'in_flight')).admitted,
        true,
      );

      await worker.restoreChannel(
        'channel-direct',
        'operator restored verified channel',
      );
      const restored = await http.getChannelLifecycle('channel-direct');
      assert.equal(
        (restored as { lifecycleRevision?: string }).lifecycleRevision,
        'channel-direct:lifecycle:r2',
      );
      assert.equal(
        (await http.decideAdmission('channel-direct', 'new_submit')).admitted,
        true,
      );
      assert.equal(
        (await http.reportProcessView('http')).effectiveCapabilityRevisionId,
        (await worker.reportProcessView('job-worker'))
          .effectiveCapabilityRevisionId,
      );
    });

    it('refreshes a boot-derived capability head without replacing an operator head', async () => {
      const scopedWorkspaceId = `hot-boot-refresh-${randomUUID()}`;
      const port = new PostgresCapabilityHotAssemblyPort(
        pool,
        repository,
        scopedWorkspaceId,
      );
      const firstBoot = {
        ...revision('boot-capability:catalog-r1:first', 1, 'deployment-a'),
        bootCatalogEpoch: 1,
        reason: 'process_boot_from_runtime_capabilities',
      };
      await port.seedIfEmpty(firstBoot);

      await port.seedIfEmpty({
        ...firstBoot,
        revisionId: 'boot-capability:catalog-r1:first-with-credentials',
        entries: firstBoot.entries.map((entry) => ({
          ...entry,
          credentialAccountId: 'credential-account-a',
          credentialVersion: '1',
        })),
      });
      const reconciled = await port.getEffectiveRevision();
      assert.equal(
        reconciled?.reason,
        'reconcile_postgres_credential_account_bindings',
      );
      assert.equal(reconciled?.bootCatalogEpoch, 1);

      const secondBoot = {
        ...revision('boot-capability:catalog-r1:second', 1, 'deployment-b'),
        bootCatalogEpoch: 2,
        reason: 'process_boot_from_runtime_capabilities',
      };
      await port.seedIfEmpty(secondBoot);
      const refreshed = await port.getEffectiveRevision();
      assert.equal(refreshed?.revisionId, secondBoot.revisionId);
      assert.equal(refreshed?.number, 3);
      assert.equal(refreshed?.previousRevisionId, reconciled?.revisionId);
      assert.equal(refreshed?.entries[0]?.deploymentId, 'deployment-b');
      assert.equal(refreshed?.bootCatalogEpoch, 2);

      await port.seedIfEmpty(firstBoot);
      assert.equal(
        await port.getEffectiveRevisionId(),
        secondBoot.revisionId,
      );

      const operator = {
        ...revision('capability:operator-r3', 3, 'deployment-a'),
        previousRevisionId: refreshed?.revisionId,
        reason: 'operator_publish',
      };
      await port.applyCapabilityRevision(operator);
      await port.seedIfEmpty({
        ...secondBoot,
        revisionId: 'boot-capability:catalog-r1:third',
      });
      assert.equal(
        await port.getEffectiveRevisionId(),
        operator.revisionId,
      );
      await repository.deleteWorkspaceForTest(scopedWorkspaceId);
    });

    it('assembles the frozen credential from the shared secret store at request time', async () => {
      const credentialWorkspaceId = `credential-${randomUUID()}`;
      const secrets = new FakeKmsSecretStore();
      const stored = await putCredentialSecret({
        secrets,
        workspaceId: credentialWorkspaceId,
        credentialId: 'credential-direct',
        secretVersion: 1,
        provider: 'model',
        value: 'request-time-secret-v1',
      });
      const account = createCredentialAccount({
        id: 'credential-account:direct',
        label: 'Direct provider account',
        providerProfileId: 'provider-direct',
        type: 'model.direct',
        scope: 'platform',
        secretReference: stored.secretReference,
        version: '1',
        secretVersion: 1,
        credentialId: 'credential-direct',
        connectionId: 'platform:model.direct',
        workspaceId: credentialWorkspaceId,
        provider: 'model',
        status: 'active',
      });
      const broker = new RequestTimeSecretBroker(
        { get: async (id) => (id === account.id ? account : null) },
        secrets,
      );
      const scopedWorkspaceId = `hot-credential-${randomUUID()}`;
      const port = new PostgresCapabilityHotAssemblyPort(
        pool,
        repository,
        scopedWorkspaceId,
        broker,
      );
      await port.seedIfEmpty({
        revisionId: 'cap-credential-r1',
        number: 1,
        entries: [
          {
            deploymentId: 'deployment-direct',
            catalogModelId: 'llm-openai',
            apiFamily: 'openai-compatible',
            channel: 'direct',
            region: 'global',
            executionChannelId: 'channel-direct',
            credentialAccountId: account.id,
            credentialVersion: '1',
            adapterKey: 'direct-llm',
          },
        ],
        publishedAt: '2026-07-20T00:00:00.000Z',
      });

      const assembled = await port.assembleForRequest({
        deploymentId: 'deployment-direct',
        frozenCredentialVersion: '1',
        requiredScope: 'platform',
      });
      assert.equal(assembled.credential?.secret, 'request-time-secret-v1');
      assert.equal(assembled.credential?.version, '1');
      await repository.deleteWorkspaceForTest(scopedWorkspaceId);
    });

    it('loads the frozen adapter binding config from the PostgreSQL capability revision', async () => {
      const scopedWorkspaceId = `hot-adapter-binding-${randomUUID()}`;
      const port = new PostgresCapabilityHotAssemblyPort(
        pool,
        repository,
        scopedWorkspaceId,
      );
      await port.seedIfEmpty({
        revisionId: 'cap-adapter-binding-r2',
        number: 2,
        entries: [
          {
            deploymentId: 'deployment-hot-llm',
            catalogModelId: 'llm-openai',
            apiFamily: 'openai',
            channel: 'direct',
            region: 'global',
            executionChannelId: 'channel-hot-llm',
            providerModel: 'provider-model-hot-v2',
            endpointRevision: 'endpoint-hot-v2',
            adapterKey: 'direct-llm',
            adapterBindingRevision: 'adapter-binding-hot-v2',
            adapterConfig: {
              apiFamily: 'openai',
              baseUrl: 'https://hot-llm.example.test/v2',
              providerModel: 'provider-model-hot-v2',
              endpointRevision: 'endpoint-hot-v2',
              inputCostPerMillion: 12,
              outputCostPerMillion: 34,
              currency: 'USD',
            },
          },
        ],
        publishedAt: '2026-07-20T00:00:02.000Z',
      });

      const assembled = await port.assembleForRequest({
        deploymentId: 'deployment-hot-llm',
        frozenCapabilityRevisionId: 'cap-adapter-binding-r2',
        requiredScope: 'platform',
      });

      assert.equal(assembled.adapterBindingRevision, 'adapter-binding-hot-v2');
      assert.deepEqual(assembled.adapterConfig, {
        apiFamily: 'openai',
        baseUrl: 'https://hot-llm.example.test/v2',
        providerModel: 'provider-model-hot-v2',
        endpointRevision: 'endpoint-hot-v2',
        inputCostPerMillion: 12,
        outputCostPerMillion: 34,
        currency: 'USD',
      });
      await repository.deleteWorkspaceForTest(scopedWorkspaceId);
    });

    it('rejects a stale preview after a concurrent lifecycle transition persisted by another process', async () => {
      const channelId = `channel-stale-preview-${randomUUID()}`;
      const initial = await http.getChannelLifecycle(channelId);
      const domain = new ProductionAdminSupplyDomain({
        registry: {
          async getCurrentRegistryRevision() {
            return { executionChannels: [] };
          },
        },
        hotAssembly: http,
      } as never);
      const request = {
        context: {
          workspaceId,
          userId: 'admin-a',
          correlationId: 'corr-stale-preview',
          actor: 'admin',
        },
        action: 'isolate',
        target: { resourceType: 'channel', resourceId: channelId },
        reason: 'isolate a degraded supply channel',
        expectedRevisionId: initial.lifecycleRevision,
        idempotencyKey: `isolate-${channelId}`,
      } as const;

      await domain.preview(request);
      await worker.isolateChannel(channelId, 'concurrent operator action');

      await assert.rejects(
        domain.preview(request),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.equal(
        (await http.getChannelLifecycle(channelId)).lifecycleRevision,
        `${channelId}:lifecycle:r1`,
      );
    });

    it('atomically rejects a lifecycle command that becomes stale after execute revalidation', async () => {
      const channelId = `channel-execute-cas-${randomUUID()}`;
      const initial = await http.getChannelLifecycle(channelId);
      let armConcurrentTransition = false;
      let executeLifecycleReads = 0;
      const domain = new ProductionAdminSupplyDomain({
        registry: {
          async getCurrentRegistryRevision() {
            return { executionChannels: [] };
          },
        },
        hotAssembly: {
          async getChannelLifecycle(targetChannelId: string) {
            const snapshot = await http.getChannelLifecycle(targetChannelId);
            if (
              armConcurrentTransition &&
              (executeLifecycleReads += 1) === 2
            ) {
              await worker.isolateChannel(
                targetChannelId,
                'concurrent operator action after execute revalidation',
              );
            }
            return snapshot;
          },
          isolateChannel(
            targetChannelId: string,
            reason: string,
            options?: {
              now?: string;
              inFlightCount?: number;
              expectedLifecycleRevision?: string;
            },
          ) {
            return http.isolateChannel(targetChannelId, reason, options);
          },
        },
      } as never);
      const request = {
        context: {
          workspaceId,
          userId: 'admin-a',
          correlationId: 'corr-execute-cas',
          actor: 'admin',
        },
        action: 'isolate',
        target: { resourceType: 'channel', resourceId: channelId },
        reason: 'isolate a degraded supply channel',
        expectedRevisionId: initial.lifecycleRevision,
        idempotencyKey: `isolate-execute-cas-${channelId}`,
      } as const;
      const preview = await domain.preview(request);
      armConcurrentTransition = true;

      await assert.rejects(
        domain.execute({
          request,
          preview,
          audit: {
            actor: { userId: 'admin-a', role: 'admin' },
            permission: 'channel.lifecycle.manage',
            target: {
              kind: 'command',
              module: 'model-supply',
              action: 'isolate_channel',
              resourceId: channelId,
              resourceType: 'channel',
            },
            reason: request.reason,
            before: preview.before,
            after: preview.after,
            correlationId: request.context.correlationId,
            occurredAt: '2026-07-20T00:00:00.000Z',
          },
          idempotency: {
            workspaceId,
            key: request.idempotencyKey,
            payloadHash: request.idempotencyKey,
          },
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      const persisted = await http.getChannelLifecycle(channelId);
      assert.equal(persisted.lifecycleRevision, `${channelId}:lifecycle:r1`);
      assert.equal(
        persisted.reason,
        'concurrent operator action after execute revalidation',
      );
    });

    it('shares in-flight leases across processes and completes drain only at zero', async () => {
      const channelId = `channel-drain-${randomUUID()}`;
      const acquired = await http.acquireChannelSubmission(
        channelId,
        'attempt-in-flight-1',
      );
      assert.equal(acquired.admitted, true);
      assert.equal(acquired.inFlightCount, 1);
      assert.equal(
        (await worker.getChannelLifecycle(channelId)).inFlightCount,
        1,
      );

      await worker.startChannelDrain(channelId, 'operator drain');
      const blocked = await http.acquireChannelSubmission(
        channelId,
        'attempt-in-flight-2',
      );
      assert.equal(blocked.admitted, false);
      assert.equal(blocked.errorCode, 'channel_draining');
      await assert.rejects(
        worker.completeChannelDrain(channelId, 'premature complete'),
        /still has 1 in-flight/i,
      );

      await http.releaseChannelSubmission(channelId, 'attempt-in-flight-1');
      const drained = await worker.getChannelLifecycle(channelId);
      assert.equal(drained.mode, 'draining');
      assert.equal(drained.inFlightCount, 0);
      const completed = await worker.completeChannelDrain(
        channelId,
        'drain complete',
      );
      assert.equal(completed.mode, 'accepting');
      assert.equal(completed.inFlightCount, 0);
    });
  },
);
