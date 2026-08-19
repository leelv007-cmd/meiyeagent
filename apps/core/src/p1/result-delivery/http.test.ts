import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createCoreServer } from '../../server.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { AssistedReceiptService } from './assisted-receipt-service.js';
import { MemoryAssistedReceiptRepository } from './assisted-receipt-repository.js';
import { ResultDeliveryFoundationModule } from './foundation-module.js';
import { ResultDeliveryProjectionService } from './result-delivery-projection-service.js';

test('result-delivery assisted and projection actions are reachable over shared HTTP seam', async (t) => {
  const resultCommands: Array<{ action: string; input: unknown }> = [];
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  const module = new ResultDeliveryFoundationModule(
    {
      async firstAdopt() {
        throw new Error('not used');
      },
      async reviseContentPackageVisuals() {
        throw new Error('not used');
      },
    },
    {
      assistedReceipts: new AssistedReceiptService(
        new MemoryAssistedReceiptRepository(),
      ),
      projections: new ResultDeliveryProjectionService({
        async hasMembership(userId, workspaceId) {
          return userId === 'owner-a' && workspaceId === 'workspace-a';
        },
        async listContentPackages() {
          return [];
        },
        async listCreativeAssets() {
          return [];
        },
        async listCreativeJobs() {
          return [];
        },
        async listCreativeWorks() {
          return [];
        },
        async listLegacyCanvasWorks() {
          return [];
        },
        async listTaskEvents() {
          return [];
        },
        async listTasks() {
          return [];
        },
      }),
      commands: {
        async adopt(_context, input) {
          resultCommands.push({ action: 'result_adopt', input });
          return { id: 'package-http-1', revision: 1 };
        },
        async adjust(_context, input) {
          resultCommands.push({ action: 'result_adjust', input });
          return { job: { id: 'adjusted-job-http-1' } };
        },
        async prepareAdjust(_context, input) {
          resultCommands.push({ action: 'result_adjust_prepare', input });
          return {
            quoteIntent: {
              catalogModelId: 'image-model-1',
              operation: 'image.generate',
              quantity: 1,
            },
            work: { id: 'derived-work-http-1' },
          };
        },
        async exportPackage(_context, input) {
          resultCommands.push({ action: 'result_export', input });
          return {
            artifactAssetId: 'artifact-http-1',
            downloadUrl:
              '/api/core/p1/assets?objectKey=workspace-a%2Fgenerated%2Fartifact.zip',
            receiptId: 'receipt-export-http-1',
          };
        },
      },
    },
  );
  const server = createCoreServer({
    p1ApplicationService: new P1ApplicationService(foundation, {
      operations: [module],
    }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'result-delivery-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const prepared = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'assisted-prepare-http-1' },
    body: JSON.stringify({
      module: 'result-delivery',
      action: 'assisted_prepare',
      payload: {
        contentPackageRevision: 1,
        exportReceiptId: 'export-http-1',
        id: 'receipt-http-1',
        packageId: 'package-http-1',
        occurredAt: '2026-07-20T00:00:00.000Z',
        platform: 'xiaohongshu',
        variantVersionId: 'version-http-1',
      },
    }),
  });
  assert.equal(prepared.status, 200);
  assert.equal(
    ((await prepared.json()) as { data: { revision: number } }).data.revision,
    0,
  );

  const handedOver = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': 'assisted-hand-over-http-1' },
    body: JSON.stringify({
      module: 'result-delivery',
      action: 'assisted_hand_over',
      payload: {
        receiptId: 'receipt-http-1',
        expectedRevision: 0,
        occurredAt: '2026-07-20T00:01:00.000Z',
        linkToken: 'handoff-token-http-000001',
        binding: {
          accountId: 'account-http-1',
          approvalReceiptId: 'approval-http-1',
          contentPackageRevision: 1,
          costRange: { currency: 'CNY', minAmount: 0, maxAmount: 10 },
          packageId: 'package-http-1',
          platform: 'xiaohongshu',
          purpose: 'publish_current_variant',
          responsibilityRole: 'self_publish',
          scheduledAt: '2026-07-20T00:05:00.000Z',
          variantVersionId: 'version-http-1',
          workspaceId: 'workspace-a',
        },
      },
    }),
  });
  assert.equal(handedOver.status, 200);

  for (const expectedKind of ['ok', 'consumed']) {
    const consumed = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': 'assisted-consume-http-1',
      },
      body: JSON.stringify({
        module: 'result-delivery',
        action: 'assisted_consume_handoff',
        payload: {
          token: 'handoff-token-http-000001',
          now: '2026-07-20T00:02:00.000Z',
        },
      }),
    });
    assert.equal(consumed.status, 200);
    const response = (await consumed.json()) as {
      data: Record<string, unknown>;
    };
    assert.equal(response.data.kind, expectedKind);
    if (expectedKind === 'consumed') {
      assert.deepEqual(response.data, { kind: 'consumed' });
    }
  }

  const receipt = await fetch(`${base}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      module: 'result-delivery',
      action: 'assisted_get',
      payload: { receiptId: 'receipt-http-1' },
    }),
  });
  assert.equal(receipt.status, 200);
  assert.equal(
    (
      (await receipt.json()) as {
        data: { receipt: { packageId: string } };
      }
    ).data.receipt.packageId,
    'package-http-1',
  );

  const resolved = await fetch(`${base}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      module: 'result-delivery',
      action: 'result_target_resolve',
      payload: { target: { workId: 'missing-work' } },
    }),
  });
  assert.equal(resolved.status, 200);
  assert.equal(
    ((await resolved.json()) as { data: { kind: string } }).data.kind,
    'not_found',
  );

  for (const [action, payload] of [
    [
      'result_adopt',
      {
        expectedRevision: 0,
        selection: { copyAssetId: 'copy-1', kind: 'copy' },
        workId: 'work-1',
      },
    ],
    [
      'result_adjust_prepare',
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '调整语气',
        source: { baseJobId: 'job-1', kind: 'legacy_job' },
        workId: 'work-1',
      },
    ],
    [
      'result_adjust',
      {
        billingQuoteId: 'quote-1',
        derivedWorkId: 'derived-work-http-1',
        source: { baseJobId: 'job-1', kind: 'legacy_job' },
      },
    ],
    [
      'result_export',
      {
        expectedRevision: 1,
        packageId: 'package-http-1',
        platform: 'xiaohongshu',
      },
    ],
  ] as const) {
    const response = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': `${action}-http-1`,
      },
      body: JSON.stringify({ module: 'result-delivery', action, payload }),
    });
    const responseBody = await response.text();
    assert.equal(
      response.status,
      200,
      `${action} must be public over HTTP: ${responseBody}`,
    );
  }
  assert.deepEqual(
    resultCommands.map(({ action }) => action),
    [
      'result_adopt',
      'result_adjust_prepare',
      'result_adjust',
      'result_export',
    ],
  );
});
