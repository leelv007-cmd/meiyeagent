/**
 * ToolHandoff whitelist + zero-write tests (C3 / #97, D-077 / D-092).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORBIDDEN_TOOL_HANDOFF_KEYS,
  STANDALONE_TOOL_ENTRY_IDS,
  TOOL_HANDOFF_ALLOWED_KEYS,
  assertToolHandoffUrlSafe,
  buildToolOpenHref,
  findForbiddenToolHandoffKey,
  openToolWithHandoff,
  parseToolHandoffFromSearchParams,
  projectToolHandoff,
  returnFromToolHandoff,
  serializeToolHandoffToSearchParams,
} from './tool-handoff';
import { COMPOSER_TOOL_ENTRY_SEEDS } from './tool-entry-seeds';
import {
  assertProStudioCanonicalHref,
  openComposerTool,
} from './composer-tools';

test('four standalone tool seeds match D-092 ids', () => {
  assert.deepEqual(
    COMPOSER_TOOL_ENTRY_SEEDS.map((t) => t.id),
    [...STANDALONE_TOOL_ENTRY_IDS]
  );
  assert.equal(COMPOSER_TOOL_ENTRY_SEEDS.length, 4);
});

test('projectToolHandoff accepts whitelist fields only', () => {
  const result = projectToolHandoff({
    toolEntryId: 'tool.multi_size',
    sourceKind: 'content',
    sourceId: 'cp_1',
    sourceRevisionId: 'cp_1@3',
    role: 'primary',
    returnToDraftKey: 'draft-abc',
    focusKey: 'source_content',
    minimalSettings: { aspectRatio: '3:4', quantity: 1 },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.handoff.toolEntryId, 'tool.multi_size');
  assert.equal(result.handoff.sourceId, 'cp_1');
  assert.deepEqual(result.handoff.minimalSettings, {
    aspectRatio: '3:4',
    quantity: 1,
  });
});

test('projectToolHandoff rejects body / auth / prompt / Provider / full draft', () => {
  const cases: Record<string, unknown>[] = [
    { toolEntryId: 'tool.multi_size', body: 'secret body text' },
    { toolEntryId: 'tool.multi_size', userText: 'full draft intent' },
    { toolEntryId: 'tool.multi_size', prompt: 'hidden system prompt' },
    { toolEntryId: 'tool.multi_size', Provider: 'openai' },
    { toolEntryId: 'tool.multi_size', provider: 'openai' },
    { toolEntryId: 'tool.multi_size', authorization: 'Bearer xxx' },
    { toolEntryId: 'tool.multi_size', draft: { userText: 'x' } },
    { toolEntryId: 'tool.multi_size', composerDraft: {} },
    { toolEntryId: 'tool.multi_size', assetRights: { ok: true } },
  ];
  for (const bag of cases) {
    const result = projectToolHandoff(bag);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bag)}`);
  }
});

test('projectToolHandoff rejects unknown keys outside whitelist', () => {
  const result = projectToolHandoff({
    toolEntryId: 'tool.multi_size',
    weirdExtra: 'nope',
  });
  assert.equal(result.ok, false);
});

test('URL serialization stays on whitelist and asserts safe', () => {
  const handoff = {
    toolEntryId: 'tool.batch_bg_remove' as const,
    sourceKind: 'asset' as const,
    sourceId: 'asset_9',
    sourceRevisionId: 'asset_9@1',
    role: 'gallery',
    returnToDraftKey: 'draft-1',
    focusKey: 'card-2',
    minimalSettings: { strength: 0.8 },
  };
  const params = serializeToolHandoffToSearchParams(handoff);
  const qs = params.toString();
  assertToolHandoffUrlSafe(qs);
  assert.ok(!/body=|prompt=|provider=|usertext=|draft=/i.test(qs));

  for (const key of params.keys()) {
    assert.ok(
      (TOOL_HANDOFF_ALLOWED_KEYS as readonly string[]).includes(key),
      `unexpected query key ${key}`
    );
  }

  const parsed = parseToolHandoffFromSearchParams(params);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.handoff.toolEntryId, 'tool.batch_bg_remove');
  assert.equal(parsed.handoff.sourceId, 'asset_9');
});

test('assertToolHandoffUrlSafe throws on sensitive material', () => {
  assert.throws(() => assertToolHandoffUrlSafe('?prompt=hello'), /forbidden/i);
  assert.throws(
    () => assertToolHandoffUrlSafe('?userText=full+draft'),
    /forbidden|draft|prompt/i
  );
  assert.throws(
    () => assertToolHandoffUrlSafe('{"provider":"openai"}'),
    /forbidden/i
  );
});

test('open/return produce zero business writes', () => {
  const opened = openToolWithHandoff({
    toolEntryId: 'tool.subtitle_erase',
    sourceId: 'work_1',
    sourceKind: 'work',
    returnToDraftKey: 'd1',
    focusKey: 'f1',
  });
  assert.deepEqual(opened.sideEffects, []);
  assertToolHandoffUrlSafe(opened.href);

  const returned = returnFromToolHandoff(opened.handoff);
  assert.deepEqual(returned.sideEffects, []);
  assert.equal(returned.returnToDraftKey, 'd1');
  assert.equal(returned.focusKey, 'f1');
});

test('Pro Studio always uses canonical /pro-studio gate (no Canvas deep link)', () => {
  const opened = openComposerTool('tool.pro_studio', {
    sourceId: 'cp_2',
    sourceKind: 'content_package',
    returnToDraftKey: 'draft-ps',
  });
  assertProStudioCanonicalHref(opened.href);
  assert.ok(opened.href.startsWith('/pro-studio'));
  assert.ok(!/canvas/i.test(opened.href));
  assert.deepEqual(opened.sideEffects, []);
});

test('buildToolOpenHref for ordinary tool keeps id path + allowlisted query', () => {
  const href = buildToolOpenHref({
    toolEntryId: 'tool.multi_size',
    sourceId: 'a1',
    sourceKind: 'asset',
  });
  assert.ok(href.startsWith('/dashboard/tools/tool.multi_size'));
  assert.ok(href.includes('sourceId=a1'));
  assertToolHandoffUrlSafe(href);
});

test('findForbiddenToolHandoffKey deep-scans nested bags', () => {
  const hit = findForbiddenToolHandoffKey({
    toolEntryId: 'x',
    minimalSettings: { prompt: 'nope' },
  });
  assert.ok(hit?.includes('prompt'));
});

test('FORBIDDEN list covers acceptance keywords', () => {
  const lower = FORBIDDEN_TOOL_HANDOFF_KEYS.map((k) => k.toLowerCase());
  for (const key of [
    'body',
    'prompt',
    'provider',
    'authorization',
    'draft',
    'usertext',
  ]) {
    assert.ok(
      lower.includes(key) || lower.some((k) => k.includes(key)),
      `missing forbidden key coverage for ${key}`
    );
  }
});
