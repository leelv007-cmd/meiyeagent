import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FileSystemLegacyCanvasManagedStorage,
  LegacyCanvasHistoryAccess,
  auditLegacyCanvasAccess,
  type LegacyCanvasManagedStorage,
} from './polotno-retirement-access.js';
import type { LegacyCanvasInventoryInput } from './polotno-retirement-inventory.js';

const workspaceId = 'workspace-history';

function pngBytes(marker: number) {
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, marker]);
}

function artifact(
  target:
    | { kind: 'work_revision'; revisionId: string; workId: string }
    | { kind: 'template_version'; templateId: string; versionId: string },
  marker: number
) {
  const bytes = pngBytes(marker);
  return {
    bytes,
    manifest: {
      contentType: 'image/png' as const,
      objectKey: `${workspaceId}/historical-canvas/${marker}.png`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
      target,
    },
  };
}

function document(extra: Record<string, unknown> = {}) {
  return {
    height: 1350,
    pages: [
      {
        elements: [
          {
            height: 120,
            id: 'headline',
            kind: 'text',
            rotation: 0,
            text: '夏日美甲',
            width: 800,
            x: 100,
            y: 100,
          },
        ],
        id: 'page-a',
      },
    ],
    width: 1080,
    ...extra,
  };
}

function fixture() {
  const rasters = [
    artifact(
      {
        kind: 'work_revision',
        revisionId: 'revision-convertible',
        workId: 'work-convertible',
      },
      1
    ),
    artifact(
      {
        kind: 'work_revision',
        revisionId: 'revision-future',
        workId: 'work-future',
      },
      2
    ),
    artifact(
      {
        kind: 'work_revision',
        revisionId: 'revision-raster',
        workId: 'work-raster',
      },
      3
    ),
    artifact(
      {
        kind: 'template_version',
        templateId: 'template-history',
        versionId: 'template-version-convertible',
      },
      4
    ),
    artifact(
      {
        kind: 'template_version',
        templateId: 'template-history',
        versionId: 'template-version-future',
      },
      5
    ),
    artifact(
      {
        kind: 'template_version',
        templateId: 'template-history',
        versionId: 'template-version-raster',
      },
      6
    ),
  ];
  const input: LegacyCanvasInventoryInput = {
    expectedInventory: {
      exportReceiptIds: [],
      revisionIds: [
        'revision-convertible',
        'revision-future',
        'revision-raster',
      ],
      templateIds: ['template-history'],
      templateVersionIds: [
        'template-version-convertible',
        'template-version-future',
        'template-version-raster',
      ],
      workIds: ['work-convertible', 'work-future', 'work-raster'],
    },
    exportReceipts: [],
    managedRasters: rasters.map((item) => item.manifest),
    templates: [
      {
        currentVersionId: 'template-version-future',
        id: 'template-history',
        versions: [
          { document: document(), id: 'template-version-convertible' },
          {
            document: document({ schemaVersion: 2 }),
            id: 'template-version-future',
          },
          {
            document: {
              height: 1350,
              pages: [
                {
                  elements: [{ id: 'legacy-shape', kind: 'shape' }],
                  id: 'page-raster',
                },
              ],
              width: 1080,
            },
            id: 'template-version-raster',
          },
        ],
      },
    ],
    workspaceId,
    works: [
      {
        currentRevisionId: 'revision-convertible',
        id: 'work-convertible',
        revisions: [{ document: document(), id: 'revision-convertible' }],
      },
      {
        currentRevisionId: 'revision-future',
        id: 'work-future',
        revisions: [
          { document: document({ schemaVersion: 2 }), id: 'revision-future' },
        ],
      },
      {
        currentRevisionId: 'revision-raster',
        id: 'work-raster',
        revisions: [
          {
            document: {
              height: 1350,
              pages: [
                {
                  elements: [{ id: 'legacy-shape', kind: 'shape' }],
                  id: 'page-raster',
                },
              ],
              width: 1080,
            },
            id: 'revision-raster',
          },
        ],
      },
    ],
  };
  const objects = new Map(
    rasters.map((item) => [item.manifest.objectKey, item.bytes])
  );
  const storage: LegacyCanvasManagedStorage = {
    async read(requestedWorkspaceId, objectKey) {
      assert.equal(requestedWorkspaceId, workspaceId);
      return objects.get(objectKey) ?? null;
    },
  };
  return { input, storage };
}

test('opens every historical disposition and keeps future documents read-only', async () => {
  const { input, storage } = fixture();
  const access = new LegacyCanvasHistoryAccess(input, storage);

  const convertible = await access.open(
    { workspaceId },
    {
      id: 'revision-convertible',
      kind: 'revision',
      workId: 'work-convertible',
    }
  );
  const future = await access.open(
    { workspaceId },
    { id: 'revision-future', kind: 'revision', workId: 'work-future' }
  );
  const raster = await access.open(
    { workspaceId },
    { id: 'revision-raster', kind: 'revision', workId: 'work-raster' }
  );

  assert.equal(convertible.mode, 'light_composer');
  assert.equal(convertible.editable, true);
  assert.equal(future.mode, 'read_only_document');
  assert.equal(future.editable, false);
  assert.equal(raster.mode, 'managed_raster');
  assert.deepEqual(raster.bytes, pngBytes(3));
});

