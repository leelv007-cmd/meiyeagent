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
import { resolve } from 'node:path';
import test from 'node:test';

import {
  callArgumentObjects,
  hasCall,
  hasValueImport,
  literals,
  parseProductionSource,
} from '../testing/ast-boundary.js';

const root = resolve(process.cwd(), '../..');

test('steering resolveAuthority scopes the run lookup to the request thread', () => {
  const parsed = parseProductionSource(
    resolve(root, 'apps/core/src/assembly/core-assembly.ts'),
  );
  assert.ok(
    literals(parsed).some((value) =>
      value.includes('AND run.thread_id = $4'),
    ),
    'the run lookup SQL must bind the request thread as $4',
  );
  assert.ok(
    literals(parsed).some((value) => value.includes('run.thread_id')),
  );
});

test('steering resolveAuthority still runs the admitted-binding guard', () => {
  const parsed = parseProductionSource(
    resolve(root, 'apps/core/src/assembly/core-assembly.ts'),
  );
  assert.equal(hasValueImport(parsed, 'steeringBindingMatchesAdmitted'), true);
  assert.equal(hasCall(parsed, 'steeringBindingMatchesAdmitted'), true);
  const guard = callArgumentObjects(
    parsed,
    'steeringBindingMatchesAdmitted',
  ).find(
    (props) =>
      props.runThreadId === 'binding.thread_id' &&
      props.admittedSnapshotHash === 'admitted.snapshot.snapshotHash',
  );
  assert.ok(
    guard,
    'the admitted-binding guard must compare run thread and snapshot hash',
  );
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
