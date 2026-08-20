import type {
  ModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from './foundation-module.js';

export type GenerationRuntimePort = Pick<
  ModelSupplyControlPlaneService,
  | 'bindMerchantExecutionBilling'
  | 'submitGeneration'
  | 'getJob'
  | 'cancelGeneration'
  | 'reconcileCancelledProviderTerminal'
>;

export type ModelCatalogAdminPort = Pick<
  ModelSupplyControlPlaneService,
  | 'initialize'
  | 'getCatalog'
  | 'getAdminCatalogControl'
  | 'simulateRoute'
  | 'runActivationProbe'
  | 'activationStatus'
  | 'listActivationProbeRuns'
  | 'createCatalogDraft'
  | 'createCatalogDiscoveryDraft'
  | 'createSafeCatalogDraft'
  | 'enableCatalog'
  | 'publishCatalog'
  | 'retireCatalog'
  | 'rollbackCatalogRevision'
  | 'rollbackPromptRevision'
  | 'getPromptRevision'
  | 'promptRevisionView'
  | 'listCatalogRevisionActivity'
  | 'listRevisionRollbackAudits'
>;

export type ModelPreferencePort = Pick<
  ModelSupplyControlPlaneService,
  | 'getPreferences'
  | 'setWorkspaceDefault'
  | 'setUserDefault'
  | 'setFavorite'
  | 'recordRecent'
>;

export type QualityEvaluationPort = Pick<
  ModelSupplyControlPlaneService,
  | 'recordQuality'
  | 'qualityDashboard'
  | 'listQualityEvaluations'
  | 'getQualityEvaluation'
  | 'runQualityEvaluation'
>;

export type GenerationRuntimeStore = Pick<
  ModelSupplyControlPlaneRepository,
  'saveResult' | 'getJob' | 'listJobs'
>;

export type ModelCatalogAdminStore = Pick<
  ModelSupplyControlPlaneRepository,
  | 'saveCatalogRevision'
  | 'listCatalogRevisions'
  | 'getCurrentPublishedCatalogRevision'
  | 'setCurrentPublishedCatalogRevision'
  | 'clearCurrentPublishedCatalogRevision'
  | 'applyCatalogRollback'
  | 'getCurrentPromptRevision'
  | 'applyPromptRollback'
  | 'listRevisionRollbackAudits'
  | 'saveActivationProbeRun'
  | 'getActivationProbeRun'
  | 'listActivationProbeRuns'
>;

export type ModelPreferenceStore = Pick<
  ModelSupplyControlPlaneRepository,
  | 'setWorkspaceDefault'
  | 'setUserDefault'
  | 'setFavorite'
  | 'recordRecent'
  | 'getPreferences'
>;

export type QualityEvaluationStore = Pick<
  ModelSupplyControlPlaneRepository,
  | 'saveQualityEvent'
  | 'listQualityEvents'
  | 'saveQualityEvaluationRun'
  | 'getQualityEvaluationRun'
  | 'listQualityEvaluationRuns'
>;

export const API_MODEL_SUPPLY_REQUIRED_PORTS = [
  'generation',
  'catalogAdmin',
  'preferences',
  'quality',
] as const;

export const WORKER_MODEL_SUPPLY_REQUIRED_PORTS = [
  'generation',
  'catalogAdmin',
  'preferences',
  'quality',
] as const;

export type ApiModelSupplyPortName =
  (typeof API_MODEL_SUPPLY_REQUIRED_PORTS)[number];
export type WorkerModelSupplyPortName =
  (typeof WORKER_MODEL_SUPPLY_REQUIRED_PORTS)[number];

export type ModelSupplyPortMap = {
  generation: GenerationRuntimePort;
  catalogAdmin: ModelCatalogAdminPort;
  preferences: ModelPreferencePort;
  quality: QualityEvaluationPort;
};

export type ApiModelSupplyGraph = {
  role: 'api';
} & ModelSupplyPortMap;

export type WorkerModelSupplyGraph = {
  role: 'worker';
} & Pick<ModelSupplyPortMap, WorkerModelSupplyPortName>;

export type ModelSupplyGraph = ApiModelSupplyGraph | WorkerModelSupplyGraph;

/** Role graphs take only the ports they need. ARCH-04 must not seal the god control-plane class. */
export function createApiModelSupplyGraph(
  ports: Partial<ModelSupplyPortMap>,
): ApiModelSupplyGraph {
  return {
    role: 'api',
    ...requireModelSupplyPorts('api', ports, API_MODEL_SUPPLY_REQUIRED_PORTS),
  };
}

export function createWorkerModelSupplyGraph(
  ports: Partial<Pick<ModelSupplyPortMap, WorkerModelSupplyPortName>>,
): WorkerModelSupplyGraph {
  return {
    role: 'worker',
    ...requireModelSupplyPorts(
      'worker',
      ports,
      WORKER_MODEL_SUPPLY_REQUIRED_PORTS,
    ),
  };
}

export function requireSharedModelSupplyAdapter(
  ports: Pick<
    WorkerModelSupplyGraph,
    'generation' | 'catalogAdmin' | 'preferences' | 'quality'
  >,
): GenerationRuntimePort &
  ModelCatalogAdminPort &
  ModelPreferencePort &
  QualityEvaluationPort {
  const { generation, catalogAdmin, preferences, quality } = ports;
  const adapter = generation as object;
  if (
    adapter !== (catalogAdmin as object) ||
    adapter !== (preferences as object) ||
    adapter !== (quality as object)
  ) {
    throw new Error(
      'Model Supply caller ports must be one adapter implementing each required port',
    );
  }
  return generation as GenerationRuntimePort &
    ModelCatalogAdminPort &
    ModelPreferencePort &
    QualityEvaluationPort;
}

export function createModelSupplyGraph(
  role: 'api',
  ports: Partial<ModelSupplyPortMap>,
): ApiModelSupplyGraph;
export function createModelSupplyGraph(
  role: 'worker',
  ports: Partial<Pick<ModelSupplyPortMap, WorkerModelSupplyPortName>>,
): WorkerModelSupplyGraph;
export function createModelSupplyGraph(
  role: 'api' | 'worker',
  ports: Partial<ModelSupplyPortMap>,
): ModelSupplyGraph {
  return role === 'api'
    ? createApiModelSupplyGraph(ports)
    : createWorkerModelSupplyGraph(ports);
}

function requireModelSupplyPorts<
  Role extends 'api' | 'worker',
  const Names extends readonly (keyof ModelSupplyPortMap)[],
>(
  role: Role,
  ports: Partial<ModelSupplyPortMap>,
  names: Names,
): Pick<ModelSupplyPortMap, Names[number]> {
  for (const name of names) {
    if (!ports[name]) {
      throw new Error(`${role} model-supply graph requires ${name} port`);
    }
  }
  return ports as Pick<ModelSupplyPortMap, Names[number]>;
}
