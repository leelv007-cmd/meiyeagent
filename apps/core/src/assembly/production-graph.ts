import { sealLateBounds, type LateBound } from './late-bound.js';
import {
  applySchemaBoot,
  type SchemaBootMode,
  type SchemaQueryable,
} from './schema-boot.js';
import type { PostgresSchemaMigrator } from '../postgres-schema-migration.js';
import type { ProductionRuntimeFingerprint } from './runtime-fingerprint.js';

export const API_PRODUCTION_REQUIRED_PORTS = [
  'pool',
  'jobRuntime',
  'operationsService',
  'modelSupply',
  'productService',
  'executionConfirmationService',
] as const;

export const WORKER_PRODUCTION_REQUIRED_PORTS = [
  'pool',
  'jobRuntime',
  'operationsService',
  'p1ModelSupplyService',
  'executionConfirmationService',
  'tracerJobRepository',
  'parseService',
] as const;

/** HTTP / Session-harness ports. Worker graphs must not construct these. */
export const SESSION_WEB_ONLY_PORTS = [
  'sessionAgentHarness',
  'sessionAgentKernel',
  'aiStreamingRunner',
  'marketingIdentityDrafter',
  'storeSentenceExtractor',
  'planCompiler',
  'steeringService',
  'agentSessionStore',
] as const;

export type ApiProductionPortName =
  (typeof API_PRODUCTION_REQUIRED_PORTS)[number];
export type WorkerProductionPortName =
  (typeof WORKER_PRODUCTION_REQUIRED_PORTS)[number];
export type SessionWebOnlyPortName = (typeof SESSION_WEB_ONLY_PORTS)[number];

export type ProductionPortMap = Record<string, unknown>;

export type ApiProductionGraph = {
  role: 'api';
  ports: ProductionPortMap;
  runtimeFingerprint: ProductionRuntimeFingerprint;
};

export type WorkerProductionGraph = {
  role: 'worker';
  ports: ProductionPortMap;
  runtimeFingerprint: ProductionRuntimeFingerprint;
};

export type ProductionGraph = ApiProductionGraph | WorkerProductionGraph;

export function createApiProductionGraph(input: {
  ports: Partial<ProductionPortMap>;
  runtimeFingerprint: ProductionRuntimeFingerprint;
}): ApiProductionGraph {
  const ports = requireProductionPorts(
    'api',
    input.ports,
    API_PRODUCTION_REQUIRED_PORTS,
  );
  return {
    role: 'api',
    ports,
    runtimeFingerprint: input.runtimeFingerprint,
  };
}

export function createWorkerProductionGraph(input: {
  ports: Partial<ProductionPortMap>;
  runtimeFingerprint: ProductionRuntimeFingerprint;
}): WorkerProductionGraph {
  for (const name of SESSION_WEB_ONLY_PORTS) {
    if (Object.hasOwn(input.ports, name) && input.ports[name] != null) {
      throw new Error(
        `worker graph must not construct Session/Web-only port ${name}`,
      );
    }
  }
  const ports = requireProductionPorts(
    'worker',
    input.ports,
    WORKER_PRODUCTION_REQUIRED_PORTS,
  );
  return {
    role: 'worker',
    ports,
    runtimeFingerprint: input.runtimeFingerprint,
  };
}

export function sealProductionGraph(
  graph: ProductionGraph,
  lateBounds: readonly Pick<LateBound<unknown>, 'bound' | 'name' | 'seal'>[] = [],
): void {
  const required =
    graph.role === 'api'
      ? API_PRODUCTION_REQUIRED_PORTS
      : WORKER_PRODUCTION_REQUIRED_PORTS;
  requireProductionPorts(graph.role, graph.ports, required);
  if (graph.role === 'worker') {
    for (const name of SESSION_WEB_ONLY_PORTS) {
      if (Object.hasOwn(graph.ports, name) && graph.ports[name] != null) {
        throw new Error(
          `worker graph must not construct Session/Web-only port ${name}`,
        );
      }
    }
  }
  sealLateBounds(lateBounds);
}

/**
 * Fail closed before the process accepts traffic: required ports, late
 * binds, then schema verify/migrate, then listen / worker start.
 */
export async function startSealedReplica<T>(options: {
  graph: ProductionGraph;
  lateBounds?: readonly Pick<LateBound<unknown>, 'bound' | 'name' | 'seal'>[];
  schema?: {
    mode: SchemaBootMode;
    pool: SchemaQueryable;
    migrators: readonly PostgresSchemaMigrator[];
    relations?: readonly string[];
    verify?: (pool: SchemaQueryable) => Promise<void>;
  };
  listen: () => T | Promise<T>;
}): Promise<T> {
  sealProductionGraph(options.graph, options.lateBounds ?? []);
  if (options.schema) {
    await applySchemaBoot(options.schema);
  }
  return options.listen();
}

function requireProductionPorts(
  role: 'api' | 'worker',
  ports: Partial<ProductionPortMap>,
  names: readonly string[],
): ProductionPortMap {
  for (const name of names) {
    if (ports[name] == null) {
      throw new Error(`${role} production graph requires ${name} port`);
    }
  }
  return ports as ProductionPortMap;
}
