import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoWorkflowBinding } from './video-workflow-binding';

test('canonical videoWorkflowId wins, so a shot edit cannot unbind the run', () => {
  // What the canonical store writes back on every mutation (`storedJob`):
  // videoWorkflowId present, providerJobId dropped. Binding on providerJobId
  // alone is what made one edit plus a reload lose the storyboard.
  assert.equal(
    resolveVideoWorkflowBinding({ videoWorkflowId: 'video-workflow-e2e-1' }),
    'video-workflow-e2e-1'
  );
  // And it still wins when a stale providerJobId is also present.
  assert.equal(
    resolveVideoWorkflowBinding({
      providerJobId: 'video-workflow-stale',
      videoWorkflowId: 'video-workflow-e2e-1',
    }),
    'video-workflow-e2e-1'
  );
});

test('a historical originating Job still binds through providerJobId', () => {
  // Written by the pre-ContentPackage creation path and never touched by the
  // canonical store, so it carries only the prefixed providerJobId.
  assert.equal(
    resolveVideoWorkflowBinding({ providerJobId: 'video-workflow-legacy-7' }),
    'video-workflow-legacy-7'
  );
});

test('neither field, or a providerJobId that names something else, binds nothing', () => {
  assert.equal(resolveVideoWorkflowBinding({}), undefined);
  assert.equal(resolveVideoWorkflowBinding(null), undefined);
  assert.equal(resolveVideoWorkflowBinding(undefined), undefined);
  // A provider job id from any other execution must not be read as a workflow.
  assert.equal(
    resolveVideoWorkflowBinding({ providerJobId: 'model-job-video-native' }),
    undefined
  );
  // An empty canonical id is not a binding either — it falls through.
  assert.equal(
    resolveVideoWorkflowBinding({
      providerJobId: 'video-workflow-legacy-7',
      videoWorkflowId: '',
    }),
    'video-workflow-legacy-7'
  );
});
