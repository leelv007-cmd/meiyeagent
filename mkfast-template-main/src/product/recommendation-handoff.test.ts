import assert from 'node:assert/strict';
import test from 'node:test';

import type { BrowserSurfaceProjection } from '@meiye/contracts';

import {
  applyRecommendationHandoff,
  applyRecommendationHandoffWithRecipe,
  buildRecommendationHandoff,
  replaceComposerDraftText,
} from './recommendation-handoff';
import { createComposerLensState } from './composer/lens-state-machine';

const REC = {
  title: '周末到店预约',
  whyNow: '周末客流高峰',
  customerAction: '点链接预约',
};

test('P0-4: handoff without outputHint does not preset any lens (esp. not copy)', () => {
  const handoff = buildRecommendationHandoff(REC);
  assert.equal(handoff.outputHint, undefined);
  assert.ok(handoff.intent.length > 0);

  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.phase, 'unselected');
  assert.equal(next.lensId, null);
  assert.equal(next.draft.userText, handoff.intent);
});

test('P0-4: handoff with outputHint selects that lens, not a hard-coded copy', () => {
  const handoff = buildRecommendationHandoff(REC, 'image_text');
  assert.equal(handoff.outputHint, 'image_text');

  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.phase, 'selected');
  assert.equal(next.lensId, 'image_text');
  assert.equal(next.draft.userText, handoff.intent);
});

test('P0-4: video outputHint is respected', () => {
  const handoff = buildRecommendationHandoff(REC, 'video');
  const next = applyRecommendationHandoff(createComposerLensState(), handoff);
  assert.equal(next.lensId, 'video');
});

const viralSurface = {
  surfaceId: 'surface.home.launch',
  revision: 9,
  revisionId: 'surface.home.launch@9',
  status: 'published',
  recipeRefs: [
    {
      recipeRevisionId: 'recipe.default_note@4',
      lensId: 'image_text',
      order: 1,
      featured: true,
      visible: true,
    },
    {
      recipeRevisionId: 'recipe.viral_adapt@2',
      lensId: 'image_text',
      order: 2,
      featured: false,
      visible: true,
    },
  ],
  contentHash: 'surface-hash',
  recipes: [
    {
      recipeId: 'recipe.default_note',
      revisionId: 'recipe.default_note@4',
      lensId: 'image_text',
      status: 'published',
      presentation: { title: '默认图文', summary: '默认路径' },
      delivery: {},
      contextPatches: {},
      sourceRequirements: [],
      modelPolicy: { mode: 'auto' },
      settingsPatches: {},
      promptRevisionRef: 'prompt.default@4',
      targetWorkspaceKind: 'image_text',
      contentHash: 'default-hash',
      revision: 4,
    },
    {
      recipeId: 'recipe.viral_adapt',
      revisionId: 'recipe.viral_adapt@2',
      lensId: 'image_text',
      status: 'published',
      presentation: { title: '爆款复刻', summary: '粘贴轨' },
      delivery: {
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverableKind: 'note',
      },
      contextPatches: {},
      sourceRequirements: [],
      modelPolicy: { mode: 'auto' },
      settingsPatches: { variantKey: 'viral_adapt' },
      promptRevisionRef: 'prompt.viral_adapt@2',
      targetWorkspaceKind: 'image_text',
      contentHash: 'viral-hash',
      revision: 2,
    },
  ],
} satisfies BrowserSurfaceProjection;

test('viral recommendation binds the exact visible formal recipe, never the first note recipe', () => {
  const outcome = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState(),
    handoff: {
      intent: '爆款复刻粘贴轨',
      outputHint: 'image_text',
      recipeChipId: 'viral_adapt',
    },
    surface: viralSurface,
  });

  assert.equal(outcome.kind, 'recipe_bound');
  assert.equal(outcome.state.draft.recipeRevisionId, 'recipe.viral_adapt@2');
  assert.equal(outcome.state.draft.userText, '爆款复刻粘贴轨');
});

test('viral recommendation fails closed when the formal recipe is not visible', () => {
  const outcome = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState(),
    handoff: {
      intent: '爆款复刻粘贴轨',
      outputHint: 'image_text',
      recipeChipId: 'viral_adapt',
    },
    surface: {
      ...viralSurface,
      recipeRefs: viralSurface.recipeRefs.filter(
        ({ recipeRevisionId }) => recipeRevisionId !== 'recipe.viral_adapt@2'
      ),
    },
  });

  assert.equal(outcome.kind, 'recipe_unavailable');
  assert.equal(outcome.state.draft.recipeRevisionId, null);
});

