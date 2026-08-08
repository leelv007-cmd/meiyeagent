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

test('createNotePageProgressReporter reports progress and may emit artifact.revised', async () => {
  const progress: Array<{ message: string; pageId?: string }> = [];
  const projected: SemanticEventCandidate[] = [];
  const report = createNotePageProgressReporter({
    plan: {
      pages: [{ id: 'p1', order: 1, textBlock: { title: '封面' } }],
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
  assert.equal(projected.length, 2);
  for (const candidate of projected) {
    assert.equal(candidate.eventType, 'artifact.revised');
    artifactUpdateWireSchema.parse(candidate.payload);
  }
});
