import {
  CapabilityHotAssemblyRegistry,
  MemoryEffectiveCapabilityRevisionStore,
  projectCapabilityRevision,
  toRuntimeCapabilityEntry,
  type CapabilityHotAssemblyPort,
  type EffectiveCapabilityRevisionStore,
  type EffectiveRevisionReport,
  type RuntimeCapabilityRevision,
} from '../supply-registry/hot-assembly.js';
import {
  createDefaultCapabilityRevisions,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
} from './catalog.js';
import {
  ModelSupplyControlPlaneService,
  RECORDED_CATALOG_REVISION_ID,
} from './foundation-module.js';
import { ModelSupplyApplicationService } from './index.js';
import type { ModelRuntimeAssembly } from './runtime-config.js';

type ApplicationAdapters = Omit<
  ConstructorParameters<typeof ModelSupplyApplicationService>[0],
  | 'catalogRevisionId'
  | 'deployments'
  | 'execution'
  | 'models'
  | 'capabilityHotAssembly'
  | 'runtimeCapabilities'
> & {
  execution: ConstructorParameters<
    typeof ModelSupplyApplicationService
  >[0]['execution'];
};

type ControlPlaneAdapters = Omit<
  ConstructorParameters<typeof ModelSupplyControlPlaneService>[0],
  | 'activationProbeLiveDeploymentIds'
  | 'allowRecordedExecution'
  | 'application'
  | 'configurationRevisions'
  | 'fallbackCatalog'
>;

export interface ModelSupplyRuntimeAssemblyInput {
  application: ApplicationAdapters;
  catalog: ModelRuntimeAssembly;
  controlPlane: ControlPlaneAdapters;
  /**
   * Optional G3 hot-assembly port. When omitted, boot seeds a process-local
   * registry from the catalog's runtimeCapabilities (Z2-WIRING).
   */
  capabilityHotAssembly?: CapabilityHotAssemblyPort;
}

export interface ProcessCapabilityHotAssembly {
  hotAssembly: CapabilityHotAssemblyRegistry;
  store: EffectiveCapabilityRevisionStore;
  bootRevision: RuntimeCapabilityRevision | null;
  report(processKind: 'http' | 'job-worker'): EffectiveRevisionReport;
}

/**
 * Seed G3 capability hot assembly from a ModelRuntimeAssembly boot snapshot.
 * HTTP and Worker call this with the same catalog sources so boot revision
 * fingerprints match (dual-process effective-revision alignment).
 */
export function seedCapabilityHotAssemblyFromCatalog(
  catalog: ModelRuntimeAssembly,
  options: {
    store?: EffectiveCapabilityRevisionStore;
    catalogRevisionId?: string;
    revisionId?: string;
    publishedAt?: string;
  } = {},
): ProcessCapabilityHotAssembly {
  const store = options.store ?? new MemoryEffectiveCapabilityRevisionStore();
  const hotAssembly = new CapabilityHotAssemblyRegistry(store);
  const catalogRevisionId =
    options.catalogRevisionId ?? RECORDED_CATALOG_REVISION_ID;
  hotAssembly.applyCatalogRevisionHead(catalogRevisionId);

  const entries = catalog.runtimeCapabilities.map((capability) =>
    toRuntimeCapabilityEntry({
      id: capability.id,
      catalogModelId: capability.catalogModelId,
      apiFamily: capability.apiFamily,
      channel: capability.channel,
      region: capability.region,
      executionChannelId: capability.executionChannelId,
      providerModel: capability.providerModel,
      endpointRevision: capability.endpointRevision,
      lifecycleRevision: capability.lifecycleRevision,
      credentialAccountId: capability.credentialAccountId,
      credentialVersion: capability.credentialVersion,
    }),
  );

  let bootRevision: RuntimeCapabilityRevision | null = null;
  if (entries.length > 0) {
    const fingerprint = entries
      .map(
        (entry) =>
          `${entry.deploymentId}:${entry.credentialVersion ?? ''}:${entry.adapterKey}`,
      )
      .sort()
      .join('|');
    bootRevision = projectCapabilityRevision({
      revisionId:
        options.revisionId ??
        `boot-capability:${catalogRevisionId}:${simpleHash(fingerprint)}`,
      number: 1,
      entries,
      publishedAt: options.publishedAt ?? new Date(0).toISOString(),
      reason: 'process_boot_from_runtime_capabilities',
    });
    hotAssembly.applyCapabilityRevision(bootRevision);
  }

  return {
    hotAssembly,
    store,
    bootRevision,
    report(processKind) {
      return hotAssembly.reportProcessView(processKind);
    },
  };
}

