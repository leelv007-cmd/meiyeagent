import {
  assetRevisionSchema,
  type AssetRevision,
  type ContextBundle,
  type ContextContribution,
  type ContextSourceRevisions,
  type MarketingIdentityAsset,
  type ReuseTaskSeed,
} from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { isOfficialNeutralIdentity } from '../execution-spine/creation-execution-snapshot.js';
import type { ContextBundleRepository } from '../operations/context-bundle-repository.js';
import {
  compileContextBundle,
  contextSourceChanges,
} from '../operations/context-compiler.js';
import type { ContextSourceRevisionRepository } from '../operations/context-source-revisions.js';
import {
  storeFactContextRevision,
  type StoreFactLedger,
} from '../operations/store-fact-ledger.js';
import {
  SourceContentPackageUnavailableError,
  type ExecutionSourceContentPackageResolverPort,
  type ResolvedSourceContentPackage,
} from '../execution-spine/source-content-package-resolver.js';
import type { ProductionHarnessContextPort } from './production-stage-ports.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

export class HarnessSnapshotIdentityError extends Error {
  readonly code = 'HARNESS_IDENTITY_SNAPSHOT_INVALID';
  readonly status = 409;

  constructor(readonly identityRef: string) {
    super('The execution snapshot identity is missing, inactive, or at a different revision.');
    this.name = 'HarnessSnapshotIdentityError';
  }
}

