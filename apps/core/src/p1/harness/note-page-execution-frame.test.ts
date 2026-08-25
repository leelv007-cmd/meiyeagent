/**
 * Symbol-anchor: notePageOrderLabel + createNotePageProgressReporter (V31-14).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createNotePageProgressReporter,
  e2eFirstCompletedNotePageHoldMs,
  notePageMerchantUnits,
  notePageOrderLabel,
} from './note-page-execution-frame.js';
import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';
import { artifactUpdateWireSchema } from '@meiye/contracts';

const here = dirname(fileURLToPath(import.meta.url));

test('symbol anchors live in note-page-execution-frame module', () => {
  const source = readFileSync(
    join(here, 'note-page-execution-frame.ts'),
    'utf8',
  );
  assert.match(source, /export function notePageOrderLabel/);
  assert.match(source, /export function createNotePageProgressReporter/);
  const core = readFileSync(join(here, 'workflow-core.ts'), 'utf8');
  assert.match(core, /from '\.\/note-page-execution-frame\.js'/);
  assert.doesNotMatch(core, /function notePageOrderLabel\s*\(/);
});

test('notePageOrderLabel maps page id to plan order', () => {
  const plan = {
    pages: [
      { id: 'p-a', order: 1 },
      { id: 'p-b', order: 2 },
    ],
  };
  assert.equal(notePageOrderLabel(plan, 'p-b'), '2');
  assert.equal(notePageOrderLabel(plan, 'missing'), 'missing');
});

test('notePageMerchantUnits maps 1-based order onto 封面 / 第N页 and 0-based pageIndex', () => {
  const plan = {
    pages: [
      { id: 'p-a', order: 1 },
      { id: 'p-b', order: 2 },
    ],
  };
  assert.deepEqual(notePageMerchantUnits(plan), [
    { unitId: 'p-a', label: '封面', pageIndex: 0 },
    { unitId: 'p-b', label: '第2页', pageIndex: 1 },
  ]);
});

test('createNotePageProgressReporter reports progress and may emit artifact.revised', async () => {
  const progress: Array<{ message: string; pageId?: string }> = [];
  const projected: SemanticEventCandidate[] = [];
  const report = createNotePageProgressReporter({
    plan: {
      pages: [
        { id: 'p1', order: 1, textBlock: { title: '封面', body: '周末护理限时' } },
      ],
    },
    reportProgress: async (event) => {
      progress.push(event);
    },
    artifactEmitter: {
      async project(candidate) {
        projected.push(candidate);
      },
    },
    artifactContext: {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      threadId: 'thread-1',
      artifactId: 'note:pkg-1',
      nextRevision: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n;
        };
      })(),
      now: () => '2026-08-08T12:00:00.000Z',
    },
  });

  await report({ pageId: 'p1', state: 'running' });
  await report({ pageId: 'p1', state: 'success' });

  assert.equal(progress.length, 2);
  assert.match(progress[0]!.message, /第 1 页/);
  // V31-15 three-stage page growth: skeleton → copy → image running → image ready.
  assert.equal(projected.length, 4);
  const updates = projected.map((candidate) => {
    assert.equal(candidate.eventType, 'artifact.revised');
    const parsed = artifactUpdateWireSchema.parse(candidate.payload);
    const pages =
      parsed.mode === 'snapshot' && 'pages' in parsed.full
        ? parsed.full.pages
        : parsed.mode === 'delta' && 'pages' in parsed.patch
          ? parsed.patch.pages
          : undefined;
    if (!pages) throw new Error('expected note artifact body');
    return {
      artifactId: parsed.artifactId,
      revision: parsed.revision,
      page: pages[0],
		status: parsed.status,
    };
  });
  assert.deepEqual(
    updates.map(({ page }) => page!.stage),
    ['skeleton', 'copy', 'image', 'image'],
  );
  assert.deepEqual(
    updates.map(({ revision }) => revision),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(updates.map(({ artifactId }) => artifactId)).size, 1);
  assert.equal(updates[1]!.page?.body, '周末护理限时');
	assert.equal(updates.at(-1)?.status, 'ready');
});

test('skeleton/copy stages emit once per page across regeneration runs', async () => {
  const projected: SemanticEventCandidate[] = [];
  const report = createNotePageProgressReporter({
    plan: {
      pages: [{ id: 'p1', order: 1, textBlock: { title: '封面' } }],
    },
    reportProgress: async () => undefined,
    artifactEmitter: {
      async project(candidate) {
        projected.push(candidate);
      },
    },
    artifactContext: {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      threadId: 'thread-1',
      artifactId: 'note:pkg-1',
      nextRevision: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n;
        };
      })(),
      now: () => '2026-08-08T12:00:00.000Z',
    },
  });

  await report({ pageId: 'p1', state: 'running' });
  await report({ pageId: 'p1', state: 'success' });
  await report({ pageId: 'p1', state: 'running' });
  await report({ pageId: 'p1', state: 'success' });

  const updates = projected.map((candidate) => {
    assert.equal(candidate.eventType, 'artifact.revised');
    const parsed = artifactUpdateWireSchema.parse(candidate.payload);
    const pages =
      parsed.mode === 'snapshot' && 'pages' in parsed.full
        ? parsed.full.pages
        : parsed.mode === 'delta' && 'pages' in parsed.patch
          ? parsed.patch.pages
          : undefined;
    if (!pages) throw new Error('expected note artifact body');
    return {
      revision: parsed.revision,
      page: pages[0],
		parentRevision: parsed.parentRevision,
    };
  });
  const stages = updates.map(({ page }) => page!.stage);
  assert.deepEqual(stages, ['skeleton', 'copy', 'image', 'image', 'image', 'image']);
  assert.deepEqual(
    updates.map(({ revision }) => revision),
    [1, 2, 3, 4, 5, 6],
  );
	assert.equal(updates[4]?.parentRevision, 4);
});

test('local regeneration continues the source artifact revision and becomes ready for its target subset', async () => {
  const projected: SemanticEventCandidate[] = [];
  let revision = 7;
  const report = createNotePageProgressReporter({
    plan: {
      pages: [
        { id: 'p1', order: 1, textBlock: { title: 'one' } },
        { id: 'p2', order: 2, textBlock: { title: 'two' } },
      ],
    },
    reportProgress: async () => undefined,
    artifactEmitter: { async project(candidate) { projected.push(candidate); } },
    artifactContext: {
      workspaceId: 'ws-1',
      workflowId: 'wf-successor',
      threadId: 'thread-source',
      artifactId: 'note:source-package',
      parentRevision: 7,
	  targetSourceUnitIds: ['p2'],
      nextRevision: () => { revision += 1; return revision; },
      now: () => '2026-08-09T12:00:00.000Z',
    },
  });

  await report({ pageId: 'p2', sourcePageId: 'p2', state: 'running' });
  await report({ pageId: 'p2', sourcePageId: 'p2', state: 'success' });

  const updates = projected.map((candidate) => artifactUpdateWireSchema.parse(candidate.payload));
  assert.equal(updates[0]?.artifactId, 'note:source-package');
  assert.equal(updates[0]?.mode, 'delta');
  assert.equal(updates[0]?.parentRevision, 7);
  assert.equal(updates.at(-1)?.status, 'ready');
});

test('non-contiguous subset becomes ready only after runner maps every source page to an executed page', async () => {
  const projected: SemanticEventCandidate[] = [];
  let revision = 7;
  const report = createNotePageProgressReporter({
    plan: {
      pages: [
        { id: 'execution-p1', order: 1 },
        { id: 'execution-p2', order: 2 },
        { id: 'execution-p3', order: 3 },
      ],
    },
    reportProgress: async () => undefined,
    artifactEmitter: { async project(candidate) { projected.push(candidate); } },
    artifactContext: {
      workspaceId: 'ws-1',
      workflowId: 'wf-successor',
      threadId: 'thread-source',
      artifactId: 'note:source-package',
      parentRevision: 7,
      targetSourceUnitIds: ['source-p1', 'source-p3'],
      nextRevision: () => { revision += 1; return revision; },
      now: () => '2026-08-09T12:00:00.000Z',
    },
  });

  await report({ pageId: 'execution-p1', sourcePageId: 'source-p1', state: 'running' });
  await report({ pageId: 'execution-p1', sourcePageId: 'source-p1', state: 'success' });
  assert.notEqual(
    artifactUpdateWireSchema.parse(projected.at(-1)?.payload).status,
    'ready',
  );
  await report({ pageId: 'execution-p3', sourcePageId: 'source-p3', state: 'running' });
  await report({ pageId: 'execution-p3', sourcePageId: 'source-p3', state: 'success' });

  assert.equal(
    artifactUpdateWireSchema.parse(projected.at(-1)?.payload).status,
    'ready',
  );
});

test('e2e first-page hold is zero without the Playwright fixture lever', () => {
  assert.equal(e2eFirstCompletedNotePageHoldMs({}), 0);
  assert.equal(e2eFirstCompletedNotePageHoldMs({ APP_ENV: 'e2e' }), 0);
  assert.equal(
    e2eFirstCompletedNotePageHoldMs({
      APP_ENV: 'production',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
    }),
    0,
  );
  assert.equal(
    e2eFirstCompletedNotePageHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
    }),
    10_000,
  );
  assert.equal(
    e2eFirstCompletedNotePageHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '50',
    }),
    50,
  );
  assert.equal(
    e2eFirstCompletedNotePageHoldMs({
      APP_ENV: 'e2e',
      E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS: '20000',
      E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '50',
    }),
    20_000,
  );
});

test('reporter bursts without the e2e hold and waits once with it', async () => {
  const report = createNotePageProgressReporter({
    plan: {
      pages: [
        { id: 'p1', order: 1 },
        { id: 'p2', order: 2 },
      ],
    },
    reportProgress: async () => undefined,
  });
  const burstStart = Date.now();
  await report({ pageId: 'p1', state: 'success' });
  await report({ pageId: 'p2', state: 'success' });
  assert.ok(Date.now() - burstStart < 50);

  const priorAppEnv = process.env.APP_ENV;
  const priorHold = process.env.E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS;
  process.env.APP_ENV = 'e2e';
  process.env.E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS = '80';
  try {
    const held = createNotePageProgressReporter({
      plan: {
        pages: [
          { id: 'p1', order: 1 },
          { id: 'p2', order: 2 },
        ],
      },
      reportProgress: async () => undefined,
    });
    const heldStart = Date.now();
    await Promise.all([
      held({ pageId: 'p1', state: 'success' }),
      held({ pageId: 'p2', state: 'success' }),
    ]);
    assert.ok(Date.now() - heldStart >= 80);
  } finally {
    if (priorAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = priorAppEnv;
    if (priorHold === undefined) {
      delete process.env.E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS;
    } else {
      process.env.E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS = priorHold;
    }
  }
});

test('reporter serializes a hold after every non-final page in e2e', async () => {
  const priorAppEnv = process.env.APP_ENV;
  const priorHold = process.env.E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS;
  process.env.APP_ENV = 'e2e';
  process.env.E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS = '50';
  try {
    const held = createNotePageProgressReporter({
      plan: {
        pages: [
          { id: 'p1', order: 1 },
          { id: 'p2', order: 2 },
          { id: 'p3', order: 3 },
        ],
      },
      reportProgress: async () => undefined,
    });
    const heldStart = Date.now();
    await Promise.all([
      held({ pageId: 'p1', state: 'success' }),
      held({ pageId: 'p2', state: 'success' }),
      held({ pageId: 'p3', state: 'success' }),
    ]);
    // Two non-final pages each wait 50ms, serialized.
    assert.ok(Date.now() - heldStart >= 100);
  } finally {
    if (priorAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = priorAppEnv;
    if (priorHold === undefined) {
      delete process.env.E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS;
    } else {
      process.env.E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS = priorHold;
    }
  }
});
