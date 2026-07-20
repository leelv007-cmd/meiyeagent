import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ContentPackage,
  CreativeJob,
  CreativeWork,
} from '@meiye/contracts';
import {
  contentPackageGenerationAttachmentTarget,
  createContentPackageGenerationAttachmentCommand,
} from './content-package-generation-attachment';

function contentPackage(id: string, workId: string): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-17T00:00:00.000Z',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id,
    kind: 'image_text',
    lineage: {},
    currentVersionId: `${id}-v1`,
    revision: 0,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId },
    status: 'accepted',
    updatedAt: '2026-07-17T00:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
  };
}

function work(
  id: string,
  sessionId: string,
  derivedFrom?: string
): Pick<CreativeWork, 'derivedFrom' | 'id' | 'sessionId'> {
  return { ...(derivedFrom ? { derivedFrom } : {}), id, sessionId };
}

test('targets only the unique ContentPackage from the current creation Session', () => {
  const works = [
    work('copy-work', 'session-shared'),
    work('image-work', 'session-shared'),
    work('other-work', 'session-other'),
  ];
  const packages = [
    contentPackage('package-shared', 'copy-work'),
    contentPackage('package-other', 'other-work'),
  ];

  assert.equal(
    contentPackageGenerationAttachmentTarget({
      contentPackages: packages,
      currentWork: works[1]!,
      works,
    })?.id,
    'package-shared'
  );
  assert.equal(
    contentPackageGenerationAttachmentTarget({
      contentPackages: [
        ...packages,
        contentPackage('package-shared-2', 'copy-work'),
      ],
      currentWork: works[1]!,
      works,
    }),
    undefined
  );
  assert.equal(
    contentPackageGenerationAttachmentTarget({
      contentPackages: packages,
      currentWork: work('missing-work', 'session-missing'),
      works,
    }),
    undefined
  );
});

test('ignores non-adopted and video packages in the same creation Session', () => {
  const works = [
    work('copy-work', 'session-shared'),
    work('image-work', 'session-shared'),
    work('video-work', 'session-shared'),
  ];
  const adopted = contentPackage('package-adopted', 'copy-work');
  const draft = contentPackage('package-draft', 'copy-work');
  delete draft.currentVersionId;
  const video = {
    ...contentPackage('package-video', 'video-work'),
    currentVersionId: 'package-video-v1',
    kind: 'video' as const,
  };
  const cancelled = {
    ...contentPackage('package-cancelled', 'copy-work'),
    status: 'cancelled' as const,
  };

  assert.equal(
    contentPackageGenerationAttachmentTarget({
      contentPackages: [draft, video, cancelled, adopted],
      currentWork: works[1]!,
      works,
    })?.id,
    adopted.id
  );
});

test('uses Work lineage to resolve multiple adopted packages in one Session', () => {
  const works = [
    work('copy-work-a', 'session-shared'),
    work('copy-work-b', 'session-shared'),
    work('image-work', 'session-shared', 'copy-work-b'),
  ];

  assert.equal(
    contentPackageGenerationAttachmentTarget({
      contentPackages: [
        contentPackage('package-a', 'copy-work-a'),
        contentPackage('package-b', 'copy-work-b'),
      ],
      currentWork: works[2]!,
      works,
    })?.id,
    'package-b'
  );
});

test('builds a stable attach command from the completed CreativeJob and ordered outputs', () => {
  const job = {
    id: 'creative-job-image',
    status: 'completed',
  } satisfies Pick<CreativeJob, 'id' | 'status'>;
  const input = {
    assetIds: ['creative-asset-b', 'creative-asset-a'],
    expectedRevision: 4,
    job,
    packageId: 'content-package-1',
  };

  const first = createContentPackageGenerationAttachmentCommand(input);
  const replay = createContentPackageGenerationAttachmentCommand(input);

  assert.deepEqual(first, replay);
  assert.equal(first.action, 'attach_content_package_generation');
  assert.deepEqual(first.payload, {
    assetIds: ['creative-asset-b', 'creative-asset-a'],
    childRun: {
      assetIds: ['creative-asset-b', 'creative-asset-a'],
      runId: 'creative-job-image',
      runType: 'creative_job',
      status: 'succeeded',
    },
    expectedRevision: 4,
    packageId: 'content-package-1',
  });
  assert.match(
    first.idempotencyKey,
    /^attach-content-package-generation:content-package-1:4:creative-job-image:/
  );
  assert.notEqual(
    first.idempotencyKey,
    createContentPackageGenerationAttachmentCommand({
      ...input,
      assetIds: [...input.assetIds].reverse(),
    }).idempotencyKey
  );
});

test('rejects non-completed jobs and empty output lists before issuing a command', () => {
  assert.throws(() =>
    createContentPackageGenerationAttachmentCommand({
      assetIds: ['creative-asset-image'],
      expectedRevision: 0,
      job: { id: 'creative-job-running', status: 'running' },
      packageId: 'content-package-1',
    })
  );
  assert.throws(() =>
    createContentPackageGenerationAttachmentCommand({
      assetIds: [],
      expectedRevision: 0,
      job: { id: 'creative-job-image', status: 'completed' },
      packageId: 'content-package-1',
    })
  );
});
