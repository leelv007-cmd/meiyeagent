import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CANVAS_WORK_NAME,
  contentPackageVersionSchema,
  contentPackageVersionSourceRefIsReadOnly,
} from '@meiye/contracts';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import { createCoreServer } from '../../server.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
} from './foundation-module.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
} from './index.js';
import {
  CANVAS_GENERATION_INPUT_ASSET_ROLES,
  CANVAS_GENERATION_PARAMETER_NAMES,
} from './supply-contracts.js';
import { createDefaultCatalogModels, createDefaultDeployments } from './catalog.js';
import { pinnedPromptResolver } from './prompt-pin.testing.js';

/**
 * RET-01 / D-170: Pro Studio model_canvas generation runtime is retired.
 * Old commands keep a rejection seam; live writers, SSE, outbox, and boot-time
 * CREATE TABLE IF NOT EXISTS model_canvas_* must stay gone.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');

const context: P1Context = {
  correlationId: 'corr-retired-canvas',
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

function retiredModule() {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const application = new ModelSupplyApplicationService({
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceStatus: 'recorded',
    }),
    execution: new RecordedProviderExecutionPort(),
    models: createDefaultCatalogModels(),
    promptResolver: pinnedPromptResolver,
    resultSink: repository,
  });
  const controlPlane = new ModelSupplyControlPlaneService({
    application,
    repository,
  });
  return new ModelSupplyFoundationModule(controlPlane);
}

const RETIRED_COMMANDS = [
  'canvas_generation_quote',
  'canvas_generation_submit',
  'canvas_generation_retry',
  'canvas_generation_cancel',
] as const;

const RETIRED_QUERIES = [
  'canvas_generation_catalog',
  'canvas_generation_job',
  'canvas_generation_jobs',
] as const;

test('retired canvas generation commands reject without reaching a live writer', async () => {
  const module = retiredModule();
  for (const action of RETIRED_COMMANDS) {
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: `retired-${action}`,
        input: { action, payload: {} },
      }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'COMMANDS_FROZEN' &&
        /retired/i.test(error.message),
      action,
    );
  }
});

test('retired canvas generation queries reject without reading model_canvas tables', async () => {
  const module = retiredModule();
  for (const action of RETIRED_QUERIES) {
    await assert.rejects(
      module.query({
        context,
        input: { action, payload: {} },
      }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'COMMANDS_FROZEN' &&
        /retired/i.test(error.message),
      action,
    );
  }
});

test('canvas text stream HTTP keeps an authenticated 410 tombstone', async (t) => {
  const server = createCoreServer({ serviceToken: 'canvas-retired-token' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/canvas/text/stream`;

  const unauthorized = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers: {
      'content-type': 'application/json',
      'x-service-token': 'canvas-retired-token',
    },
    method: 'POST',
  });
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('x-meiye-stream-protocol'), null);
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, 'CANVAS_TEXT_STREAM_RETIRED');
  assert.match(payload.error.message, /retired/i);
});

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

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

test('production sources have no live model_canvas writers or boot schema', () => {
  assert.deepEqual(
    filesMatching(/CREATE TABLE IF NOT EXISTS model_canvas_/i),
    [],
  );
  assert.deepEqual(
    filesMatching(/\b(?:INSERT INTO|UPDATE)\s+model_canvas_/i),
    [],
  );
  assert.deepEqual(
    filesMatching(/\bDROP TABLE(?: IF EXISTS)? model_canvas_/i),
    [],
  );
  assert.deepEqual(
    filesMatching(
      /\b(?:enqueueCanvasTextGeneration|saveCanvasGenerationQuote|appendCanvasTextGenerationStreamEvent|claimCanvasTextGeneration|streamCanvasTextGeneration|executeCanvasTextStream|startCanvasTextStream)\s*\(/,
    ),
    [],
  );
});

test('D-170 KEEP surfaces remain: canvas work name, generation schema, audio pipeline', () => {
  assert.equal(DEFAULT_CANVAS_WORK_NAME, 'canvas-work:untitled');
  assert.ok(CANVAS_GENERATION_PARAMETER_NAMES.includes('watermark'));
  assert.ok(CANVAS_GENERATION_INPUT_ASSET_ROLES.includes('mask'));
  assert.equal(
    existsSync(
      join(
        repositoryRoot,
        'apps/core/src/p1/model-supply/audio-contracts.ts',
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        repositoryRoot,
        'apps/core/src/p1/model-supply/audio-asset-pipeline.ts',
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(join(repositoryRoot, 'apps/core/src/pro-studio')),
    false,
  );
});

test('historical advancedCanvas ContentPackage sourceRef stays readable', () => {
  const sourceRef = {
    advancedCanvas: {
      orderedMediaNodeIds: ['node-image-b', 'node-image-a'],
      projectId: 'advanced-project-a',
      revisionId: 'advanced-revision-a',
      schemaVersion: 1,
      selectedNodeIds: ['node-text-a', 'node-image-a'],
    },
  };
  const parsed = contentPackageVersionSchema.parse({
    body: '历史画布采用正文',
    createdAt: '2026-08-01T00:00:00.000Z',
    id: 'package-advanced-canvas-v1',
    orderedAssetIds: ['asset-image-b', 'asset-image-a'],
    sourceRef,
    title: '历史画布采用标题',
    topics: [],
  });
  assert.deepEqual(parsed.sourceRef, sourceRef);
  assert.equal(contentPackageVersionSourceRefIsReadOnly(sourceRef), false);
});
