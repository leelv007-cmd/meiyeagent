import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LatestViralOpenCliReadCoordinator,
  VIRAL_OPENCLI_LIVE_GATE_EVIDENCE,
  ViralOpenCliBridgeError,
  mergeViralOpenCliAuthorizedSources,
  readViralOpenCliSource,
  type ViralOpenCliBridge,
} from './viral-adapt-opencli-bridge';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

test('verified gate points at the redacted #328 evidence record', () => {
  assert.equal(VIRAL_OPENCLI_LIVE_GATE_EVIDENCE.verified, true);
  assert.equal(
    VIRAL_OPENCLI_LIVE_GATE_EVIDENCE.evidenceRef,
    'docs/ops/issue-328-opencli-live-gate-handover-2026-08-02.md'
  );
});

test('host bridge receives the complete URL once and returns only structured content', async () => {
  const calls: string[] = [];
  const bridge: ViralOpenCliBridge = {
    schemaVersion: 'meiye-opencli-bridge/v1',
    ready: true,
    async readXhsNote({ noteUrl }) {
      calls.push(noteUrl);
      return {
        schemaVersion: 'viral-opencli-read/v1',
        noteText: 'fixture note',
        authorizedAssets: [{ id: 'asset-1', revision: 'asset-revision-1' }],
      };
    },
  };
  const noteUrl =
    'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret';

  const result = await readViralOpenCliSource(bridge, noteUrl);

  assert.deepEqual(calls, [noteUrl]);
  assert.deepEqual(result, {
    schemaVersion: 'viral-opencli-read/v1',
    noteText: 'fixture note',
    authorizedAssets: [{ id: 'asset-1', revision: 'asset-revision-1' }],
  });
  assert.equal('noteUrl' in result, false);
});

test('bridge absence and errors stay generic and never echo the complete URL', async () => {
  const noteUrl =
    'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret';
  await assert.rejects(
    () => readViralOpenCliSource(null, noteUrl),
    (error: unknown) => {
      assert.ok(error instanceof ViralOpenCliBridgeError);
      assert.equal(error.code, 'bridge_absent');
      assert.doesNotMatch(error.message, /xsec_token|fixture-secret/u);
      return true;
    }
  );

  await assert.rejects(
    () =>
      readViralOpenCliSource(
        {
          schemaVersion: 'meiye-opencli-bridge/v1',
          ready: true,
          async readXhsNote() {
            throw new Error(`upstream failed for ${noteUrl}`);
          },
        },
        noteUrl
      ),
    (error: unknown) => {
      assert.ok(error instanceof ViralOpenCliBridgeError);
      assert.equal(error.code, 'read_failed');
      assert.doesNotMatch(
        error.message,
        /xiaohongshu\.com|xsec_token|fixture-secret/u
      );
      return true;
    }
  );
});

test('authorized bridge assets bind as revisioned untrusted Composer sources', () => {
  assert.deepEqual(
    mergeViralOpenCliAuthorizedSources(
      [{ id: 'existing', kind: 'asset', revision: 'r0' }],
      [
        { id: 'existing', revision: 'r0' },
        { id: 'downloaded', revision: 'r1' },
      ]
    ),
    {
      sources: [
        {
          id: 'existing',
          kind: 'asset',
          revision: 'r0',
          rightsStatus: 'public_marketing',
        },
        {
          id: 'downloaded',
          kind: 'asset',
          revision: 'r1',
          rightsStatus: 'public_marketing',
        },
      ],
    }
  );
  assert.deepEqual(
    mergeViralOpenCliAuthorizedSources(
      [{ id: 'downloaded', kind: 'asset', revision: 'stale' }],
      [{ id: 'downloaded', revision: 'r1' }]
    ),
    { error: 'source_conflict' }
  );
});

test('latest OpenCLI read wins when an aborted bridge request settles late', async () => {
  const coordinator = new LatestViralOpenCliReadCoordinator();
  const first = deferred<string>();
  const second = deferred<string>();
  const events: string[] = [];
  let firstSignal: AbortSignal | undefined;

  const firstRun = coordinator.run({
    read: (signal) => {
      firstSignal = signal;
      return first.promise;
    },
    commit: (value) => events.push(`commit:${value}`),
    fail: () => events.push('fail:first'),
  });
  const secondRun = coordinator.run({
    read: () => second.promise,
    commit: (value) => events.push(`commit:${value}`),
    fail: () => events.push('fail:second'),
  });

  assert.equal(firstSignal?.aborted, true);
  second.resolve('second');
  assert.equal(await secondRun, 'committed');
  first.resolve('first');
  assert.equal(await firstRun, 'superseded');
  assert.deepEqual(events, ['commit:second']);
});

test('cancelled OpenCLI read cannot commit after refresh or surface an error', async () => {
  const coordinator = new LatestViralOpenCliReadCoordinator();
  const refresh = deferred<void>();
  const events: string[] = [];
  let readSignal: AbortSignal | undefined;

  const run = coordinator.run({
    read: async (signal) => {
      readSignal = signal;
      return 'authorized result';
    },
    refresh: () => refresh.promise,
    commit: (value) => events.push(`commit:${value}`),
    fail: () => events.push('fail'),
  });
  await Promise.resolve();
  coordinator.cancel();
  refresh.resolve();

  assert.equal(await run, 'superseded');
  assert.equal(readSignal?.aborted, true);
  assert.deepEqual(events, []);
});

test('aborted OpenCLI bridge rejection stays silent', async () => {
  const coordinator = new LatestViralOpenCliReadCoordinator();
  const bridge = deferred<string>();
  const events: string[] = [];
  const run = coordinator.run({
    read: () => bridge.promise,
    commit: (value) => events.push(`commit:${value}`),
    fail: () => events.push('fail'),
  });

  coordinator.cancel();
  bridge.reject(new Error('host ignored AbortSignal'));

  assert.equal(await run, 'superseded');
  assert.deepEqual(events, []);
});

test('web bridge boundary never fetches localhost or shells out', () => {
  const source = readFileSync(
    new URL('./viral-adapt-opencli-bridge.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /fetch\s*\(/u);
  assert.doesNotMatch(source, /127\.0\.0\.1|localhost:19825/u);
  assert.doesNotMatch(source, /child_process|execFile|spawn/u);
});

test('Composer binds hidden source as a signed field, never merchant intent', () => {
  const source = readFileSync(
    new URL('../composer/composer-home.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /viralAdaptSource:\s*activeViralAdaptSource/u);
  assert.match(source, /bindViralAdaptSource/u);
  assert.match(source, /mergeViralOpenCliAuthorizedSources/u);
  assert.match(source, /intent:\s*(?:next\.)?merchantIntent/u);
  assert.doesNotMatch(
    source,
    /const activeViralAdaptSource =[\s\S]*?merchantIntent === userText/u
  );
  assert.doesNotMatch(
    source,
    /const bindingStillCurrent =[\s\S]*?merchantIntent === userText/u
  );
  assert.doesNotMatch(source, /intent:\s*(?:next\.)?sourcePayload/u);
  assert.doesNotMatch(
    source,
    /(?:sessionStore|sessionStorage).*sourcePayload|sourcePayload.*(?:sessionStore|sessionStorage)/u
  );
});
