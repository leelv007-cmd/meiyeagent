import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NOTE_STYLES,
  NotePlanCompiler,
  noteConfirmationPolicy,
  passingNoteEvaluation,
  regenerateNotePlanPage,
  type NotePlanStructuredPort,
} from './note-plan-compiler.js';
import type { NotePlan } from '@meiye/contracts';

test('NotePlan compiles configured styles while keeping text dependencies serial', async () => {
  const calls: string[] = [];
  const compiler = new NotePlanCompiler(
    structuredPort(calls),
    imagePort(calls),
  );

  const drafts = await compiler.compileDrafts({
    intent: '介绍护理项目',
    factRefs: ['fact-1'],
    rightsRefs: ['rights-1'],
  });

  assert.deepEqual(
    drafts.candidates.map(({ styleName }) => styleName),
    ['干货科普版', '种草叙事版'],
  );
  assert.deepEqual(calls, [
    'plan',
    'text:practical_guide:page-1',
    'text:practical_guide:page-2',
    'text:story_recommendation:page-1',
    'text:story_recommendation:page-2',
  ]);
  assert.equal(
    drafts.candidates[0]?.plan.pages[1]?.textBlock.body.includes(
      'cover正文',
    ),
    true,
  );
});

test('selected style generates pages in parallel and records a bounded conflict regeneration', async () => {
  const calls: string[] = [];
  let concurrent = 0;
  let peakConcurrent = 0;
  let releaseInitial: (() => void) | undefined;
  const initialBarrier = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const compiler = new NotePlanCompiler(
    structuredPort(calls, true),
    {
      async generate({ page, reason }) {
        calls.push(`image:${reason}:${page.id}`);
        if (reason === 'initial') {
          concurrent += 1;
          peakConcurrent = Math.max(peakConcurrent, concurrent);
          if (concurrent === 2) releaseInitial?.();
          await initialBarrier;
          concurrent -= 1;
        }
        const suffix = reason === 'initial' ? 'initial' : 'regenerated';
        return generation(`${page.id}-${suffix}`);
      },
    },
  );
  const drafts = await compiler.compileDrafts({
    intent: '介绍护理项目',
    factRefs: [],
    rightsRefs: [],
  });
  calls.length = 0;

  const result = await compiler.selectAndGenerate({
    candidates: drafts,
    selectedStyleId: 'story_recommendation',
  });

  assert.equal(peakConcurrent, 2);
  assert.deepEqual(calls, [
    'image:initial:page-1',
    'image:initial:page-2',
    'evaluate:initial',
    'image:consistency_conflict:page-2',
    'evaluate:after_regeneration',
  ]);
  assert.equal(result.version.plan.pages[0]?.revision, 1);
  assert.equal(result.version.plan.pages[1]?.revision, 2);
  assert.equal(
    result.version.plan.pages[1]?.imageAssetId,
    'page-2-regenerated',
  );
  assert.deepEqual(result.version.regenerationReceipts, [
    {
      pageId: 'page-2',
      fromRevision: 1,
      toRevision: 2,
      imagePoints: 1,
      reason: 'consistency_conflict',
      auditRef: 'note-page-regeneration:page-2:r2',
    },
  ]);
  assert.ok(
    result.auditSignals.some(
      ({ eventType }) => eventType === 'note_consistency_evaluated',
    ),
  );
});

test('single-page regeneration changes only the target page and charges one image point', () => {
  const version = {
    schema: 'image-text-note-version/v1' as const,
    plan: basePlan(),
    evaluation: passingNoteEvaluation('2026-07-26T00:00:00.000Z'),
    regenerationReceipts: [],
  };
  version.plan.pages[0]!.imageAssetId = 'asset-page-1';
  version.plan.pages[1]!.imageAssetId = 'asset-page-2';

  const regenerated = regenerateNotePlanPage({
    version,
    pageId: 'page-2',
    imageAssetId: 'asset-page-2-new',
    auditRef: 'audit-page-2',
  });

  assert.deepEqual(regenerated.plan.pages[0], version.plan.pages[0]);
  assert.equal(regenerated.plan.pages[1]?.revision, 2);
  assert.equal(regenerated.plan.pages[1]?.imageAssetId, 'asset-page-2-new');
  assert.deepEqual(regenerated.regenerationReceipts.at(-1), {
    pageId: 'page-2',
    fromRevision: 1,
    toRevision: 2,
    imagePoints: 1,
    reason: 'merchant_request',
    auditRef: 'audit-page-2',
  });
});

