import { createHash } from 'node:crypto';
import type { ProductContext, ProductState } from '@meiye/contracts';
import type {
  RelationFact,
  RelationFactKind,
} from '../p1/foundation/domain.js';
import { mapLegacyProductState } from '../p1/cutover/legacy-mapper.js';
import { hydrateExampleStores } from './example-stores.js';

interface ProjectionEntityOrder {
  store?: string;
  storeDraft?: string;
  qualification?: string;
  projects: string[];
  assets: string[];
  contents: string[];
  contentVariants: Record<string, string[]>;
  variantVersions: Record<string, string[]>;
  storyboards: string[];
  videoJobs: string[];
  videoArtifactShells: string[];
  videoRenderEvidence: string[];
  videoArtifacts: string[];
  complianceResults: string[];
  agentRuns: string[];
  toolCalls: string[];
  handoffPackages: string[];
  preflightEvents: string[];
  responsibilityConfirmations: string[];
  usageEvents: string[];
  auditEvents: string[];
}

interface ProductProjectionMeta {
  workspaceId: string;
  exampleStores: ProductState['exampleStores'];
  operationalEvidence: ProductState['operationalEvidence'];
  entitlement: ProductState['entitlement'];
  enforcement: ProductState['enforcement'];
  entityOrder: ProjectionEntityOrder;
  updatedAt: string;
}

interface ProductProjectionMetaRevisionData extends Record<string, unknown> {
  recordType: 'product_projection_meta_revision';
  revisionNumber: number;
  schemaVersion: 1;
  meta: ProductProjectionMeta;
  metaHash: string;
}

