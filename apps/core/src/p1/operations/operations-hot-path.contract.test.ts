import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ContentPackageDeliveryService,
} from './content-package-delivery.js';
import {
  assertOperationsHotPathContract,
  hotPathWorkspaceState,
} from './operations-hot-path.contract.js';
import { MemoryOperationsRepository } from './repository.js';
import { PendingActionsService } from '../pending-actions.js';
import { ResultDeliveryProjectionService } from '../result-delivery/result-delivery-projection-service.js';
import { createDeliveryApplication } from '../result-delivery/delivery-application.js';
import { PublishHandoffService } from './publish-handoff.js';
import { AssistedReceiptService } from '../result-delivery/assisted-receipt-service.js';
import { MemoryAssistedReceiptRepository } from '../result-delivery/assisted-receipt-repository.js';

const here = dirname(fileURLToPath(import.meta.url));

class GuardedMemoryOperationsRepository extends MemoryOperationsRepository {
  override async loadWorkspace(): Promise<never> {
    throw new Error(
      'whole-workspace load is forbidden on the operations hot path',
    );
  }

  override async saveWorkspace(): Promise<never> {
    throw new Error(
      'whole-workspace save is forbidden on the operations hot path',
    );
  }

  override async withWorkspaceLock(): Promise<never> {
    throw new Error(
      'workspace global lock is forbidden on the operations hot path',
    );
  }
}

test('Memory hot-path repository matches the shared contract without loading the workspace', async () => {
  const repository = new GuardedMemoryOperationsRepository();
  repository.seedWorkspace(hotPathWorkspaceState('workspace-a'));
  await assertOperationsHotPathContract(repository, 'workspace-a');
});

test('Memory ContentPackage OCC save does not rewrite sibling collections', async () => {
  const repository = new MemoryOperationsRepository();
  const state = hotPathWorkspaceState('workspace-a');
  repository.seedWorkspace(state);
  const current = (await repository.getContentPackage(
    'workspace-a',
    'live-package',
  ))!;
  await repository.saveContentPackageRevision({
    contentPackage: {
      ...current,
      revision: current.revision + 1,
      updatedAt: '2026-08-19T12:02:00.000Z',
    },
    expectedRevision: current.revision,
  });
  const stored = await repository.loadWorkspace('workspace-a');
  assert.equal(stored?.weeklyFacts[0]?.id, 'weekly-noise');
  assert.equal(stored?.commandReceipts[0]?.id, 'receipt-noise');
  assert.equal(stored?.contentPackages[1]?.revision, current.revision + 1);
});

test('delivery, pending, and result hot paths fail closed if they load the workspace', async () => {
  const repository = new GuardedMemoryOperationsRepository();
  repository.grantMembership('owner-a', 'workspace-a');
  repository.seedWorkspace(hotPathWorkspaceState('workspace-a'));
  const assistedReceipts = new AssistedReceiptService(
    new MemoryAssistedReceiptRepository(),
  );
  const delivery = new ContentPackageDeliveryService(repository, {
    approvalPolicy: {
      async resolve() {
        return {
          contextBundle: {
            bundleId: 'bundle-a',
            hash: 'hash-a',
            revision: 1,
          },
          policy: {
            brief: {},
            bundle: { revision: 1, workspaceId: 'workspace-a' },
            candidate: {
              assetRefs: [],
              candidateId: 'candidate-a',
              factClaims: [],
              intendedUse: 'public_content',
              workspaceId: 'workspace-a',
            },
            identityRefs: [],
            rightsRefs: [],
            sourceRefs: [],
          },
        };
      },
    },
    async capability(platform) {
      return { mode: 'assisted', platform, reason: 'test' };
    },
  });
  const application = createDeliveryApplication({
    assistedReceipts,
    delivery,
    handoff: new PublishHandoffService(repository, delivery, {
      assistedReceipts,
    }),
    repository,
  });

  await assert.rejects(
    application.preparePackage(
      {
        actor: 'owner',
        correlationId: 'hot-path',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      {
        entry: 'workbench',
        packageId: 'live-package',
        platform: 'douyin',
        variantVersionId: 'missing',
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes('whole-workspace'),
  );

  const pending = new PendingActionsService(
    { async listPendingQuestions() { return []; } },
    repository,
  );
  const pendingResult = await pending.list({
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  });
  assert.ok(
    pendingResult.some(
      (item) => 'statusKind' in item && item.statusKind === 'result_available',
    ),
  );

  const projections = new ResultDeliveryProjectionService(repository);
  const recent = await projections.listRecent({
    userId: 'owner-a',
    viewport: 'desktop',
    workspaceId: 'workspace-a',
  });
  assert.equal(recent[0]?.workId, 'work-1');
  const resolved = await projections.resolveTarget({
    target: { contentId: 'historical-package', versionId: '', workId: '' },
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  });
  assert.equal(resolved.kind, 'legacy_readonly');
});

test('delivery, pending, and result sources no longer call loadWorkspace', () => {
  const sources = [
    join('..', 'result-delivery', 'delivery-application.ts'),
    join('..', 'pending-actions.ts'),
    join('..', 'result-delivery', 'result-delivery-projection-service.ts'),
    'content-package-delivery.ts',
    'publish-handoff.ts',
  ].map((relative) =>
    readFileSync(join(here, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, ''),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /\.loadWorkspace\s*\(/u);
    assert.doesNotMatch(source, /\.saveWorkspace\s*\(/u);
    assert.doesNotMatch(source, /\.withWorkspaceLock\s*\(/u);
  }
});
