import assert from 'node:assert/strict';
import test from 'node:test';

import { inventoryLegacyCanvasData } from './polotno-retirement-inventory.js';

test('inventories every historical work revision and classifies its retirement path', () => {
  const report = inventoryLegacyCanvasData({
    expectedInventory: {
      exportReceiptIds: ['export-1'],
      revisionIds: ['revision-a', 'revision-b', 'revision-c'],
      templateIds: ['template-a'],
      templateVersionIds: ['template-version-a'],
      workIds: ['convertible-work', 'readonly-work', 'raster-work'],
    },
    exportReceipts: [
      {
        createdAt: '2026-07-15T04:00:00.000Z',
        id: 'export-1',
        workId: 'convertible-work',
      },
    ],
    managedRasters: [],
    templates: [
      {
        currentVersionId: 'template-version-a',
        id: 'template-a',
        versions: [
          {
            document: {
              height: 1350,
              pages: [{ elements: [], id: 'template-page' }],
              width: 1080,
            },
            id: 'template-version-a',
          },
        ],
      },
    ],
    workspaceId: 'workspace-history',
    works: [
      {
        currentRevisionId: 'revision-a',
        id: 'convertible-work',
        revisions: [
          {
            createdAt: '2026-07-15T01:00:00.000Z',
            document: {
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
            },
            id: 'revision-a',
          },
        ],
      },
      {
        currentRevisionId: 'revision-b',
        id: 'readonly-work',
        revisions: [
          {
            createdAt: '2026-07-15T02:00:00.000Z',
            document: {
              custom: { legacyEditor: 'polotno' },
              height: 1350,
              pages: [{ elements: [], id: 'page-b' }],
              width: 1080,
            },
            id: 'revision-b',
          },
        ],
      },
      {
        currentRevisionId: 'revision-c',
        id: 'raster-work',
        revisions: [
          {
            createdAt: '2026-07-15T03:00:00.000Z',
            document: {
              height: 1350,
              pages: [
                {
                  elements: [
                    {
                      fromNodeId: 'a',
                      id: 'edge',
                      kind: 'edge',
                      toNodeId: 'b',
                    },
                  ],
                  id: 'page-c',
                },
              ],
              width: 1080,
            },
            id: 'revision-c',
          },
        ],
      },
    ],
  });

  assert.deepEqual(report.totals, {
    exportRecords: 1,
    pages: 4,
    revisions: 3,
    templateVersions: 1,
    templates: 1,
    works: 3,
  });
  assert.equal(report.coverage.workPercent, 100);
  assert.equal(report.coverage.revisionPercent, 100);
  assert.deepEqual(
    report.works.map((work) => [work.id, work.disposition]),
    [
      ['convertible-work', 'convertible'],
      ['readonly-work', 'read_only'],
      ['raster-work', 'raster_fallback'],
    ]
  );
  assert.deepEqual(report.elementKinds, { edge: 1, text: 1 });
  assert.deepEqual(report.unknownFields, { 'document.custom': 1 });
  assert.equal(report.works[0]?.lastEditedAt, '2026-07-15T01:00:00.000Z');
  assert.equal(report.works[0]?.lastExportedAt, '2026-07-15T04:00:00.000Z');
  assert.equal(report.works[0]?.exportRecordCount, 1);
  assert.deepEqual(report.templates, [
    {
      currentVersionId: 'template-version-a',
      disposition: 'convertible',
      id: 'template-a',
      versionCount: 1,
      versions: [
        {
          disposition: 'convertible',
          id: 'template-version-a',
          managedRasterAvailable: false,
        },
      ],
    },
  ]);
  assert.deepEqual(report.works[1]?.revisions, [
    {
      createdAt: '2026-07-15T02:00:00.000Z',
      disposition: 'read_only',
      id: 'revision-b',
      managedRasterAvailable: false,
    },
  ]);
});

test('fails closed when the snapshot omits an expected historical record', () => {
  assert.throws(
    () =>
      inventoryLegacyCanvasData({
        expectedInventory: {
          exportReceiptIds: [],
          revisionIds: ['revision-a', 'revision-missing'],
          templateIds: [],
          templateVersionIds: [],
          workIds: ['work-a'],
        },
        exportReceipts: [],
        managedRasters: [],
        templates: [],
        workspaceId: 'workspace-history',
        works: [
          {
            currentRevisionId: 'revision-a',
            id: 'work-a',
            revisions: [
              {
                document: {
                  height: 1350,
                  pages: [{ elements: [], id: 'page-a' }],
                  width: 1080,
                },
                id: 'revision-a',
              },
            ],
          },
        ],
      }),
    /snapshot does not match the authoritative inventory/u
  );
});

test('fails closed when history references an unknown work or revision', () => {
  const input = {
    expectedInventory: {
      exportReceiptIds: ['export-missing'],
      revisionIds: ['revision-a'],
      templateIds: [],
      templateVersionIds: [],
      workIds: ['work-a'],
    },
    exportReceipts: [{ id: 'export-missing', workId: 'work-missing' }],
    managedRasters: [
      {
        contentType: 'image/png' as const,
        objectKey: 'workspace-history/work.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 8,
        target: {
          kind: 'work_revision' as const,
          revisionId: 'revision-missing',
          workId: 'work-a',
        },
      },
    ],
    templates: [],
    workspaceId: 'workspace-history',
    works: [
      {
        currentRevisionId: 'revision-a',
        id: 'work-a',
        revisions: [
          {
            document: {
              height: 1350,
              pages: [{ elements: [], id: 'page-a' }],
              width: 1080,
            },
            id: 'revision-a',
          },
        ],
      },
    ],
  };
  assert.throws(
    () => inventoryLegacyCanvasData(input),
    /orphaned historical reference/u
  );
});
