/**
 * Copy / image_text worksurface model tests (WT-D2 / #100).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADJUST_PROMPT_PLACEHOLDER,
  applyCopyFieldEdit,
  createCopyDocumentDraft,
  isClientConcatPlatformBody,
  previewSelectionRewrite,
  projectCopyImageTextWorksurface,
  projectCopyMobileP0Actions,
  projectFactSources,
  projectPlatformPreview,
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
  assert.notEqual('kind' in preview && (preview as { kind: string }).kind, 'invalid');
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
