import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createApiModelSupplyGraph,
  createModelSupplyGraph,
  createWorkerModelSupplyGraph,
  requireSharedModelSupplyAdapter,
  type ApiModelSupplyGraph,
  type GenerationRuntimePort,
  type GenerationRuntimeStore,
  type ModelCatalogAdminPort,
  type ModelCatalogAdminStore,
  type ModelPreferencePort,
  type ModelPreferenceStore,
  type QualityEvaluationPort,
  type QualityEvaluationStore,
  type WorkerModelSupplyGraph,
} from './control-plane-ports.js';
import type {
  ModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from './foundation-module.js';
import type { PostgresModelSupplyRepository } from './postgres-repository.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type ApiPortKeys = Exclude<keyof ApiModelSupplyGraph, 'role'>;
type WorkerPortKeys = Exclude<keyof WorkerModelSupplyGraph, 'role'>;

type _apiDependsOnlyOnNeededPorts = Expect<
  Equal<
    ApiPortKeys,
    'generation' | 'catalogAdmin' | 'preferences' | 'quality'
  >
>;
type _workerDependsOnlyOnNeededPorts = Expect<
  Equal<WorkerPortKeys, 'generation' | 'catalogAdmin' | 'preferences' | 'quality'>
>;
type _graphsSharePorts = Expect<Equal<ApiPortKeys, WorkerPortKeys>>;
type _serviceSatisfiesCallerPorts = Expect<
  ModelSupplyControlPlaneService extends GenerationRuntimePort &
    ModelCatalogAdminPort &
    ModelPreferencePort &
    QualityEvaluationPort
    ? true
    : false
>;
type _postgresAdapterImplementsEveryStore = Expect<
  PostgresModelSupplyRepository extends GenerationRuntimeStore &
    ModelCatalogAdminStore &
    ModelPreferenceStore &
    QualityEvaluationStore &
    ModelSupplyControlPlaneRepository
    ? true
    : false
>;

const typeProofs: [
  _apiDependsOnlyOnNeededPorts,
  _workerDependsOnlyOnNeededPorts,
  _graphsSharePorts,
  _serviceSatisfiesCallerPorts,
  _postgresAdapterImplementsEveryStore,
] = [true, true, true, true, true];

function fakePort<T>(): T {
  return {} as T;
}

test('API graph types depend on generation, catalog, preference, and quality ports', () => {
  assert.equal(typeProofs.length, 5);
  const graph = createApiModelSupplyGraph({
    generation: fakePort(),
    catalogAdmin: fakePort(),
    preferences: fakePort(),
    quality: fakePort(),
  });
  assert.equal(graph.role, 'api');
  assert.ok(graph.generation);
  assert.ok(graph.catalogAdmin);
  assert.ok(graph.preferences);
  assert.ok(graph.quality);
  assert.equal(Object.hasOwn(graph, 'canvasText'), false);
});

test('worker graph types match the retired API graph and omit canvas text', () => {
  const graph = createWorkerModelSupplyGraph({
    generation: fakePort(),
    catalogAdmin: fakePort(),
    preferences: fakePort(),
    quality: fakePort(),
  });
  assert.equal(graph.role, 'worker');
  assert.ok(graph.generation);
  assert.ok(graph.catalogAdmin);
  assert.ok(graph.preferences);
  assert.ok(graph.quality);
  assert.equal(Object.hasOwn(graph, 'canvasText'), false);
});

test('missing required API port fails at graph construction, not later', () => {
  const ports = {
    catalogAdmin: fakePort<ModelCatalogAdminPort>(),
    preferences: fakePort<ModelPreferencePort>(),
    quality: fakePort<QualityEvaluationPort>(),
  };
  assert.throws(
    () => createApiModelSupplyGraph(ports),
    { message: 'api model-supply graph requires generation port' },
  );
});

test('missing required worker port fails at graph construction, not later', () => {
  assert.throws(
    () =>
      createWorkerModelSupplyGraph({
        catalogAdmin: fakePort(),
        preferences: fakePort(),
        quality: fakePort(),
      }),
    { message: 'worker model-supply graph requires generation port' },
  );
  assert.doesNotThrow(() =>
    createWorkerModelSupplyGraph({
      generation: fakePort(),
      catalogAdmin: fakePort(),
      preferences: fakePort(),
      quality: fakePort(),
    }),
  );
});

test('one adapter may implement multiple ports; extra adapter classes fail at construction', () => {
  const adapter = fakePort<
    GenerationRuntimePort &
      ModelCatalogAdminPort &
      ModelPreferencePort &
      QualityEvaluationPort
  >();
  const shared = requireSharedModelSupplyAdapter({
    generation: adapter,
    catalogAdmin: adapter,
    preferences: adapter,
    quality: adapter,
  });
  assert.equal(shared, adapter);
  assert.throws(
    () =>
      requireSharedModelSupplyAdapter({
        generation: adapter,
        catalogAdmin: fakePort(),
        preferences: adapter,
        quality: adapter,
      }),
    {
      message:
        'Model Supply caller ports must be one adapter implementing each required port',
    },
  );
});

test('API construction succeeds without the retired canvas text port', () => {
  const graph = createModelSupplyGraph('api', {
    generation: fakePort(),
    catalogAdmin: fakePort(),
    preferences: fakePort(),
    quality: fakePort(),
  });
  assert.equal(graph.role, 'api');
  assert.equal(Object.hasOwn(graph, 'canvasText'), false);
});
