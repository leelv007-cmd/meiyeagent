import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowProgressEnvelope } from '@meiye/contracts';

import {
  applyComposerProgress,
  bindComposerTask,
  createComposerSession,
} from './composer-session';

function progress(workflowId: string): WorkflowProgressEnvelope {
  return {
    eventId: `${workflowId}:event:2`,
    workflowId,
    workflowType: 'creation',
    sequence: 2,
    stage: 'context_injection',
    state: 'success',
    occurredAt: '2026-08-19T12:00:00.000Z',
    message: '已准备好本次主推荐',
  };
}

// Regression: ISSUE-009 — multiple runs reused React key progress:2
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('progress turn ids are unique across workflows in one thread', () => {
  let session = bindComposerTask(createComposerSession('thread-1'), {
    taskId: 'workflow-1',
    workId: 'work-1',
    packageId: 'package-1',
  });
  session = applyComposerProgress(session, progress('workflow-1'));
  session = bindComposerTask(session, {
    taskId: 'workflow-2',
    workId: 'work-2',
    packageId: 'package-2',
  });
  session = applyComposerProgress(session, progress('workflow-2'));

  const progressIds = session.turns
    .filter((turn) => turn.kind === 'stage' || turn.kind === 'route_notice')
    .map((turn) => turn.id);
  assert.deepEqual(progressIds, [
    'progress:workflow-1:2',
    'progress:workflow-2:2',
  ]);
  assert.equal(new Set(progressIds).size, progressIds.length);
});
