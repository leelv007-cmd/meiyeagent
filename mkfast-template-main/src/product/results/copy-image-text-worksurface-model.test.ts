/**
 * Copy / image_text worksurface model tests (WT-D2 / #100 / P1-B2 / #151).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADJUST_PROMPT_PLACEHOLDER,
  applyCopyFieldEdit,
  captureStableSelectionAnchor,
  createCopyDocumentDraft,
  isClientConcatPlatformBody,
  previewSelectionRewrite,
  projectCopyImageTextWorksurface,
  projectCopyMobileP0Actions,
  projectDocumentWorksurface,
  projectFactSources,
  projectPlatformPreview,
  resolveSelectionAnchor,
  resolveSelectionRewrite,
  routeAdjustExecution,
  COPY_MOBILE_P0_ACTIONS,
} from './copy-image-text-worksurface-model';

const doc = {
  title: '夏日美甲',
  body: '限时优惠，立即抢购本店美甲套餐。',
  conversionHook: '私信预约',
  topics: ['美甲'],
  orderedAssetIds: ['img-1'],
};

test('document draft marks dirty on hand edit', () => {
  const draft = createCopyDocumentDraft(doc, 'rev-1');
  const next = applyCopyFieldEdit(draft, 'title', '新标题');
  assert.equal(next.title, '新标题');
  assert.equal(next.dirty, true);
  assert.equal(next.baseRevisionId, 'rev-1');
});

test('selection rewrite previews diff and routes to derived_task', () => {
  const draft = createCopyDocumentDraft(doc, 'rev-1');
  const preview = previewSelectionRewrite(draft, {
    action: 'shorten',
    field: 'body',
    start: 0,
    end: draft.body.length,
  });
  assert.notEqual(
    'kind' in preview && (preview as { kind: string }).kind,
    'invalid'
  );
  if (!('kind' in preview)) {
    assert.equal(preview.execution, 'derived_task');
    assert.ok(preview.after.length < preview.before.length);
  }
});

test('fact sources surface high-risk pending', () => {
  const projected = projectFactSources([
    {
      id: 'f1',
      kind: 'price',
      label: '美甲价',
      summary: '128',
      status: 'pending',
    },
    {
      id: 'f2',
      kind: 'customer_case',
      label: '案例',
      summary: '顾客 A',
      status: 'confirmed',
    },
  ]);
  assert.equal(projected.pendingCount, 1);
  assert.equal(projected.hasHighRiskPending, true);
});

test('platform preview rejects client_concat dual-track', () => {
  const rejected = projectPlatformPreview({
    request: {
      kind: 'client_concat',
      carrier: 'xiaohongshu',
      prefix: '平台版',
      body: '正文',
    },
  });
  assert.equal(rejected.kind, 'rejected');
  if (rejected.kind === 'rejected') {
    assert.equal(rejected.code, 'CLIENT_CONCAT_FORBIDDEN');
    assert.match(rejected.message, /copy\.adapt/);
  }
});

test('platform preview accepts formal copy.adapt variant only', () => {
  const ready = projectPlatformPreview({
    request: {
      kind: 'formal_adapt',
      carrier: 'xiaohongshu',
      baseRevisionId: 'rev-1',
      packageId: 'pkg-1',
    },
    formalVariant: {
      carrier: 'xiaohongshu',
      title: '小红书标题',
      body: '小红书正文',
      conversionHook: '点赞收藏',
      topics: ['美甲'],
      source: 'copy.adapt',
    },
  });
  assert.equal(ready.kind, 'ready');
  if (ready.kind === 'ready') {
    assert.equal(ready.variant.source, 'copy.adapt');
  }
});

test('isClientConcatPlatformBody detects legacy prefix hacks', () => {
  assert.equal(isClientConcatPlatformBody('平台版\n正文'), true);
  assert.equal(isClientConcatPlatformBody('【朋友圈】正文'), true);
  assert.equal(isClientConcatPlatformBody('正常正文'), false);
});

test('routeAdjustExecution: free_text → derived_task; hand_edit → OCC', () => {
  const free = routeAdjustExecution({
    kind: 'free_text',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    instruction: '语气更柔和一点',
  });
  assert.equal('path' in free && free.path, 'derived_task');

  const hand = routeAdjustExecution({
    kind: 'hand_edit',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    handEdit: {
      changes: { title: '手改标题' },
      expectedRevision: 2,
      packageId: 'pkg-1',
      reason: 'merchant_hand_edit',
    },
  });
  assert.equal('path' in hand && hand.path, 'occ_derived_revision');

  const platform = routeAdjustExecution({
    kind: 'platform_adapt',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
  });
  assert.equal('path' in platform && platform.path, 'derived_task');
});

test('surface projection keeps persistent 还想怎么改？ and no desktop gate', () => {
  const view = projectCopyImageTextWorksurface({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    document: doc,
    lifecycle: 'candidate',
    viewport: 'mobile',
  });
  assert.equal(view.adjustPrompt.placeholder, ADJUST_PROMPT_PLACEHOLDER);
  assert.equal(view.adjustPrompt.persistent, true);
  assert.equal(view.mobileDesktopGate, null);
  assert.equal(view.panels.edit, true);
  assert.equal(view.panels.platformPreview, true);
});

test('mobile P0 full actions — no please-continue-on-desktop', () => {
  const mobile = projectCopyMobileP0Actions();
  assert.equal(mobile.desktopOnlyMessage, null);
  for (const action of COPY_MOBILE_P0_ACTIONS) {
    assert.ok(mobile.actions.includes(action), `missing ${action}`);
  }
  assert.ok(mobile.actions.includes('adopt'));
  assert.ok(mobile.actions.includes('create_from_this'));
  assert.ok(mobile.actions.includes('free_text_adjust'));
});

test('stable selection anchor binds text + context hash', () => {
  const body = '限时优惠，立即抢购本店美甲套餐。';
  const start = body.indexOf('立即抢购');
  const end = start + '立即抢购'.length;
  const anchor = captureStableSelectionAnchor(body, 'body', start, end);
  assert.equal('kind' in anchor, false);
  if (!('kind' in anchor)) {
    assert.equal(anchor.selectedText, '立即抢购');
    assert.ok(anchor.prefix.length > 0);
    assert.ok(anchor.anchorHash.length === 8);
    const resolved = resolveSelectionAnchor(body, anchor);
    assert.equal(resolved.kind, 'ok');
    if (resolved.kind === 'ok') {
      assert.equal(resolved.start, start);
      assert.equal(resolved.end, end);
    }
  }
});

test('selection rewrite base drift returns conflict with compare options', () => {
  const body = '限时优惠，立即抢购本店美甲套餐。';
  const start = 0;
  const end = 4;
  const anchor = captureStableSelectionAnchor(body, 'body', start, end);
  assert.equal('kind' in anchor, false);
  if ('kind' in anchor) return;

  const conflict = resolveSelectionRewrite({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    currentRevisionId: 'rev-2',
    currentFieldText: body,
    action: 'weaker_promo',
    anchor,
  });
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind === 'conflict') {
    assert.equal(conflict.code, 'BASE_REVISION_DRIFT');
    assert.deepEqual(conflict.choices, ['compare', 'discard', 'reapply']);
    assert.match(conflict.message, /新版本/);
  }
});

test('selection rewrite success binds derived_task command to base + anchor', () => {
  const body = '限时优惠，立即抢购本店美甲套餐。';
  const start = body.indexOf('限时优惠');
  const end = start + '限时优惠'.length;
  const anchor = captureStableSelectionAnchor(body, 'body', start, end);
  assert.equal('kind' in anchor, false);
  if ('kind' in anchor) return;

  const ok = resolveSelectionRewrite({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    currentRevisionId: 'rev-1',
    currentFieldText: body,
    action: 'weaker_promo',
    anchor,
  });
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    assert.equal(ok.command.execution, 'derived_task');
    assert.equal(ok.command.baseRevisionId, 'rev-1');
    assert.equal(ok.command.anchor.anchorHash, anchor.anchorHash);
    assert.equal(ok.preview.execution, 'derived_task');
  }
});

test('anchor not found after text rewrite returns conflict', () => {
  const body = '限时优惠，立即抢购本店美甲套餐。';
  const anchor = captureStableSelectionAnchor(body, 'body', 0, 4);
  assert.equal('kind' in anchor, false);
  if ('kind' in anchor) return;

  const missing = resolveSelectionRewrite({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    currentRevisionId: 'rev-1',
    currentFieldText: '完全不同的正文，没有原选区。',
    action: 'rewrite',
    instruction: '改写',
    anchor,
  });
  assert.equal(missing.kind, 'conflict');
  if (missing.kind === 'conflict') {
    assert.equal(missing.code, 'ANCHOR_NOT_FOUND');
  }
});

test('document worksurface: primary expanded, alternatives on demand', () => {
  const face = projectDocumentWorksurface({
    candidates: [
      {
        candidateId: 'c01',
        title: '主推荐',
        body: '正文 A',
        conversionHook: '预约',
      },
      {
        candidateId: 'c02',
        title: '备选',
        body: '正文 B',
        conversionHook: '私信',
      },
    ],
  });
  assert.notEqual('kind' in face && (face as { kind: string }).kind, 'empty');
  if (!('kind' in face)) {
    assert.equal(face.primaryExpanded, true);
    assert.equal(face.alternativesExpandedDefault, false);
    assert.equal(face.primary.title, '主推荐');
    assert.equal(face.alternatives.length, 1);
    assert.equal(face.activeDocument.title, '主推荐');
  }

  const projected = projectCopyImageTextWorksurface({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    document: doc,
    alternativeCandidates: [
      {
        candidateId: 'alt-1',
        title: '备选标题',
        body: '备选正文',
        conversionHook: '到店',
      },
    ],
    lifecycle: 'candidate',
  });
  assert.ok(projected.documentFace);
  assert.equal(projected.documentFace?.primaryExpanded, true);
  assert.equal(projected.documentFace?.alternatives.length, 1);
  assert.equal(projected.panels.alternatives, true);
});
