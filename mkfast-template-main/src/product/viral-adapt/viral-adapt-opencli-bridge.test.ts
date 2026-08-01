import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  VIRAL_OPENCLI_LIVE_GATE_EVIDENCE,
  ViralOpenCliBridgeError,
  mergeViralOpenCliAuthorizedSources,
  readViralOpenCliSource,
  type ViralOpenCliBridge,
} from './viral-adapt-opencli-bridge';

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
  assert.doesNotMatch(source, /intent:\s*(?:next\.)?sourcePayload/u);
  assert.doesNotMatch(
    source,
    /(?:sessionStore|sessionStorage).*sourcePayload|sourcePayload.*(?:sessionStore|sessionStorage)/u
  );
});
