/**
 * Mid-run steering authority isolation, pinned at the wiring.
 *
 * Incident 2026-08-15 (CI run 31879784097): a fix aimed at the mid-run
 * steering telemetry spec dropped `AND run.thread_id = $4` from the
 * resolveAuthority lookup and replaced `steeringBindingMatchesAdmitted`
 * with a snapshot-hash-only check. Steering could then bind across
 * threads, `campaign-paid-work-confirmation` («Work 1 and Work 2
 * independently») went red, and Core started rejecting L0.5 eval layer
 * writes as «immutable and already bound to different facts».
 *
 * The unit tests stayed green throughout, because the guard kept its own
 * passing test while nothing in production called it any more. These
 * assertions read the assembly source so unwiring the isolation fails
 * here instead of surfacing three jobs later as a cross-Work leak.
 *
 * Widening this boundary is a product decision (V31-90), not a test fix:
 * land the ticket's replacement contract before relaxing anything here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(process.cwd(), '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

test('steering resolveAuthority scopes the run lookup to the request thread', () => {
  const source = read('apps/core/src/assembly/core-assembly.ts');
  assert.match(source, /AND run\.thread_id = \$4/u);
  assert.match(source, /\[workspaceId, taskId, admitted\.workflowId, threadId\]/u);
});

test('steering resolveAuthority still runs the admitted-binding guard', () => {
  const source = read('apps/core/src/assembly/core-assembly.ts');
  assert.match(source, /steeringBindingMatchesAdmitted,/u);
  assert.match(source, /!steeringBindingMatchesAdmitted\(\{/u);
  assert.match(source, /runThreadId: binding\.thread_id/u);
  assert.match(source, /admittedSnapshotHash: admitted\.snapshot\.snapshotHash/u);
});

test('the guard rejects a thread that does not own the admitted run', async () => {
  const { steeringBindingMatchesAdmitted } = await import(
    './steering-service.js'
  );
  assert.equal(
    steeringBindingMatchesAdmitted({
      threadId: 'thread-other',
      runThreadId: 'thread-owning-the-run',
      runSnapshotHash: 'snap-1',
      admittedSnapshotHash: 'snap-1',
    }),
    false,
  );
});
