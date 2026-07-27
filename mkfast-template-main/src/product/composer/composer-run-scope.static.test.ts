import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const home = readFileSync(
  fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
  'utf8'
);

/**
 * 一次运行一套真相 (W03 recovery / ADR-0014).
 *
 * The event stream, the pending-question poll and the workflow query keys all
 * hang off the session's own task handle. A recovery entry unbinds that handle
 * (rebindComposerSession), and these are what stop the finished run from
 * streaming into the conversation the merchant is now rewriting.
 */
test('the composer only listens to the run its session currently holds', () => {
  assert.match(home, /const taskId = session\.task\?\.taskId \?\? '';/u);
  assert.match(
    home,
    /useWorkflowEventStream\(\{\s*enabled: Boolean\(taskId\),\s*workflowId: taskId,/u
  );
  assert.match(
    home,
    /enabled: Boolean\(taskId\) && session\.phase !== 'delivered'/u
  );
  // The stream is never pointed at anything but that handle — no URL taskId, no
  // remembered id from a run that already ended.
  assert.doesNotMatch(home, /workflowId: (?!taskId)[A-Za-z]/u);
});

/**
 * Adopting a server-side run is a mount-time decision. Once the merchant takes
 * the conversation over from a 申报, an unbound session must not read as an
 * empty tab inviting some other in-flight run in mid-edit.
 */
test('taking over from a 申报 closes the mount-time restore', () => {
  const recovery = home.slice(
    home.indexOf('const recoverFromReport'),
    home.indexOf('const attemptSubmit')
  );
  assert.ok(recovery.length > 0, 'recovery handler must exist');
  assert.match(recovery, /restoredFromServerRef\.current = true;/u);
  assert.match(
    recovery,
    /rebindComposerSession\(current, sessionIdRef\.current\)/u
  );
});