interface ProductEntityRevisionData extends Record<string, unknown> {
  recordType: 'product_entity_revision';
  factKind: RelationFactKind;
  logicalFactId: string;
  parentLogicalFactId: string | null;
  revisionNumber: number;
  sequence: number | null;
  value: Record<string, unknown>;
  valueHash: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

function valueHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function canonicalLogicalId(legacyId: string) {
  return legacyId.startsWith('legacy:')
    ? `product:${legacyId.slice('legacy:'.length)}`
    : legacyId;
}

function logicalId(kind: RelationFactKind, sourceId: string) {
  return `product:${kind}:${sourceId}`;
}

function record(value: object) {
  return structuredClone(value) as Record<string, unknown>;
}

function stateEntityValues(state: ProductState) {
  const values = new Map<string, Record<string, unknown>>();
  const set = (kind: RelationFactKind, sourceId: string, value?: object) => {
    if (value) values.set(logicalId(kind, sourceId), record(value));
  };
  if (state.store) {
    const { projects: _projects, ...store } = state.store;
    set('store', 'profile', store);
  }
  set('store', 'draft', state.storeDraft);
  set('store', 'qualification', state.qualification);
  for (const project of state.store?.projects ?? []) {
    set('project', project.id, project);
  }
  for (const asset of state.assets) set('asset_rights', asset.id, asset);
  for (const content of state.contents) {
    const { variants: _variants, ...contentFact } = content;
    set('content', content.id, contentFact);
    for (const variant of content.variants) {
      const { versions: _versions, ...variantFact } = variant;
      set('platform_variant', variant.id, variantFact);
      for (const version of variant.versions) {
        set('content_version', version.id, version);
      }
    }
  }
  for (const storyboard of state.storyboards) {
    set('storyboard', storyboard.id, storyboard);
  }
  for (const job of state.videoJobs) set('video_job', job.id, job);
  for (const shell of state.videoArtifactShells) {
    set('video_job', `artifact-shell:${shell.id}`, shell);
  }
  for (const evidence of state.videoRenderEvidence) {
    set('video_render_evidence', evidence.id, evidence);
  }
  for (const asset of state.videoArtifacts) set('owned_asset', asset.id, asset);
  for (const handoff of state.handoffPackages) {
    set('publish_package', handoff.id, handoff);
    if (handoff.status === 'published') {
      set('publish_record', handoff.id, handoff);
    }
  }
  for (const event of state.usageEvents) set('usage_event', event.id, event);
  return values;
}

function projectionEntityOrder(state: ProductState): ProjectionEntityOrder {
  return {
    ...(state.store ? { store: logicalId('store', 'profile') } : {}),
    ...(state.storeDraft ? { storeDraft: logicalId('store', 'draft') } : {}),
    ...(state.qualification
      ? { qualification: logicalId('store', 'qualification') }
      : {}),
    projects: (state.store?.projects ?? []).map((item) =>
      logicalId('project', item.id)
    ),
    assets: state.assets.map((item) => logicalId('asset_rights', item.id)),
    contents: state.contents.map((item) => logicalId('content', item.id)),
    contentVariants: Object.fromEntries(
      state.contents.map((content) => [
        logicalId('content', content.id),
        content.variants.map((variant) =>
          logicalId('platform_variant', variant.id)
        ),
      ])
    ),
    variantVersions: Object.fromEntries(
      state.contents.flatMap((content) =>
        content.variants.map((variant) => [
          logicalId('platform_variant', variant.id),
          variant.versions.map((version) =>
            logicalId('content_version', version.id)
          ),
        ])
      )
    ),
    storyboards: state.storyboards.map((item) =>
      logicalId('storyboard', item.id)
    ),
    videoJobs: state.videoJobs.map((item) => logicalId('video_job', item.id)),
    videoArtifactShells: state.videoArtifactShells.map((item) =>
      logicalId('video_job', `artifact-shell:${item.id}`)
    ),
    videoRenderEvidence: state.videoRenderEvidence.map((item) =>
      logicalId('video_render_evidence', item.id)
    ),
    videoArtifacts: state.videoArtifacts.map((item) =>
      logicalId('owned_asset', item.id)
    ),
    complianceResults: state.complianceResults.map((item) =>
      logicalId('audit', `compliance:${item.id}`)
    ),
    agentRuns: state.agentRuns.map((item) =>
      logicalId('audit', `agent-run:${item.id}`)
    ),
    toolCalls: state.toolCalls.map((item) =>
      logicalId('audit', `tool-call:${item.id}`)
    ),
    handoffPackages: state.handoffPackages.map((item) =>
      logicalId('publish_package', item.id)
    ),
    preflightEvents: state.preflightEvents.map((item) =>
      logicalId('audit', `preflight:${item.id}`)
    ),
    responsibilityConfirmations: state.responsibilityConfirmations.map(
      (item) => logicalId('audit', `responsibility:${item.id}`)
    ),
    usageEvents: state.usageEvents.map((item) =>
      logicalId('usage_event', item.id)
    ),
    auditEvents: state.auditEvents.map((item) =>
      logicalId('audit', `audit:${item.id}`)
    ),
  };
}

function parseMetaRevision(
  fact: Pick<RelationFact, 'data'>
): ProductProjectionMetaRevisionData | null {
  const data = fact.data;
  if (
    data.recordType !== 'product_projection_meta_revision' ||
    data.schemaVersion !== 1 ||
    typeof data.revisionNumber !== 'number' ||
    !Number.isInteger(data.revisionNumber) ||
    data.revisionNumber < 1 ||
    typeof data.metaHash !== 'string' ||
    !data.meta ||
    typeof data.meta !== 'object'
  ) {
    return null;
  }
  return data as ProductProjectionMetaRevisionData;
}

function parseEntityRevision(
  fact: Pick<RelationFact, 'data'>
): ProductEntityRevisionData | null {
  const data = fact.data;
  if (
    data.recordType === 'product_entity_revision' &&
    data.factKind === 'lead'
  ) {
    // Fail closed: historical CRM projection rows stay unreadable after D-144.
    return null;
  }
  if (
    data.recordType !== 'product_entity_revision' ||
    typeof data.factKind !== 'string' ||
    typeof data.logicalFactId !== 'string' ||
    !('parentLogicalFactId' in data) ||
    typeof data.revisionNumber !== 'number' ||
    !Number.isInteger(data.revisionNumber) ||
    data.revisionNumber < 1 ||
    typeof data.valueHash !== 'string' ||
    !data.value ||
    typeof data.value !== 'object'
  ) {
    return null;
  }
  return data as ProductEntityRevisionData;
}

export function createProductRelationRevisionFacts(
  state: ProductState,
  revisionNumber: number,
  context: ProductContext
) {
  const entityValues = stateEntityValues(state);
  const mapped = mapLegacyProductState(state, state.updatedAt).facts;
  if (state.storeDraft) {
    mapped.push({
      createdAt: state.storeDraft.createdAt,
      data: record(state.storeDraft),
      id: 'legacy:store:draft',
      kind: 'store',
      legacySource: `product_states:${state.workspaceId}`,
      mappingConfidence: 'exact',
    });
  }
  const entityFacts = mapped.map((fact): RelationFact => {
    const currentLogicalId = canonicalLogicalId(fact.id);
    const currentParentId = fact.parentId
      ? canonicalLogicalId(fact.parentId)
      : undefined;
    const value =
      fact.kind === 'audit'
        ? fact.data
        : (entityValues.get(currentLogicalId) ?? fact.data);
    const hash = valueHash({
      kind: fact.kind,
      logicalFactId: currentLogicalId,
      parentId: currentParentId ?? null,
      sequence: fact.sequence ?? null,
      value,
    });
    return {
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: state.updatedAt,
      data: {
        factKind: fact.kind,
        logicalFactId: currentLogicalId,
        parentLogicalFactId: currentParentId ?? null,
        recordType: 'product_entity_revision',
        revisionNumber,
        sequence: fact.sequence ?? null,
        value: structuredClone(value),
        valueHash: hash,
      },
      id: `p1:${currentLogicalId.slice('product:'.length)}:revision:${revisionNumber}:${hash.slice(0, 16)}`,
      kind: fact.kind,
      mappingConfidence: 'exact',
      ...(currentParentId ? { parentId: currentParentId } : {}),
      workspaceId: state.workspaceId,
    };
  });
  const meta: ProductProjectionMeta = {
    enforcement: structuredClone(state.enforcement),
    entitlement: structuredClone(state.entitlement),
    entityOrder: projectionEntityOrder(state),
    exampleStores: structuredClone(state.exampleStores),
    operationalEvidence: structuredClone(state.operationalEvidence),
    updatedAt: state.updatedAt,
    workspaceId: state.workspaceId,
  };
  const metaHash = valueHash(meta);
  const metaFact: RelationFact = {
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: state.updatedAt,
    data: {
      meta,
      metaHash,
      recordType: 'product_projection_meta_revision',
      revisionNumber,
      schemaVersion: 1,
    },
    id: `p1:product-meta:revision:${revisionNumber}:${metaHash.slice(0, 16)}`,
    kind: 'audit',
    mappingConfidence: 'exact',
    workspaceId: state.workspaceId,
  };
  return { entityFacts, metaFact };
}

export function rebuildProductStateFromRelationFacts(
  legacyBaseline: ProductState | null,
  facts: Array<Pick<RelationFact, 'data'>>
) {
  const latestMeta = facts
    .map(parseMetaRevision)
    .filter((value): value is ProductProjectionMetaRevisionData => value !== null)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
  if (!latestMeta) {
    return legacyBaseline ? structuredClone(legacyBaseline) : null;
  }
  if (valueHash(latestMeta.meta) !== latestMeta.metaHash) {
    throw new Error('Product projection meta hash does not match its revision.');
  }
  const latestValues = new Map<string, ProductEntityRevisionData>();
  for (const revision of facts
    .map(parseEntityRevision)
    .filter((value): value is ProductEntityRevisionData => value !== null)
    .filter((value) => value.revisionNumber <= latestMeta.revisionNumber)) {
    const existing = latestValues.get(revision.logicalFactId);
    if (!existing || existing.revisionNumber < revision.revisionNumber) {
      latestValues.set(revision.logicalFactId, revision);
    }
  }
  const baselineValues = legacyBaseline
    ? stateEntityValues({
        ...legacyBaseline,
        assets: legacyBaseline.assets ?? [],
        contents: legacyBaseline.contents ?? [],
        handoffPackages: legacyBaseline.handoffPackages ?? [],
        storyboards: legacyBaseline.storyboards ?? [],
        usageEvents: legacyBaseline.usageEvents ?? [],
        videoArtifactShells: legacyBaseline.videoArtifactShells ?? [],
        videoArtifacts: legacyBaseline.videoArtifacts ?? [],
        videoJobs: legacyBaseline.videoJobs ?? [],
        videoRenderEvidence: legacyBaseline.videoRenderEvidence ?? [],
      })
    : new Map<string, Record<string, unknown>>();
  const read = <T>(id: string | undefined): T | undefined => {
    if (!id) return undefined;
    const revision = latestValues.get(id);
    if (revision) {
      const factHash = valueHash({
        kind: revision.factKind,
        logicalFactId: revision.logicalFactId,
        parentId: revision.parentLogicalFactId,
        sequence: revision.sequence,
        value: revision.value,
      });
      if (factHash !== revision.valueHash) {
        throw new Error(`Product entity hash does not match revision ${id}.`);
      }
      return structuredClone(revision.value) as T;
    }
    const baseline = baselineValues.get(id);
    return baseline ? (structuredClone(baseline) as T) : undefined;
  };
  const readRequired = <T>(id: string) => {
    const value = read<T>(id);
    if (!value) throw new Error(`Product projection is missing entity ${id}.`);
    return value;
  };
  const readMany = <T>(ids: string[]) => ids.map((id) => readRequired<T>(id));
  const order = latestMeta.meta.entityOrder;
  const storeFact = read<
    Omit<NonNullable<ProductState['store']>, 'projects'>
  >(order.store);
  const store = storeFact
    ? {
        ...storeFact,
        projects: readMany<
          NonNullable<ProductState['store']>['projects'][number]
        >(order.projects),
      }
    : undefined;
  const contents = order.contents.map((contentId) => {
    const content = readRequired<
      Omit<ProductState['contents'][number], 'variants'>
    >(contentId);
    const variants = (order.contentVariants[contentId] ?? []).map(
      (variantId) => {
        const variant = readRequired<
          Omit<ProductState['contents'][number]['variants'][number], 'versions'>
        >(variantId);
        return {
          ...variant,
          versions: readMany<
            ProductState['contents'][number]['variants'][number]['versions'][number]
          >(order.variantVersions[variantId] ?? []),
        };
      }
    );
    return { ...content, variants };
  });
  return {
    workspaceId: latestMeta.meta.workspaceId,
    exampleStores: hydrateExampleStores(latestMeta.meta),
    ...(order.storeDraft ? { storeDraft: read(order.storeDraft) } : {}),
    ...(store ? { store } : {}),
    ...(order.qualification
      ? { qualification: read(order.qualification) }
      : {}),
    assets: readMany<ProductState['assets'][number]>(order.assets),
    contents,
    storyboards: readMany<ProductState['storyboards'][number]>(
      order.storyboards
    ),
    videoJobs: readMany<ProductState['videoJobs'][number]>(order.videoJobs),
    videoArtifactShells: readMany<
      ProductState['videoArtifactShells'][number]
    >(order.videoArtifactShells),
    videoRenderEvidence: readMany<
      ProductState['videoRenderEvidence'][number]
    >(order.videoRenderEvidence),
    videoArtifacts: readMany<ProductState['videoArtifacts'][number]>(
      order.videoArtifacts
    ),
    complianceResults: readMany<ProductState['complianceResults'][number]>(
      order.complianceResults
    ),
    agentRuns: readMany<ProductState['agentRuns'][number]>(order.agentRuns),
    toolCalls: readMany<ProductState['toolCalls'][number]>(order.toolCalls),
    handoffPackages: readMany<ProductState['handoffPackages'][number]>(
      order.handoffPackages
    ),
    preflightEvents: readMany<ProductState['preflightEvents'][number]>(
      order.preflightEvents
    ),
    responsibilityConfirmations: readMany<
      ProductState['responsibilityConfirmations'][number]
    >(order.responsibilityConfirmations),
    operationalEvidence: structuredClone(latestMeta.meta.operationalEvidence),
    entitlement: structuredClone(latestMeta.meta.entitlement),
    usageEvents: readMany<ProductState['usageEvents'][number]>(
      order.usageEvents
    ),
    auditEvents: readMany<ProductState['auditEvents'][number]>(
      order.auditEvents
    ),
    enforcement: structuredClone(latestMeta.meta.enforcement),
    updatedAt: latestMeta.meta.updatedAt,
  } satisfies ProductState;
}