test('confirmation timeout pauses for editing and never bypasses quota or side-effect approval', () => {
  assert.deepEqual(
    noteConfirmationPolicy({
      timeoutSeconds: 30,
      isEditing: false,
      exceedsAllowance: false,
      hasExternalSideEffect: false,
    }),
    { autoContinue: true, blocker: null, timeoutSeconds: 30 },
  );
  assert.equal(
    noteConfirmationPolicy({
      timeoutSeconds: 30,
      isEditing: true,
      exceedsAllowance: false,
      hasExternalSideEffect: false,
    }).blocker,
    'editing_paused',
  );
  assert.equal(
    noteConfirmationPolicy({
      timeoutSeconds: 30,
      isEditing: false,
      exceedsAllowance: true,
      hasExternalSideEffect: false,
    }).autoContinue,
    false,
  );
  assert.equal(
    noteConfirmationPolicy({
      timeoutSeconds: 30,
      isEditing: false,
      exceedsAllowance: false,
      hasExternalSideEffect: true,
    }).autoContinue,
    false,
  );
});

test('style reordering, addition and removal require no compiler code changes', async () => {
  const calls: string[] = [];
  const compiler = new NotePlanCompiler(
    structuredPort(calls),
    imagePort(calls),
  );
  const styles = {
    styles: [
      {
        ...DEFAULT_NOTE_STYLES.styles[1]!,
      },
      {
        id: 'local_story',
        name: '同城故事版',
        writingGuide: '突出同城生活场景。',
        structureTemplate: '同城场景、服务说明、预约建议。',
        platforms: ['xiaohongshu' as const],
      },
    ],
  };

  const drafts = await compiler.compileDrafts({
    intent: '介绍护理项目',
    factRefs: [],
    rightsRefs: [],
    styles,
  });

  assert.deepEqual(
    drafts.candidates.map(({ styleId }) => styleId),
    ['story_recommendation', 'local_story'],
  );
});

function structuredPort(
  calls: string[],
  conflict = false,
): NotePlanStructuredPort {
  return {
    async plan() {
      calls.push('plan');
      return basePlan();
    },
    async draftPage({ page, previousTextBlock, style }) {
      calls.push(`text:${style.id}:${page.id}`);
      return {
        title: `${style.name}-${page.pageRole}标题`,
        body: `${previousTextBlock?.body ?? ''}${page.pageRole}正文`,
        exactText: page.textBlock.exactText,
      };
    },
    async evaluate({ attempt }) {
      calls.push(`evaluate:${attempt}`);
      return {
        ...passingNoteEvaluation('2026-07-26T00:00:00.000Z'),
        regenerationPageIds:
          conflict && attempt === 'initial' ? ['page-2'] : [],
      };
    },
  };
}

function imagePort(calls: string[]) {
  return {
    async generate({
      page,
      reason,
    }: {
      page: NotePlan['pages'][number];
      reason: 'initial' | 'consistency_conflict' | 'merchant_request';
    }) {
      calls.push(`image:${reason}:${page.id}`);
      return generation(`${page.id}-${reason}`);
    },
  };
}

function generation(assetId: string) {
  return {
    asset: {
      id: assetId,
      objectKey: `workspace/generated/${assetId}.png`,
      contentType: 'image/png',
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
    },
    childRun: {
      runId: `run-${assetId}`,
      runType: 'model_job' as const,
      status: 'succeeded' as const,
      assetIds: [assetId],
      productUsage: { quantity: 1, status: 'committed' as const },
    },
  };
}

function basePlan(): NotePlan {
  return {
    schema: 'note-plan/v1',
    themeAnchor: '夏日护理先看真实需求',
    style: {
      id: 'planning',
      name: '规划中',
      positioning: '等待风格草稿',
    },
    pages: [
      page('page-1', 1, 'cover', 'capture_attention', []),
      page('page-2', 2, 'cta_guide', 'drive_action', [
        { pageId: 'page-1', kind: 'text_sequence' },
      ]),
    ],
  };
}

function page(
  id: string,
  order: number,
  pageRole: NotePlan['pages'][number]['pageRole'],
  pagePurpose: NotePlan['pages'][number]['pagePurpose'],
  dependencies: NotePlan['pages'][number]['dependencies'],
): NotePlan['pages'][number] {
  return {
    id,
    order,
    revision: 1,
    pageRole,
    pagePurpose,
    imageIntent: {
      operation: 'image.generate',
      purpose: `${pageRole}配图`,
      subject: '门店护理项目',
      scene: '真实门店场景',
      composition: '主体清晰',
      references: [],
      exactText: [],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' },
    },
    textBlock: {
      title: `${pageRole}标题`,
      body: `${pageRole}正文`,
      exactText: [],
    },
    dependencies,
  };
}
