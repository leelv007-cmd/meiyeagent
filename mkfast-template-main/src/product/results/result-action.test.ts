/**
 * ResultAction identity (WORK-01 / R-P1-08).
 *
 * Same revision from Works / Result / Workbench must mint the same action.
 * Only Result holds the write (`result_export`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeResultActionWrite,
  resultActionForRevision,
  resultActionIdentity,
  type ResultActionRevision,
} from './result-action';

const revision: ResultActionRevision = {
  contentId: 'package-note',
  platform: 'xiaohongshu',
  revision: 3,
  versionId: 'version-1',
  workId: 'work-note',
};

const WRITE_INTENTS = ['adopt', 'adjust', 'export', 'handoff'] as const;

test('same revision from Works/Result/Workbench yields the same action', () => {
  for (const intent of WRITE_INTENTS) {
    const fromWorks = resultActionIdentity(
      resultActionForRevision(revision, intent)
    );
    const fromResult = resultActionIdentity(
      resultActionForRevision(revision, intent)
    );
    const fromWorkbench = resultActionIdentity(
      resultActionForRevision(revision, intent)
    );
    assert.deepEqual(fromWorks, fromResult);
    assert.deepEqual(fromWorks, fromWorkbench);
    assert.equal(fromWorks.writer, 'result');
    assert.deepEqual(fromWorks.target, {
      contentId: 'package-note',
      panel:
        intent === 'adopt'
          ? 'result'
          : intent === 'adjust'
            ? 'adjust'
            : 'delivery',
      versionId: 'version-1',
      workId: 'work-note',
    });
  }
});

test('export action deep-links Result delivery and names the Result write', () => {
  const plan = resultActionForRevision(revision, 'export');
  assert.equal(
    plan.href,
    '/dashboard/results/work-note?contentId=package-note&versionId=version-1&panel=delivery'
  );
  assert.equal(plan.actionId, 'deliver');
  assert.deepEqual(plan.write, {
    action: 'result_export',
    idempotencyKey: 'export:package-note:3:xiaohongshu',
    kind: 'result_export',
    module: 'result-delivery',
    payload: {
      expectedRevision: 3,
      packageId: 'package-note',
      platform: 'xiaohongshu',
    },
  });
});

test('adopt/adjust/handoff open the exact Result panel and do not write', () => {
  assert.equal(resultActionForRevision(revision, 'adopt').write, null);
  assert.equal(resultActionForRevision(revision, 'adjust').write, null);
  assert.equal(resultActionForRevision(revision, 'handoff').write, null);
  assert.equal(
    resultActionForRevision(revision, 'adopt').href,
    '/dashboard/results/work-note?contentId=package-note&versionId=version-1&panel=result'
  );
  assert.equal(
    resultActionForRevision(revision, 'adjust').href,
    '/dashboard/results/work-note?contentId=package-note&versionId=version-1&panel=adjust'
  );
  assert.equal(
    resultActionForRevision(revision, 'handoff').target.panel,
    'delivery'
  );
});

test('Result is the only writer of result_export', async () => {
  const plan = resultActionForRevision(revision, 'export');
  const calls: unknown[] = [];
  await executeResultActionWrite(plan, async (module, call, key) => {
    calls.push({ call, key, module });
    return { downloadUrl: '/zip', receiptId: 'receipt-1' };
  });
  assert.deepEqual(calls, [
    {
      call: {
        action: 'result_export',
        payload: {
          expectedRevision: 3,
          packageId: 'package-note',
          platform: 'xiaohongshu',
        },
      },
      key: 'export:package-note:3:xiaohongshu',
      module: 'result-delivery',
    },
  ]);
  await assert.rejects(
    () =>
      executeResultActionWrite(
        resultActionForRevision(revision, 'adopt'),
        async () => {
          throw new Error('Works must not reach a write transport');
        }
      ),
    /no Result write/u
  );
});

test('Works return state rides the href without changing the action identity', () => {
  const withReturn = resultActionForRevision(revision, 'export', {
    returnState: {
      archiveId: 'package-note',
      focusKey: 'works-detail-actions',
      kind: 'works',
      scrollY: 180,
    },
  });
  const bare = resultActionForRevision(revision, 'export');
  assert.deepEqual(
    resultActionIdentity(withReturn),
    resultActionIdentity(bare)
  );
  assert.match(withReturn.href, /returnTo=works/u);
  assert.match(withReturn.href, /returnArchiveId=package-note/u);
  assert.match(withReturn.href, /returnScrollY=180/u);
  assert.match(withReturn.href, /returnFocusKey=works-detail-actions/u);
});
