import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerSubmissionBodySchema,
  submitComposerSubmission,
} from './composer-submission-client';

function submissionBody() {
  return {
    briefConfirmation: { id: 'brief-confirm-1', revision: 'draft-r3' },
    briefContext: { id: 'brief-context-1', revision: 3 },
    catalogModel: { id: 'catalog-copy-1', revision: 'catalog-r4' },
    contentPackagePlatform: 'douyin' as const,
    distributionTarget: 'export' as const,
    deliverable: { kind: 'copy_document' as const, quantity: 1 },
    identity: { id: 'identity-brand', revision: '2' },
    idempotencyKey: 'composer-submit-1',
    intent: '写一条夏日护理预约文案',
    quote: { id: 'quote-1', revision: 'quote-r2' },
    recipe: { id: 'recipe-summer', revision: 'recipe-summer@2' },
    sources: {
      assets: [
        {
          id: 'asset-store-1',
          revision: 'sha256-r1',
          role: 'reference' as const,
        },
      ],
    },
    surface: {
      id: 'surface.home.launch',
      revision: 'surface.home.launch@3',
    },
  };
}

test('browser submission carries signed public fields without server truth', () => {
  const parsed = composerSubmissionBodySchema.parse(submissionBody());
  assert.equal('route' in parsed, false);
  assert.equal('rights' in parsed, false);
  assert.equal('deliverables' in parsed, false);
  assert.equal('modelPolicy' in parsed, false);
  assert.equal(parsed.contentPackagePlatform, 'douyin');
  assert.equal(parsed.distributionTarget, 'export');
});

test('submits the exact Composer body and returns the durable handles', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: {
        contentPackage: { expectedRevision: 0, id: 'package-1' },
        replayed: false,
        snapshot: {
          id: 'snapshot-task-1',
          schemaVersion: 'creation-execution-snapshot/v1',
        },
        task: { id: 'task-1' },
        usageReservation: { id: 'usage-task-1' },
        work: { id: 'work-1' },
      },
    });
  };
  try {
    const result = await submitComposerSubmission(submissionBody());
    assert.equal(result.work.id, 'work-1');
    assert.equal(result.task.id, 'task-1');
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/composer/submissions'
    );
    assert.equal(request?.headers.get('idempotency-key'), 'composer-submit-1');
    assert.deepEqual(await request?.json(), submissionBody());
  } finally {
    globalThis.fetch = previousFetch;
  }
});