export class LedgerBackedHarnessContextPort
  implements ProductionHarnessContextPort
{
  constructor(
    private readonly facts: StoreFactLedger,
    private readonly bundles: ContextBundleRepository,
    private readonly now: () => string,
    private readonly sourceRevisionHeads?: Pick<
      ContextSourceRevisionRepository,
      'current'
    >,
    private readonly recipeRevision?: (workspaceId: string) => Promise<number>,
    private readonly reuseTasks?: {
      verifyReuseTaskSeed(
        workspaceId: string,
        seed: ReuseTaskSeed,
      ): Promise<AssetRevision>;
    },
    private readonly assetRights?: {
      resolve(input: { workspaceId: string; assetIds: string[] }): Promise<{
        knownAssetIds?: string[];
        unauthorizedAssetIds: string[];
      }>;
    },
    private readonly identities?: {
      listActive(
        workspaceId: string,
        at: string,
      ): Promise<MarketingIdentityAsset[]>;
    },
    private readonly sourceContentPackages?: ExecutionSourceContentPackageResolverPort,
  ) {}

  async compileAndFreeze(
    input: Parameters<ProductionHarnessContextPort['compileAndFreeze']>[0],
  ) {
    const existing = await this.bundles.get(
      input.request.workspaceId,
      `context-${input.workflowId}`,
    );
    if (existing) {
      return this.fence({
        ...input,
        context: await this.snapshot(input, existing),
      });
    }
    return this.compile(input, {
      expectedRevision: 0,
      idempotencyKey: `wf:${input.workflowId}:s2:context:0`,
      reason: 'Initial harness context freeze',
    });
  }

  async fence(input: Parameters<ProductionHarnessContextPort['fence']>[0]) {
    const at = this.now();
    await this.resolveSourceContentPackage(input.request);
    await this.activeIdentitiesForRequest(input.request, at);
    this.assertSnapshotIdentityBundle(input.request, input.context.bundle);
    const scope = factScope(input.request);
    const activeFacts = await this.facts.listActive({
      workspaceId: input.request.workspaceId,
      scope,
      at,
    });
    const currentRevisions = await this.currentSourceRevisions(
      input.request.workspaceId,
      activeFacts,
      input.request,
    );
    const frozenSourceRefs = new Set(
      Object.values(input.context.bundle.dimensions)
        .flatMap((dimension) => Object.values(dimension))
        .map((item) => item.sourceRef),
    );
    const hasNewDecision = (input.request.decisionReferences ?? []).some(
      (reference) => !frozenSourceRefs.has(reference.id),
    );
    if (
      contextSourceChanges(
        input.context.bundle.sourceRevisions,
        currentRevisions,
      ).length === 0 &&
      !hasNewDecision
    ) {
      return input.context;
    }
    const nextRevision = input.context.bundle.revision + 1;
    return this.compile(
      {
        workflowId: input.workflowId,
        request: input.request,
        declaration: input.declaration,
      },
      {
        expectedRevision: input.context.bundle.revision,
        idempotencyKey: `wf:${input.workflowId}:s2:context:r${nextRevision}`,
        reason: 'Harness source revision fence recompile',
      },
    );
  }

  private async compile(
    input: Parameters<ProductionHarnessContextPort['compileAndFreeze']>[0],
    freeze: {
      expectedRevision: number;
      idempotencyKey: string;
      reason: string;
    },
  ) {
    const at = this.now();
    const scope = factScope(input.request);
    const activeFacts = await this.facts.listActive({
      workspaceId: input.request.workspaceId,
      scope,
      at,
    });
    const directAssetIds = [...new Set(input.request.intent.assetReferences)];
    const [sourceRevisions, rawReuseRevision, activeIdentities, sourceContentPackage] =
      await Promise.all([
        this.currentSourceRevisions(
          input.request.workspaceId,
          activeFacts,
          input.request,
        ),
        input.request.reuseSeed
          ? this.requireReuseTasks().verifyReuseTaskSeed(
              input.request.workspaceId,
              input.request.reuseSeed,
            )
          : Promise.resolve(undefined),
        this.activeIdentitiesForRequest(input.request, at),
        this.resolveSourceContentPackage(input.request),
      ]);
    const assetIds = assetIdsForRequest(directAssetIds, sourceContentPackage);
    const requestedAssetRights =
      this.assetRights && assetIds.length > 0
        ? await this.assetRights.resolve({
            workspaceId: input.request.workspaceId,
            assetIds,
          })
        : undefined;
    const reuseRevision = rawReuseRevision
      ? assetRevisionSchema.parse(rawReuseRevision)
      : undefined;
    const contributions: ContextContribution[] = [
      contribution(
        'promotion_task',
        'task_type',
        input.declaration.taskType,
        `task:${input.workflowId}:intent`,
      ),
      contribution(
        'conversion_action',
        'delivery_layer',
        input.declaration.deliveryLayer,
        `task:${input.workflowId}:intent`,
      ),
      contribution(
        'promotion_task',
        'requested_intent',
        input.request.intent.context.intent,
        `task:${input.workflowId}:requested-intent`,
      ),
      ...optionalInstructionContributions(input),
      ...(input.request.decisionReferences ?? []).map((reference) =>
        contribution(
          reference.field === 'tone'
            ? 'expression_identity'
            : 'promotion_task',
          `confirmed_${reference.field}`,
          reference.value,
          reference.id,
        ),
      ),
      ...input.request.intent.context.sourceSummaries.map((value, index) =>
        contribution(
          'store_facts_assets',
          `instruction_source_${index + 1}`,
          value,
          `task:${input.workflowId}:source:${index + 1}`,
        ),
      ),
      ...input.request.intent.assetReferences.map((assetId) =>
        contribution(
          'store_facts_assets',
          `requested_asset_${assetId}`,
          assetId,
          `task:${input.workflowId}:asset:${assetId}`,
        ),
      ),
      ...(sourceContentPackage
        ? sourceContentPackageContributions(sourceContentPackage)
        : []),
      ...(reuseRevision?.fixedItems.map((item) =>
        contribution(
          'promotion_task',
          `reuse_${item.key}`,
          item.value,
          `asset_revision:${reuseRevision.revisionId}`,
        ),
      ) ?? []),
      ...(reuseRevision?.variableSlots.map((slot) =>
        contribution(
          'promotion_task',
          `reuse_slot_${slot.key}`,
          { source: slot.source, required: slot.required },
          `asset_revision:${reuseRevision.revisionId}`,
        ),
      ) ?? []),
      ...activeIdentities.map(identityContribution),
      ...activeFacts.map((fact) => ({
        dimension: 'store_facts_assets' as const,
        key: fact.key,
        value: fact.value,
        layer: 'current_fact' as const,
        pool: 'store_personal' as const,
        sourceRef: factReference(fact.factId, fact.revision),
        factRevision: { factId: fact.factId, revision: fact.revision },
      })),
    ];
    const compiled = compileContextBundle({
      workspaceId: input.request.workspaceId,
      taskId: input.workflowId,
      sourceRevisions,
      contributions,
    });
    const bundle = await this.bundles.freeze({
      workspaceId: input.request.workspaceId,
      bundleId: `context-${input.workflowId}`,
      compiled,
      expectedRevision: freeze.expectedRevision,
      frozenAt: at,
      frozenBy: input.request.actorId,
      idempotencyKey: freeze.idempotencyKey,
      reason: freeze.reason,
    });
    return this.snapshot(
      input,
      bundle,
      requestedAssetRights,
      activeFacts,
      activeIdentities,
      sourceContentPackage,
    );
  }

  private async snapshot(
    input: Parameters<ProductionHarnessContextPort['compileAndFreeze']>[0],
    bundle: ContextBundle,
    resolvedAssetRights?: {
      knownAssetIds?: string[];
      unauthorizedAssetIds: string[];
    },
    resolvedActiveFacts?: Awaited<ReturnType<StoreFactLedger['listActive']>>,
    resolvedActiveIdentities?: MarketingIdentityAsset[],
    resolvedSourceContentPackage?: ResolvedSourceContentPackage,
  ): Promise<HarnessContextSnapshot> {
    const sourceContentPackage =
      resolvedSourceContentPackage ??
      (await this.resolveSourceContentPackage(input.request));
    const assetIds = assetIdsForRequest(
      input.request.intent.assetReferences,
      sourceContentPackage,
    );
    const assetRights =
      resolvedAssetRights ??
      (this.assetRights && assetIds.length > 0
        ? await this.assetRights.resolve({
            workspaceId: input.request.workspaceId,
            assetIds,
          })
        : undefined);
    const activeFacts =
      resolvedActiveFacts ??
      (await this.facts.listActive({
        workspaceId: input.request.workspaceId,
        scope: factScope(input.request),
        at: this.now(),
      }));
    const activeIdentities =
      resolvedActiveIdentities ??
      (await this.activeIdentitiesForRequest(input.request, this.now()));
    this.assertSnapshotIdentityBundle(input.request, bundle);
    const rightsRefs = assetIds.map((assetId) => {
      const authorized =
        assetRights !== undefined &&
        !assetRights.unauthorizedAssetIds.includes(assetId) &&
        (assetRights.knownAssetIds === undefined ||
          assetRights.knownAssetIds.includes(assetId));
      const allowedUses: Array<
        'internal_draft' | 'public_content' | 'paid_promotion'
      > = authorized ? ['public_content'] : [];
      return {
        assetId,
        workspaceId: input.request.workspaceId,
        status: authorized ? ('authorized' as const) : ('unknown' as const),
        allowedUses,
      };
    });
    return {
      bundle,
      activeFactReferences: activeFacts.map((fact) => ({
        key: fact.key,
        sourceRef: factReference(fact.factId, fact.revision),
      })),
      activeFacts: activeFacts.map((fact) => ({
        key: fact.key,
        value: fact.value,
        sourceRef: factReference(fact.factId, fact.revision),
        effectiveFrom: fact.effectiveFrom,
        expiresAt: fact.expiresAt,
      })),
      policyReferences: {
        sourceRefs: bundle.referencedFactRevisions
          .map((reference) => ({
            id: factReference(reference.factId, reference.revision),
            workspaceId: bundle.workspaceId,
            revision: reference.revision,
            status: 'current' as const,
          }))
          .concat(
            (input.request.decisionReferences ?? []).map((reference) => ({
              id: reference.id,
              workspaceId: input.request.workspaceId,
              revision: reference.revision,
              status: 'current' as const,
            })),
          ),
        rightsRefs,
        identityRefs: activeIdentities.map((identity) => ({
          id: identityReference(identity),
          workspaceId: input.request.workspaceId,
          status: 'registered' as const,
        })),
      },
    };
  }

  private requireReuseTasks() {
    if (!this.reuseTasks) {
      throw new Error('Reuse Task context is unavailable.');
    }
    return this.reuseTasks;
  }

  private async activeIdentitiesForRequest(
    request: HarnessWorkflowInput,
    at: string,
  ) {
    const activeIdentities = this.identities
      ? await this.identities.listActive(request.workspaceId, at)
      : [];
    const snapshot = request.executionSnapshot;
    if (!snapshot) return activeIdentities;
    if (isOfficialNeutralIdentity(snapshot.identity)) return [];

    const identity = activeIdentities.find(
      (candidate) =>
        candidate.identityId === snapshot.identity.id &&
        String(candidate.version) === snapshot.identity.revision,
    );
    if (!identity) {
      throw new HarnessSnapshotIdentityError(
        snapshotIdentityReference(snapshot)!,
      );
    }
    return [identity];
  }

  private async resolveSourceContentPackage(request: HarnessWorkflowInput) {
    const source = request.executionSnapshot?.sources.contentPackage;
    if (!source) return undefined;
    if (!this.sourceContentPackages) {
      throw new SourceContentPackageUnavailableError(source);
    }
    return this.sourceContentPackages.resolve({
      workspaceId: request.workspaceId,
      source,
    });
  }

  private assertSnapshotIdentityBundle(
    request: HarnessWorkflowInput,
    bundle: ContextBundle,
  ) {
    const snapshot = request.executionSnapshot;
    if (!snapshot) return;
    const expectedIdentityRef = snapshotIdentityReference(snapshot);
    const identityRefs = Object.values(bundle.dimensions.expression_identity)
      .map((item) => item.sourceRef)
      .filter((sourceRef) => sourceRef.startsWith('marketing_identity:'));
    if (expectedIdentityRef === null) {
      if (identityRefs.length !== 0) {
        throw new HarnessSnapshotIdentityError('official-neutral');
      }
      return;
    }
    if (identityRefs.length !== 1 || identityRefs[0] !== expectedIdentityRef) {
      throw new HarnessSnapshotIdentityError(expectedIdentityRef);
    }
  }

  private async currentSourceRevisions(
    workspaceId: string,
    activeFacts: Awaited<ReturnType<StoreFactLedger['listActive']>>,
    request: HarnessWorkflowInput,
  ): Promise<ContextSourceRevisions> {
    const revisions = this.sourceRevisionHeads
      ? await this.sourceRevisionHeads.current(workspaceId)
      : {
          facts: 0,
          assets: 0,
          identity: 0,
          rights: 0,
          preferences: 0,
          recipe: 0,
          platformRules: 0,
          currentSignal: 1,
        };
    return {
      ...revisions,
      facts: storeFactContextRevision(activeFacts),
      currentSignal: fingerprintValue({
        head: revisions.currentSignal,
        rawInput: request.rawInput,
        intent: request.intent,
        factScope: factScope(request),
        decisionReferences: request.decisionReferences ?? [],
        reuseSeed: request.reuseSeed ?? null,
      }),
      ...(this.recipeRevision
        ? { recipe: await this.recipeRevision(workspaceId) }
        : {}),
    };
  }
}

