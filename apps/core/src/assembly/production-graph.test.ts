import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LateBound } from './late-bound.js';
import {
  SESSION_WEB_ONLY_PORTS,
  createApiProductionGraph,
  createWorkerProductionGraph,
  sealProductionGraph,
  startSealedReplica,
} from './production-graph.js';
import { productionRuntimeFingerprint } from './runtime-fingerprint.js';
import type { PostgresSchemaMigrator } from '../postgres-schema-migration.js';

const fingerprint = productionRuntimeFingerprint({
  JOB_QUEUE_PREFIX: 'meiye-p1',
  HARNESS_DBOS_APPLICATION_VERSION: 'test',
});

function apiPorts() {
  return {
    pool: {},
    jobRuntime: {},
    operationsService: {},
    modelSupply: {},
    productService: {},
    executionConfirmationService: {},
  };
}

function workerPorts() {
  return {
    pool: {},
    jobRuntime: {},
    operationsService: {},
    p1ModelSupplyService: {},
    executionConfirmationService: {},
    tracerJobRepository: {},
    parseService: {},
  };
}

test('missing required API port fails before listen', async () => {
  let listened = false;
  const ports = apiPorts();
  delete (ports as { jobRuntime?: unknown }).jobRuntime;
  await assert.rejects(
    async () =>
      startSealedReplica({
        graph: createApiProductionGraph({ ports, runtimeFingerprint: fingerprint }),
        listen: () => {
          listened = true;
        },
      }),
    { message: 'api production graph requires jobRuntime port' },
  );
  assert.equal(listened, false);
});

test('missing required worker port fails before listen', async () => {
  let started = false;
  const ports = workerPorts();
  delete (ports as { parseService?: unknown }).parseService;
  await assert.rejects(
    async () =>
      startSealedReplica({
        graph: createWorkerProductionGraph({
          ports,
          runtimeFingerprint: fingerprint,
        }),
        listen: () => {
          started = true;
        },
      }),
    { message: 'worker production graph requires parseService port' },
  );
  assert.equal(started, false);
});

test('unbound LateBound fails before listen', async () => {
  let listened = false;
  const experience = new LateBound<string>('sessionRetrievalExperience');
  await assert.rejects(
    () =>
      startSealedReplica({
        graph: createApiProductionGraph({
          ports: apiPorts(),
          runtimeFingerprint: fingerprint,
        }),
        lateBounds: [experience],
        listen: () => {
          listened = true;
        },
      }),
    { message: 'missing required port: sessionRetrievalExperience' },
  );
  assert.equal(listened, false);
});

test('worker graph does not construct Session/Web-only ports', () => {
  const graph = createWorkerProductionGraph({
    ports: workerPorts(),
    runtimeFingerprint: fingerprint,
  });
  for (const name of SESSION_WEB_ONLY_PORTS) {
    assert.equal(Object.hasOwn(graph.ports, name), false, name);
    assert.equal(graph.ports[name], undefined, name);
  }
  assert.equal(graph.role, 'worker');
  sealProductionGraph(graph);
});

test('worker construction refuses Session/Web-only ports', () => {
  assert.throws(
    () =>
      createWorkerProductionGraph({
        ports: {
          ...workerPorts(),
          sessionAgentHarness: {},
        },
        runtimeFingerprint: fingerprint,
      }),
    {
      message:
        'worker graph must not construct Session/Web-only port sessionAgentHarness',
    },
  );
  assert.throws(
    () =>
      createWorkerProductionGraph({
        ports: {
          ...workerPorts(),
          aiStreamingRunner: {},
        },
        runtimeFingerprint: fingerprint,
      }),
    {
      message:
        'worker graph must not construct Session/Web-only port aiStreamingRunner',
    },
  );
});

test('production replica schema mismatch fails before listen and never runs DDL', async () => {
  let listened = false;
  const migrator: PostgresSchemaMigrator = {
    async migrate() {
      throw new Error('DDL must not run');
    },
  };
  await assert.rejects(
    () =>
      startSealedReplica({
        graph: createApiProductionGraph({
          ports: apiPorts(),
          runtimeFingerprint: fingerprint,
        }),
        schema: {
          mode: 'verify',
          pool: {
            async query() {
              return { rows: [{ reg: null }] };
            },
          },
          migrators: [migrator],
          relations: ['public.p1_owned_assets'],
        },
        listen: () => {
          listened = true;
        },
      }),
    { message: 'schema mismatch: missing public.p1_owned_assets' },
  );
  assert.equal(listened, false);
});

test('sealed replica listens only after ports and schema succeed', async () => {
  let listened = false;
  const experience = new LateBound<string>('sessionRetrievalExperience');
  experience.bind('memory');
  await startSealedReplica({
    graph: createApiProductionGraph({
      ports: apiPorts(),
      runtimeFingerprint: fingerprint,
    }),
    lateBounds: [experience],
    schema: {
      mode: 'verify',
      pool: {
        async query() {
          return { rows: [{ reg: 'public.p1_owned_assets' }] };
        },
      },
      migrators: [
        {
          async migrate() {
            throw new Error('DDL must not run');
          },
        },
      ],
      relations: ['public.p1_owned_assets'],
    },
    listen: () => {
      listened = true;
    },
  });
  assert.equal(listened, true);
});

test('API/worker boot seals before listen and worker omits Session/Web assembly', async () => {
  const [core, api, worker, entry] = await Promise.all([
    readFile(new URL('./core-assembly.ts', import.meta.url), 'utf8'),
    readFile(new URL('./api-runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('./worker-runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../runtime-entry.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(core, /const assembleSessionWeb = options.role === 'api'/u);
  assert.match(core, /createWorkerProductionGraph\(/u);
  assert.match(core, /queuePrefix: runtimeFingerprint.queuePrefix/u);
  assert.match(core, /if \(schemaBootMode === 'migrate'\)/u);
  assert.match(core, /applySchemaBoot\(\{ mode: 'verify', pool, migrators: \[\] \}\)/u);
  assert.match(api, /seal\(\);\n  server.listen\(/u);
  assert.match(worker, /seal\(\);\n  await worker.start\(\)/u);
  assert.match(entry, /role === 'migrate'/u);
});

test('API and worker graphs carry the same runtime fingerprint contract', () => {
  const api = createApiProductionGraph({
    ports: apiPorts(),
    runtimeFingerprint: fingerprint,
  });
  const worker = createWorkerProductionGraph({
    ports: workerPorts(),
    runtimeFingerprint: fingerprint,
  });
  assert.deepEqual(api.runtimeFingerprint, worker.runtimeFingerprint);
});