test('opens a work and template by their current record instead of the worst historical disposition', async () => {
  const { input, storage } = fixture();
  input.expectedInventory.revisionIds.push('revision-old-raster');
  input.works[0]!.revisions.unshift({
    document: {
      height: 1350,
      pages: [
        {
          elements: [{ id: 'legacy-shape', kind: 'shape' }],
          id: 'page-old-raster',
        },
      ],
      width: 1080,
    },
    id: 'revision-old-raster',
  });
  input.expectedInventory.templateVersionIds.push('template-version-old-raster');
  input.templates[0]!.versions.unshift({
    document: {
      height: 1350,
      pages: [
        {
          elements: [{ id: 'legacy-shape', kind: 'shape' }],
          id: 'template-page-old-raster',
        },
      ],
      width: 1080,
    },
    id: 'template-version-old-raster',
  });
  const access = new LegacyCanvasHistoryAccess(input, storage);

  const work = await access.open(
    { workspaceId },
    { id: 'work-convertible', kind: 'work' }
  );
  const template = await access.open(
    { workspaceId },
    { id: 'template-history', kind: 'template' }
  );

  assert.equal(work.mode, 'light_composer');
  assert.equal(template.mode, 'read_only_document');
});

test('resolves revisions and template versions through their explicit parent ids', async () => {
  const { input, storage } = fixture();
  input.expectedInventory.workIds.unshift('revision-convertible');
  input.expectedInventory.revisionIds.unshift('collision-work-revision');
  input.works.unshift({
    currentRevisionId: 'collision-work-revision',
    id: 'revision-convertible',
    revisions: [
      {
        document: document({ collision: 'wrong-work' }),
        id: 'collision-work-revision',
      },
    ],
  });
  input.expectedInventory.templateIds.unshift('template-version-convertible');
  input.expectedInventory.templateVersionIds.unshift(
    'collision-template-version'
  );
  input.templates.unshift({
    currentVersionId: 'collision-template-version',
    id: 'template-version-convertible',
    versions: [
      {
        document: document({ collision: 'wrong-template' }),
        id: 'collision-template-version',
      },
    ],
  });
  const access = new LegacyCanvasHistoryAccess(input, storage);

  const revision = await access.open(
    { workspaceId },
    {
      id: 'revision-convertible',
      kind: 'revision',
      workId: 'work-convertible',
    }
  );
  const version = await access.open(
    { workspaceId },
    {
      id: 'template-version-convertible',
      kind: 'template_version',
      templateId: 'template-history',
    }
  );

  assert.equal(revision.mode, 'light_composer');
  assert.equal(version.mode, 'light_composer');
  assert.equal(
    (revision.document as { collision?: string }).collision,
    undefined
  );
  assert.equal((version.document as { collision?: string }).collision, undefined);
});

test('batch-audits workspace-scoped open and export for every work revision and template version', async () => {
  const { input, storage } = fixture();

  const report = await auditLegacyCanvasAccess(input, storage);

  assert.equal(report.passed, true);
  assert.equal(report.targets.length, 10);
  assert.equal(report.exportStrategy, 'existing_managed_raster_only');
  assert.equal(
    report.targets.every((target) => target.opened && target.exported),
    true
  );
  assert.equal(
    report.targets.every(
      (target) => target.exportSource === 'existing_managed_raster'
    ),
    true
  );
});

test('rejects cross-workspace access and client-controlled raster locations', async () => {
  const { input, storage } = fixture();
  const access = new LegacyCanvasHistoryAccess(input, storage);

  await assert.rejects(
    access.export(
      { workspaceId: 'workspace-foreign' },
      { id: 'work-convertible', kind: 'work' }
    ),
    /workspace/u
  );

  input.managedRasters[0]!.objectKey = 'https://provider.example/render.png';
  const unsafe = new LegacyCanvasHistoryAccess(input, storage);
  await assert.rejects(
    unsafe.export(
      { workspaceId },
      {
        id: 'revision-convertible',
        kind: 'revision',
        workId: 'work-convertible',
      }
    ),
    /managed raster object key/u
  );
});

test('fails the retirement access audit when an existing managed render is missing', async () => {
  const { input, storage } = fixture();
  input.managedRasters = input.managedRasters.filter(
    (raster) =>
      raster.target.kind !== 'work_revision' ||
      raster.target.revisionId !== 'revision-raster'
  );

  const report = await auditLegacyCanvasAccess(input, storage);

  assert.equal(report.passed, false);
  assert.deepEqual(
    report.targets.find(
      (target) =>
        target.target.kind === 'revision' &&
        target.target.id === 'revision-raster'
    ),
    {
      error: 'Historical Canvas target has no existing managed raster.',
      exported: false,
      opened: false,
      target: { id: 'revision-raster', kind: 'revision', workId: 'work-raster' },
    }
  );
});

test(
  'reads only workspace-owned artifacts beneath the batch audit managed root',
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'legacy-canvas-access-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const objectKey = `${workspaceId}/historical-canvas/render.png`;
    await mkdir(join(root, workspaceId, 'historical-canvas'), {
      recursive: true,
    });
    await writeFile(join(root, objectKey), pngBytes(9));
    const storage = new FileSystemLegacyCanvasManagedStorage(root);

    assert.deepEqual(await storage.read(workspaceId, objectKey), pngBytes(9));
    await assert.rejects(
      storage.read(workspaceId, `${workspaceId}/../foreign/render.png`),
      /object key is unsafe/u
    );
  }
);