function factScope(request: HarnessWorkflowInput) {
  return request.factScope ?? { storeId: request.workspaceId };
}

function optionalInstructionContributions(
  input: Parameters<ProductionHarnessContextPort['compileAndFreeze']>[0],
) {
  const context = input.request.intent.context;
  return [
    context.scene
      ? contribution(
          'promotion_task',
          'requested_scene',
          context.scene,
          `task:${input.workflowId}:requested-scene`,
        )
      : null,
    context.tone
      ? contribution(
          'expression_identity',
          'requested_tone',
          context.tone,
          `task:${input.workflowId}:requested-tone`,
        )
      : null,
    context.audience
      ? contribution(
          'promotion_task',
          'requested_audience',
          context.audience,
          `task:${input.workflowId}:requested-audience`,
        )
      : null,
  ].filter((item): item is ContextContribution => item !== null);
}

function assetIdsForRequest(
  directAssetIds: string[],
  sourceContentPackage?: ResolvedSourceContentPackage,
) {
  return [
    ...new Set([
      ...directAssetIds,
      ...(sourceContentPackage?.assets
        .filter((asset) => asset.role === 'selected')
        .map((asset) => asset.id) ?? []),
    ]),
  ];
}

function sourceContentPackageContributions(
  source: ResolvedSourceContentPackage,
): ContextContribution[] {
  const sourceRef = `content_package:${source.reference.id}:${source.reference.revision}`;
  const selectedAssets = source.assets.filter((asset) => asset.role === 'selected');
  return [
    contribution(
      'store_facts_assets',
      'source_content_package_structure',
      {
        packageId: source.reference.id,
        revision: source.reference.revision,
        ...source.structure,
      },
      sourceRef,
    ),
    contribution(
      'platform_mechanism',
      'source_content_package_style',
      {
        packageId: source.reference.id,
        revision: source.reference.revision,
        ...source.style,
      },
      sourceRef,
    ),
    contribution(
      'store_facts_assets',
      'source_content_package_assets',
      {
        packageId: source.reference.id,
        revision: source.reference.revision,
        assets: selectedAssets,
      },
      sourceRef,
    ),
  ];
}

