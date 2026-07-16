import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireWorkspaceCapability,
  workspaceCan,
  WorkspaceCapabilityError,
} from './workspace-authorization';

test('allows creators and rejects reviewers at storage and render sidecars', () => {
  assert.equal(workspaceCan('owner', 'content.create'), true);
  assert.equal(workspaceCan('operator', 'content.create'), true);
  assert.equal(workspaceCan('admin', 'content.create'), true);
  assert.equal(workspaceCan('reviewer', 'content.create'), false);
  assert.throws(
    () => requireWorkspaceCapability('reviewer', 'content.create'),
    (error: unknown) =>
      error instanceof WorkspaceCapabilityError &&
      error.code === 'FORBIDDEN' &&
      error.status === 403
  );
});
