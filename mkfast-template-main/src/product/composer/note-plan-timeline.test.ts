import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImageTextNoteVersion, NotePlan } from '@meiye/contracts';

import {
  applyBatchImageStatusFromHarnessStage,
  completeNotePlanPageRegenerate,
  editNotePlanPageOutline,
  notePlanCoverAndBody,
  notePlanTimelineHasOutlineEdit,
  notePlanTimelineShowsImageStatus,
  projectNotePlanTimelineFromPlan,
  projectNotePlanTimelineFromVersion,
  requestNotePlanPageRegenerate,
} from './note-plan-timeline';

function pageFixture(
  input: {
    id: string;
    order: number;
    pageRole: 'cover' | 'solution_show';
    pagePurpose: 'capture_attention' | 'explain_solution';
    title: string;
    body: string;
    imageAssetId?: string;
  }
): NotePlan['pages'][number] {
  return {
    id: input.id,
    order: input.order,
    revision: 1,
    pageRole: input.pageRole,
    pagePurpose: input.pagePurpose,
    textBlock: {
      title: input.title,
      body: input.body,
      exactText: [input.title],
    },
    imageIntent: {
      operation: 'image.generate',
      purpose: `${input.pageRole}配图`,
      subject: '门店护理项目',
      scene: '真实门店场景',
      composition: '主体清晰',
      references: [],
      exactText: [{ text: input.title, treatment: 'exact' }],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' },
    },
    dependencies:
      input.order === 1
        ? []
        : [{ pageId: 'page-1', kind: 'text_sequence' as const }],
    ...(input.imageAssetId ? { imageAssetId: input.imageAssetId } : {}),
  };
}

function planFixture(): NotePlan {
  return {
    schema: 'note-plan/v1',
    themeAnchor: '夏日补水图文笔记',
    style: {
      id: 'practical_guide',
      name: '干货科普版',
      positioning: '清楚可信',
    },
    pages: [
      pageFixture({
        id: 'page-1',
        order: 1,
        pageRole: 'cover',
        pagePurpose: 'capture_attention',
        title: '封面标题',
        body: '封面导语',
      }),
      pageFixture({
        id: 'page-2',
        order: 2,
        pageRole: 'solution_show',
        pagePurpose: 'explain_solution',
        title: '方案页',
        body: '方案正文',
        imageAssetId: 'asset-2',
      }),
    ],
  };
}

test('projectNotePlanTimelineFromPlan maps outline and image readiness', () => {
  const timeline = projectNotePlanTimelineFromPlan(planFixture(), {
    styleId: 'practical_guide',
    styleName: '干货科普版',
  });
  assert.equal(timeline.schema, 'note-plan-timeline/v1');
  assert.equal(timeline.themeAnchor, '夏日补水图文笔记');
  assert.equal(timeline.pages.length, 2);
  assert.equal(timeline.pages[0]?.imageStatus, 'pending');
  assert.equal(timeline.pages[1]?.imageStatus, 'ready');
  assert.equal(timeline.pages[1]?.imageAssetId, 'asset-2');
});

test('cover/body field-level projection: cover role + body pages', () => {
  const timeline = projectNotePlanTimelineFromPlan(planFixture());
  const { cover, bodyPages } = notePlanCoverAndBody(timeline);
  assert.equal(cover?.pageRole, 'cover');
  assert.equal(cover?.pageId, 'page-1');
  assert.deepEqual(
    bodyPages.map((page) => page.pageId),
    ['page-2']
  );
});

test('P1-5: edit ≥1 outline page and show image status (fixture)', () => {
  let timeline = projectNotePlanTimelineFromPlan(planFixture());
  assert.equal(notePlanTimelineHasOutlineEdit(timeline), false);

  timeline = editNotePlanPageOutline(timeline, {
    pageId: 'page-1',
    title: '改过的封面',
    body: '改过的导语',
  });
  assert.equal(timeline.pages[0]?.title, '改过的封面');
  assert.equal(timeline.pages[0]?.outlineDirty, true);
  assert.equal(notePlanTimelineHasOutlineEdit(timeline), true);

  timeline = applyBatchImageStatusFromHarnessStage(timeline, {
    stage: 'execution_selection',
    state: 'running',
  });
  assert.equal(timeline.pages[0]?.imageStatus, 'generating');
  assert.equal(notePlanTimelineShowsImageStatus(timeline), true);

  timeline = applyBatchImageStatusFromHarnessStage(timeline, {
    stage: 'execution_selection',
    state: 'success',
  });
  assert.ok(timeline.pages.every((page) => page.imageStatus === 'ready'));
});

test('per-page regenerate request + fixture complete', () => {
  let timeline = projectNotePlanTimelineFromPlan(planFixture());
  timeline = requestNotePlanPageRegenerate(timeline, 'page-2');
  assert.equal(timeline.pages[1]?.imageStatus, 'generating');
  assert.equal(timeline.pages[1]?.regenerateRequested, true);

  timeline = completeNotePlanPageRegenerate(timeline, {
    pageId: 'page-2',
    imageAssetId: 'asset-2-r2',
  });
  assert.equal(timeline.pages[1]?.imageStatus, 'ready');
  assert.equal(timeline.pages[1]?.imageAssetId, 'asset-2-r2');
  assert.equal(timeline.pages[1]?.revision, 2);
  assert.equal(timeline.pages[1]?.regenerateRequested, false);
});

test('projectNotePlanTimelineFromVersion preserves selected assets as ready', () => {
  const base = planFixture();
  const version: ImageTextNoteVersion = {
    schema: 'image-text-note-version/v1',
    plan: {
      ...base,
      pages: base.pages.map((page, index) => ({
        ...page,
        imageAssetId: `asset-${index + 1}`,
      })),
    },
    regenerationReceipts: [],
  };
  const timeline = projectNotePlanTimelineFromVersion(version);
  assert.ok(timeline.pages.every((page) => page.imageStatus === 'ready'));
});
