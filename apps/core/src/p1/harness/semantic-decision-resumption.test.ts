import assert from 'node:assert/strict';
import test from 'node:test';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { buildTerminalSemanticDecisionSuccessor } from './semantic-decision-resumption.js';

test('terminal semantic successor derives a new paid execution root from the source snapshot', () => {
  const source = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submission-source',
      taskId: 'task-source',
      workId: 'work-source',
      contentPackageId: 'package-source',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '推广本店团购',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'xiaohongshu' },
      deliverables: [
        { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'auto' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-source', revision: 'quote-source-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-26T09:00:00.000Z',
  );

  const successor = buildTerminalSemanticDecisionSuccessor({
    command: {
      idempotencyKey: 'question-1:late_answer',
      questionId: 'question-1',
      workflowRevision: 1,
      patch: {
        field: 'offer_price',
        value: '398 元',
        reason: '补充当前任务所需的权威事实',
      },
      decision: { state: 'accepted', value: '398 元' },
    },
    contentPackageId: 'package-successor',
    createdAt: '2026-07-26T09:01:00.000Z',
    quote: { id: 'quote-successor', revision: 'quote-successor-r1' },
    sourceSnapshot: source,
    workflowId: 'task-successor',
    workId: 'work-successor',
  });

  assert.equal(successor.task.id, 'task-successor');
  assert.equal(successor.work.id, 'work-successor');
  assert.deepEqual(successor.contentPackage, {
    id: 'package-successor',
    expectedRevision: 0,
  });
  assert.deepEqual(successor.quote, {
    id: 'quote-successor',
    revision: 'quote-successor-r1',
  });
  assert.equal(successor.semanticDecision?.sourceSnapshotId, source.id);
  assert.deepEqual(successor.semanticDecision?.reference, {
    id: successor.semanticDecision?.reference.id,
    field: 'offer_price',
    value: '398 元',
    revision: 1,
  });
  assert.equal(source.semanticDecision, undefined);
  assert.equal(source.task.id, 'task-source');
});