// ---------------------------------------------------------------------------
// D-C1 空填入、脏不碰
// ---------------------------------------------------------------------------

const XHS_CHIP = {
  intent: '帮我做一篇小红书图文笔记。',
  outputHint: 'image_text',
  recipeChipId: 'xhs_image_text',
} as const;

const VIRAL_CHIP = {
  intent: '帮我复刻一条爆款笔记。',
  outputHint: 'image_text',
  recipeChipId: 'viral_adapt',
} as const;

test('D-C1: a chip fills an empty box', () => {
  const outcome = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState(),
    handoff: XHS_CHIP,
    surface: viralSurface,
  });

  assert.equal(outcome.text, 'prefilled');
  assert.equal(outcome.state.draft.userText, XHS_CHIP.intent);
  assert.equal(outcome.state.lensId, 'image_text');
});

test('D-C1: a chip never rewrites a sentence the merchant already typed', () => {
  const typed = '帮我写一条美甲店夏日新款的小红书种草文案';
  const outcome = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState({ userText: typed }),
    handoff: XHS_CHIP,
    surface: viralSurface,
  });

  assert.equal(outcome.text, 'kept_user_text');
  assert.equal(outcome.state.draft.userText, typed);
  // The lens hint still lands — only the sentence is theirs.
  assert.equal(outcome.state.lensId, 'image_text');
});

test('D-C1: whitespace-only counts as empty', () => {
  const outcome = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState({ userText: '   \n ' }),
    handoff: XHS_CHIP,
    surface: viralSurface,
  });

  assert.equal(outcome.text, 'prefilled');
  assert.equal(outcome.state.draft.userText, XHS_CHIP.intent);
});

test('explicit remix replace overwrites a previous sample draft', () => {
  const first =
    '做一条小红书美业内容，主题是头皮护理，内容角度围绕“一天不洗就塌”；用“开场钩子—项目体验—到店行动”结构，语气真实克制，所有门店与价格事实由我稍后补充。';
  const second =
    '做一条抖音美业内容，主题是养发护理，内容角度围绕“养护要做多久才看得出来”；用“开场钩子—项目体验—到店行动”结构，语气真实克制，所有门店与价格事实由我稍后补充。';

  const filled = applyRecommendationHandoff(createComposerLensState(), {
    intent: first,
  });
  assert.equal(filled.draft.userText, first);

  const kept = applyRecommendationHandoff(filled, { intent: second });
  assert.equal(kept.draft.userText, first);

  const replaced = applyRecommendationHandoff(filled, {
    intent: second,
    replaceText: true,
  });
  assert.equal(replaced.draft.userText, second);

  const viaRecipe = applyRecommendationHandoffWithRecipe({
    state: filled,
    handoff: { intent: second, replaceText: true },
  });
  assert.equal(viaRecipe.text, 'prefilled');
  assert.equal(viaRecipe.state.draft.userText, second);
});

test('same-tab draft listener path overwrites on the second write', () => {
  const first = '做一条小红书美业内容，主题是头皮护理';
  const second = '做一条抖音美业内容，主题是养发护理';
  const afterFirst = replaceComposerDraftText(createComposerLensState(), first);
  assert.equal(afterFirst.draft.userText, first);
  const afterSecond = replaceComposerDraftText(afterFirst, second);
  assert.equal(afterSecond.draft.userText, second);
});

test('D-C1: a second chip binds its recipe and still leaves the text alone', () => {
  const typed = '帮我写一条美甲店夏日新款的小红书种草文案';
  const first = applyRecommendationHandoffWithRecipe({
    state: createComposerLensState({ userText: typed }),
    handoff: XHS_CHIP,
    surface: viralSurface,
  });
  const second = applyRecommendationHandoffWithRecipe({
    state: first.state,
    handoff: VIRAL_CHIP,
    surface: viralSurface,
  });

  assert.equal(second.kind, 'recipe_bound');
  assert.equal(second.text, 'kept_user_text');
  // The live repro this closes: the second chip used to leave the box empty.
  assert.notEqual(second.state.draft.userText, '');
  assert.equal(second.state.draft.userText, typed);
  assert.equal(second.state.draft.recipeRevisionId, 'recipe.viral_adapt@2');
});
