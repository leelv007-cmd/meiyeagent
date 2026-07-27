import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';
import {
  createProductRelationRevisionFacts,
  rebuildProductStateFromRelationFacts,
} from './relational-product-state.js';

const context = {
  actor: 'user' as const,
  correlationId: 'corr-rebuild',
  userId: 'user-rebuild',
  workspaceId: 'workspace-rebuild',
};

async function initialProductState() {
  const repository = new MemoryProductRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  return new ProductService(repository).bootstrap(context);
}

async function productStatesWithEntities() {
  const repository = new MemoryProductRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const service = new ProductService(repository);
  const first = await service.execute(
    context,
    {
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: '关系事实测试店',
        prohibitions: [],
        projects: [
          {
            confirmed: true,
            durationMinutes: 90,
            id: 'project-rebuild',
            name: '透亮猫眼',
            price: 299,
          },
        ],
        regulated: false,
      },
      type: 'confirm_store',
    },
    'rebuild-confirm-store'
  );
  const second = await service.execute(
    context,
    {
      asset: {
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-rebuild',
        mediaType: 'image',
        minorStatus: 'none',
        objectKey: `${context.workspaceId}/assets/rebuild.jpg`,
        rightsOwner: '关系事实测试店',
        sourceType: 'real',
        tags: ['猫眼'],
      },
      type: 'add_asset',
    },
    'rebuild-add-asset'
  );
  const third = await service.execute(
    context,
    {
      brief: {
        assetIds: ['asset-rebuild'],
        conversionGoal: '预约到店',
        hook: '阴天也透亮的猫眼',
        platform: 'xiaohongshu',
        projectId: 'project-rebuild',
        scenario: '项目种草',
        tone: '真实、克制',
      },
      type: 'generate_copy',
    },
    'rebuild-generate-copy'
  );
  return { first: first.state, second: second.state, third: third.state };
}

describe('relational product state revisions', () => {
  it('rebuilds the latest immutable entity revisions without a ProductState blob', async () => {
    const { first, second, third } = await productStatesWithEntities();
    const firstRevision = createProductRelationRevisionFacts(first, 1, context);
    const secondRevision = createProductRelationRevisionFacts(
      second,
      2,
      context
    );
    const thirdRevision = createProductRelationRevisionFacts(third, 3, context);
    const facts = [
      ...firstRevision.entityFacts,
      firstRevision.metaFact,
      ...secondRevision.entityFacts,
      secondRevision.metaFact,
      ...thirdRevision.entityFacts,
      thirdRevision.metaFact,
    ];

    const rebuilt = rebuildProductStateFromRelationFacts(null, facts);
    assert.deepEqual(rebuilt, third);
    assert.notEqual(rebuilt, third);
    assert.equal(
      facts.some((fact) => fact.data.recordType === 'product_state_revision'),
      false
    );
    assert.equal(facts.some((fact) => 'state' in fact.data), false);
    assert.ok(
      facts.some(
        (fact) =>
          fact.kind === 'store' &&
          fact.data.recordType === 'product_entity_revision'
      )
    );
    const storeFact = facts.find(
      (fact) =>
        fact.kind === 'store' &&
        fact.data.logicalFactId === 'product:store:profile'
    );
    assert.ok(storeFact);
    assert.equal('projects' in (storeFact.data.value as object), false);
    const contentFact = facts.find((fact) => fact.kind === 'content');
    assert.ok(contentFact);
    assert.equal('variants' in (contentFact.data.value as object), false);
    const variantFact = facts.find(
      (fact) => fact.kind === 'platform_variant'
    );
    assert.ok(variantFact);
    assert.equal('versions' in (variantFact.data.value as object), false);
    assert.ok(
      facts.some(
        (fact) =>
          fact.kind === 'asset_rights' &&
          fact.data.recordType === 'product_entity_revision'
      )
    );
    assert.equal(facts[0]?.actorId, context.userId);
    assert.equal(facts[0]?.correlationId, context.correlationId);
  });

  it('uses the read-only legacy baseline only before a P1 projection exists', async () => {
    const baseline = await initialProductState();

    const rebuilt = rebuildProductStateFromRelationFacts(baseline, []);

    assert.deepEqual(rebuilt, baseline);
    assert.notEqual(rebuilt, baseline);
  });

  it('ignores retired lead entity revisions at the projection parser', async () => {
    const { first } = await productStatesWithEntities();
    const revision = createProductRelationRevisionFacts(first, 1, context);
    const rebuilt = rebuildProductStateFromRelationFacts(null, [
      {
        data: {
          factKind: 'lead',
          logicalFactId: 'product:store:profile',
          parentLogicalFactId: null,
          recordType: 'product_entity_revision',
          revisionNumber: 1,
          sequence: 0,
          value: { id: 'historical-lead' },
          valueHash: 'historical-retired-value',
        },
      },
      ...revision.entityFacts,
      revision.metaFact,
    ]);

    assert.deepEqual(rebuilt, first);
  });

  it('persists abandoned content as an immutable relation revision', async () => {
    const { third } = await productStatesWithEntities();
    const generated = third.contents[0];
    assert.ok(generated);
    const abandoned = structuredClone(third);
    const abandonedContent = abandoned.contents.find(
      (content) => content.id === generated.id
    );
    assert.ok(abandonedContent);
    abandonedContent.status = 'abandoned';
    abandonedContent.selected = false;
    abandonedContent.abandonedAt = '2026-07-11T00:00:00.000Z';
    abandoned.updatedAt = '2026-07-11T00:00:00.000Z';

    const generatedRevision = createProductRelationRevisionFacts(
      third,
      1,
      context
    );
    const abandonedRevision = createProductRelationRevisionFacts(
      abandoned,
      2,
      context
    );
    const rebuilt = rebuildProductStateFromRelationFacts(null, [
      ...generatedRevision.entityFacts,
      generatedRevision.metaFact,
      ...abandonedRevision.entityFacts,
      abandonedRevision.metaFact,
    ]);

    assert.equal(
      rebuilt?.contents.find((content) => content.id === generated.id)?.status,
      'abandoned'
    );
    assert.equal(
      rebuilt?.contents.find((content) => content.id === generated.id)
        ?.abandonedAt,
      '2026-07-11T00:00:00.000Z'
    );
  });

  it('rejects a corrupt entity revision instead of silently trusting it', async () => {
    const { third } = await productStatesWithEntities();
    const revision = createProductRelationRevisionFacts(third, 1, context);
    const facts = [...revision.entityFacts, revision.metaFact];
    const asset = facts.find((fact) => fact.kind === 'asset_rights');
    assert.ok(asset);
    const corrupt = structuredClone(asset);
    (corrupt.data.value as Record<string, unknown>).rightsOwner = 'tampered';
    const corruptFacts = facts.map((fact) =>
      fact.id === corrupt.id ? corrupt : fact
    );

    assert.throws(
      () => rebuildProductStateFromRelationFacts(null, corruptFacts),
      /entity hash does not match/i
    );
  });
});