function contribution(
  dimension: ContextContribution['dimension'],
  key: string,
  value: unknown,
  sourceRef: string,
): ContextContribution {
  return {
    dimension,
    key,
    value: value as ContextContribution['value'],
    layer: 'current_instruction',
    pool: 'current_signal',
    sourceRef,
  };
}

function identityContribution(
  identity: MarketingIdentityAsset,
): ContextContribution {
  return {
    dimension: 'expression_identity',
    key: `identity_${identity.identityId}`,
    value: {
      identityId: identity.identityId,
      kind: identity.kind,
      version: identity.version,
      displayName: identity.displayName,
      professionalBoundaries: identity.professionalBoundaries,
      allowedPlatforms: identity.allowedPlatforms,
      allowedScenes: identity.allowedScenes,
      expressionSamples: identity.expressionSamples,
      ...(identity.kind === 'brand'
        ? {
            brandClaims: identity.brandClaims,
            forbiddenClaims: identity.forbiddenClaims,
            visualPrinciples: identity.visualPrinciples,
            seriesAnchors: identity.seriesAnchors,
          }
        : {
            realWorldRole: identity.realWorldRole,
            portraitAuthorization: identity.portraitAuthorization,
            voiceAuthorization: identity.voiceAuthorization,
            historicalContentPermission:
              identity.historicalContentPermission,
          }),
    },
    layer: 'confirmed_asset',
    pool: 'store_personal',
    sourceRef: identityReference(identity),
  };
}

function identityReference(identity: MarketingIdentityAsset) {
  return `marketing_identity:${identity.identityId}:${identity.version}`;
}

function snapshotIdentityReference(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
) {
  if (isOfficialNeutralIdentity(snapshot.identity)) return null;
  return `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
}

function factReference(factId: string, revision: number) {
  return `store_fact:${factId}:${revision}`;
}
