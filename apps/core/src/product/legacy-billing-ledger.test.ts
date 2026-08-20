import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CopyProviderRequest } from './copy-provider.js';
import { DomainError, ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../..');

/**
 * Production files allowed to append a usage row.
 *
 * Cutover/foundation projections rebuild the legacy ProductState shape from
 * the P1 ledger. They are not origin writers: every row they write carries
 * the `foundation:` id prefix (or is a memory-only foundation event).
 *
 * P0 product-service must not appear here. GrantLot + ProductUsageLedger
 * originate merchant credit writes.
 */
const USAGE_ROW_WRITERS = [
  'apps/core/src/p1/cutover/execution-service.ts',
  'apps/core/src/p1/foundation/memory-repository.ts',
  'apps/core/src/p1/foundation/postgres-repository.ts',
] as const;

/** memory-repository holds no entitlement, so this list is one shorter. */
const ENTITLEMENT_WRITERS = [
  'apps/core/src/p1/cutover/execution-service.ts',
  'apps/core/src/p1/foundation/postgres-repository.ts',
] as const;

const USAGE_EVENT_APPEND = /\busageEvents\.push\s*\(/u;
const ENTITLEMENT_MUTATION =
  /\bentitlement(?:\.[A-Za-z]+|\[[^\]]+\])(?:\.[A-Za-z]+)?\s*(?:\+=|-=|=(?!=))/u;

function childSourceRoots(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'src'))
    .filter((path) => existsSync(path));
}

const productionSourceRoots = [
  ...childSourceRoots(join(repositoryRoot, 'apps')),
  ...childSourceRoots(join(repositoryRoot, 'packages')),
  join(repositoryRoot, 'mkfast-template-main/src'),
];

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

test('usage rows are appended only by P1 cutover/foundation projections', () => {
  assert.deepEqual(filesMatching(USAGE_EVENT_APPEND), [...USAGE_ROW_WRITERS]);
});

test('entitlement is moved only by P1 cutover/foundation projections', () => {
  assert.deepEqual(filesMatching(ENTITLEMENT_MUTATION), [
    ...ENTITLEMENT_WRITERS,
  ]);
});

test('P0 product-service has no writable legacy billing ledger', () => {
  const source = readFileSync(join(here, 'product-service.ts'), 'utf8');
  assert.doesNotMatch(source, /LegacyBillingLedger/);
  assert.doesNotMatch(source, /this\.ledger\./);
  assert.ok(
    existsSync(join(here, 'legacy-billing-ledger.ts')) === false,
    'writable LegacyBillingLedger module must stay deleted'
  );
});

const merchant = {
  actor: 'user' as const,
  correlationId: 'corr-legacy-billing-shrink',
  userId: 'user-a',
  workspaceId: 'workspace-a',
};

function copyCommand() {
  return {
    type: 'generate_copy' as const,
    brief: {
      assetIds: ['asset-real-1'],
      conversionGoal: '预约到店',
      hook: '阴天也透亮的猫眼',
      platform: 'xiaohongshu' as const,
      projectId: 'project-cat-eye',
      scenario: '项目种草',
      tone: '口语、克制',
    },
  };
}

test('ProductService execute does not originate usage rows or move entitlement', async () => {
  const repository = new MemoryProductRepository();
  repository.grantMembership('user-a', 'workspace-a');
  const provider = {
    name: 'recorded-copy',
    model: 'recorded-v1',
    region: 'local' as const,
    async generate(request: CopyProviderRequest) {
      return ['到店体验', '服务细节', '预约行动'].map((angle) => ({
        assetOrder: request.brief.assetIds,
        body: `${request.brief.hook}，重点介绍${angle}。`,
        conversionHook: angle,
        title: `${request.brief.hook}｜${angle}`,
        topics: ['杭州美业'],
      }));
    },
  };
  const service = new ProductService({
    repository,
    copyProviders: { domestic: provider, standard: provider },
  });

  await service.execute(
    merchant,
    {
      type: 'confirm_store',
      store: {
        name: '暮色美甲',
        city: '杭州',
        district: '拱墅区',
        address: '湖墅南路 88 号',
        booking: '提前一天预约',
        brandVoice: '专业、克制、像熟客推荐',
        prohibitions: ['不承诺疗效', '不虚构价格'],
        accounts: [{ platform: 'xiaohongshu', nickname: '暮色美甲杭州店' }],
        projects: [
          {
            id: 'project-cat-eye',
            name: '透亮猫眼',
            price: 299,
            durationMinutes: 90,
            confirmed: true,
          },
        ],
        regulated: false,
      },
    },
    'confirm-store'
  );
  await service.execute(
    merchant,
    {
      type: 'add_asset',
      asset: {
        id: 'asset-real-1',
        objectKey: 'workspace-a/assets/cat-eye.jpg',
        mediaType: 'image',
        sourceType: 'real',
        tags: ['猫眼', '显白'],
        rightsOwner: '暮色美甲',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        minorStatus: 'none',
      },
    },
    'asset-upload'
  );
  await service.execute(
    merchant,
    {
      type: 'authorize_asset',
      assetId: 'asset-real-1',
      consentScope: 'public_marketing',
      rightsEvidence: 'owner-consent-asset-real-1',
    },
    'asset-consent'
  );

  const before = await service.bootstrap(merchant);
  const generated = await service.execute(
    merchant,
    copyCommand(),
    'copy-no-legacy-write'
  );
  assert.equal(generated.output.candidateIds?.length, 3);
  assert.deepEqual(generated.state.usageEvents, before.usageEvents);
  assert.deepEqual(generated.state.entitlement, before.entitlement);

  const weekly = await service.execute(
    merchant,
    { type: 'create_weekly_set', contentId: generated.output.candidateIds![0]! },
    'weekly-no-legacy-write'
  );
  assert.deepEqual(weekly.state.entitlement, before.entitlement);
  assert.deepEqual(weekly.state.usageEvents, before.usageEvents);

  await service.execute(
    merchant,
    { type: 'select_content', contentId: generated.output.candidateIds![0]! },
    'copy-select'
  );
  const handoff = await service.execute(
    merchant,
    {
      type: 'create_handoff',
      contentId: generated.output.candidateIds![0]!,
      platform: 'xiaohongshu',
    },
    'handoff-no-legacy-write'
  );
  assert.ok(handoff.output.packageId);
  assert.equal(
    handoff.state.entitlement.package.remaining,
    before.entitlement.package.remaining
  );
  assert.deepEqual(handoff.state.usageEvents, before.usageEvents);
});

test('production-shaped ProductService still refuses retired billable generation', async () => {
  const repository = new MemoryProductRepository();
  repository.grantMembership('user-a', 'workspace-a');
  const service = new ProductService({
    repository,
    legacyBillingReadOnly: true,
  });
  await assert.rejects(
    service.execute(merchant, copyCommand(), 'retired-copy'),
    (error: unknown) =>
      error instanceof DomainError && error.code === 'LEGACY_BILLING_RETIRED'
  );
  assert.equal((await service.bootstrap(merchant)).usageEvents.length, 0);
});