/**
 * Align HTTP and Worker process views against one shared store — proves the
 * dual-process effective-revision contract that main/job-worker both seed.
 */
export function alignProcessCapabilityHotAssembly(
  catalog: ModelRuntimeAssembly,
  options: {
    catalogRevisionId?: string;
    revisionId?: string;
    publishedAt?: string;
  } = {},
): {
  store: EffectiveCapabilityRevisionStore;
  http: ProcessCapabilityHotAssembly;
  worker: ProcessCapabilityHotAssembly;
} {
  const store = new MemoryEffectiveCapabilityRevisionStore();
  const seedOptions = { ...options, store };
  const http = seedCapabilityHotAssemblyFromCatalog(catalog, seedOptions);
  const worker = seedCapabilityHotAssemblyFromCatalog(catalog, seedOptions);
  return { store, http, worker };
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createModelSupplyRuntime(
  input: ModelSupplyRuntimeAssemblyInput,
) {
  const { deployments, models, runtime, runtimeCapabilities } = input.catalog;
  const capabilityHotAssembly =
    input.capabilityHotAssembly ??
    seedCapabilityHotAssemblyFromCatalog(input.catalog).hotAssembly;
  const application = new ModelSupplyApplicationService({
    ...input.application,
    catalogRevisionId: RECORDED_CATALOG_REVISION_ID,
    deployments,
    models,
    capabilityHotAssembly,
    planningControlPlane: input.controlPlane.planningControlPlane,
    runtimeCapabilities,
  });
  const fallbackCatalog = {
    payload: {
      capabilities: createDefaultCapabilityRevisions(),
      deployments,
      executionChannels: createDefaultExecutionChannels(),
      models,
      prices: createDefaultPriceRevisions(),
      providerProfiles: createDefaultProviderProfiles(),
      routes: createDefaultRouteRevisions(),
    },
    revisionId: RECORDED_CATALOG_REVISION_ID,
  };
  const activationProbeLiveDeploymentIds = [
    ...(runtime.mode === 'direct' && runtime.direct
      ? deployments
          .filter(
            (deployment) =>
              deployment.catalogModelId === runtime.direct?.catalogModelId,
          )
          .map((deployment) => deployment.id)
      : []),
    ...(runtime.arkMedia
      ? ['seedream-5-pro-direct', 'seedance-2-direct']
      : []),
    ...(runtime.tuziMedia
      ? [
          'gpt-image-2-tuzi-relay',
          'seedream-4-5-tuzi-relay',
          'seedream-5-pro-tuzi-relay',
          'seedance-1-5-pro-tuzi-relay',
          'seedance-2-tuzi-relay',
        ]
      : []),
    ...(runtime.volcengineTts
      ? ['seed-tts-2-volcengine-direct']
      : []),
  ];
  const controlPlane = new ModelSupplyControlPlaneService({
    ...input.controlPlane,
    activationProbeLiveDeploymentIds,
    allowRecordedExecution: runtime.activation === 'local_fixture_verified',
    application,
    configurationRevisions: input.catalog.configurationRevisions,
    fallbackCatalog,
  });
  return {
    activationProbeLiveDeploymentIds,
    application,
    capabilityHotAssembly,
    controlPlane,
    fallbackCatalog,
  };
}
