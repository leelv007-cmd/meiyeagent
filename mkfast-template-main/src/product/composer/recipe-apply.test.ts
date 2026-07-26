/**
 * Recipe apply session — local apply / conflict / undo / zero writes (C2 / #96).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAUNCH_CARD_SEEDS,
  seedToRecipeTarget,
  switchedTipLabel,
} from './launch-card-seeds';
import {
  assertZeroBusinessWrites,
  cancelApply,
  confirmApply,
  createRecipeApplySession,
  requestApplyRecipe,
  undoApply,
} from './recipe-apply';
import {
  createComposerLensState,
  selectLens,
  updateSettings,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';

const posterSeed = LAUNCH_CARD_SEEDS.find(
  (s) => s.recipeId === 'recipe.promotion_poster'
)!;
const xhsSeed = LAUNCH_CARD_SEEDS.find(
  (s) => s.recipeId === 'recipe.case_to_xhs_note'
)!;
const introSeed = LAUNCH_CARD_SEEDS.find(
  (s) => s.recipeId === 'recipe.project_intro'
)!;

test('cold apply: no conflict → local apply, preserves user text, zero writes', () => {
  const original = '帮我写一条朋友圈，保留这句话';
  let session = createRecipeApplySession(
    createComposerLensState({ userText: original })
  );
  const recipe = seedToRecipeTarget(posterSeed);

  const result = requestApplyRecipe(session, recipe);
  assert.equal(result.kind, 'applied');
  session = result.session;

  assert.equal(session.phase, 'applied');
  assert.equal(session.lensState.phase, 'selected');
  assert.equal(session.lensState.lensId, 'image_text');
  assert.equal(session.lensState.draft.userText, original);
  assert.equal(session.lensState.draft.recipeRevisionId, recipe.revisionId);
  assert.match(session.tip ?? '', /已选择图文并套用/);
  assert.match(session.tip ?? '', /促销海报/);
  assert.equal(session.canUndo, true);
  assert.ok(session.focusMissing); // promotion_facts missing
  assert.equal(session.focusMissing?.slot, 'promotion_facts');
  assert.equal(session.announcement, session.tip);
  assertZeroBusinessWrites(session);
  assert.deepEqual(session.sideEffects, []);
});

test('apply never injects a hidden prompt — user original text stays byte-identical', () => {
  const original = '用户原文·请勿被预设覆盖';
  let session = createRecipeApplySession(
    createComposerLensState({ userText: original })
  );
  // Simulate a hostile recipe that might try to carry intent-like settings.
  const recipe = {
    ...seedToRecipeTarget(xhsSeed),
    settingsPatches: {
      variantKey: 'xhs_image_text',
      ['internal' + 'Intent']: '生成一组内部稳定执行指令，不向用户展示。',
    },
  };

  const result = requestApplyRecipe(session, recipe);
  assert.equal(result.kind, 'applied');
  session = result.session;

  assert.equal(session.lensState.draft.userText, original);
  assert.notEqual(
    session.lensState.draft.userText,
    '生成一组内部稳定执行指令，不向用户展示。'
  );
  // settings may carry the key but userText path is gone
  assert.equal(session.lensState.draft.userText.includes('内部'), false);
});

test('cross-lens conflict → confirming surface; cancel restores; confirm applies', () => {
  let lens: ComposerLensState = createComposerLensState({
    userText: '已选文案的正文',
  });
  lens = selectLens(lens, 'copy');
  let session = createRecipeApplySession(lens);

  const poster = seedToRecipeTarget(posterSeed);
  const result = requestApplyRecipe(session, poster);
  assert.equal(result.kind, 'confirming');
  session = result.session;

  assert.equal(session.phase, 'confirming');
  assert.ok(session.preview);
  assert.equal(session.preview?.conflictKind, 'cross_lens');
  assert.equal(session.preview?.requiresConfirmation, true);
  assert.equal(session.preview?.primaryCtaLabel, '切换到图文并套用');
  assert.equal(session.preview?.cancelCtaLabel, '取消');
  // Active lens unchanged until confirm.
  assert.equal(session.lensState.lensId, 'copy');
  assert.equal(session.lensState.draft.userText, '已选文案的正文');
  assertZeroBusinessWrites(session);

  // Cancel restores completely.
  session = cancelApply(session);
  assert.equal(session.phase, 'idle');
  assert.equal(session.lensState.lensId, 'copy');
  assert.equal(session.lensState.draft.userText, '已选文案的正文');
  assert.equal(session.preview, null);
  assertZeroBusinessWrites(session);

  // Re-request and confirm.
  const again = requestApplyRecipe(session, poster);
  assert.equal(again.kind, 'confirming');
  session = confirmApply(again.session);
  assert.equal(session.phase, 'applied');
  assert.equal(session.lensState.lensId, 'image_text');
  assert.equal(session.lensState.draft.userText, '已选文案的正文');
  assert.equal(session.tip, switchedTipLabel('image_text', '促销海报'));
  assertZeroBusinessWrites(session);
});

test('same-lens dirty → 套用并更新设置', () => {
  let lens: ComposerLensState = createComposerLensState({ userText: '手改过' });
  lens = selectLens(lens, 'image_text');
  lens = updateSettings(
    lens,
    {
      catalogModelId: 'model.user-picked',
      modelPolicyMode: 'fixed',
    },
    'user'
  );
  // Mark dirtySettings for modelPolicy the way preview expects.
  lens = {
    ...lens,
    draft: {
      ...lens.draft,
      dirtySettings: {
        ...lens.draft.dirtySettings,
        modelPolicy: {
          mode: 'fixed',
          catalogModelId: 'model.user-picked',
        },
      },
      quoteRevisionId: 'quote@confirmed',
    },
  };

  let session = createRecipeApplySession(lens);
  const poster = seedToRecipeTarget(posterSeed);
  // Same lens recipe already applied id different
  const result = requestApplyRecipe(session, {
    ...poster,
    revisionId: 'recipe.promotion_poster@9',
  });
  assert.equal(result.kind, 'confirming');
  session = result.session;
  assert.equal(session.preview?.conflictKind, 'same_lens_dirty');
  assert.equal(session.preview?.primaryCtaLabel, '套用并更新设置');
  assertZeroBusinessWrites(session);
});

test('undo restores lens/recipe; keeps live user text', () => {
  const original = '撤销测试原文';
  let session = createRecipeApplySession(
    createComposerLensState({ userText: original })
  );
  const result = requestApplyRecipe(session, seedToRecipeTarget(introSeed));
  assert.equal(result.kind, 'applied');
  session = result.session;
  assert.equal(session.lensState.lensId, 'copy');

  // User continues typing after apply.
  session = {
    ...session,
    lensState: updateUserText(session.lensState, `${original}·继续编辑`),
  };

  session = undoApply(session);
  assert.equal(session.phase, 'idle');
  assert.equal(session.lensState.lensId, null);
  // Live text kept (preserve contract).
  assert.equal(session.lensState.draft.userText, `${original}·继续编辑`);
  assert.equal(session.lensState.draft.recipeRevisionId, null);
  assertZeroBusinessWrites(session);
});

test('browse / preview / cancel never writes business entities', () => {
  // Preview path without confirm.
  const lens = selectLens(createComposerLensState({ userText: 'x' }), 'copy');
  let session = createRecipeApplySession(lens);
  const result = requestApplyRecipe(session, seedToRecipeTarget(posterSeed));
  assert.equal(result.kind, 'confirming');
  assertZeroBusinessWrites(result.session);
  session = cancelApply(result.session);
  assertZeroBusinessWrites(session);
});

test('passthrough with existing text/sources still preserves both', () => {
  let session = createRecipeApplySession(
    createComposerLensState({
      userText: '已有文字',
      sources: [{ id: 'asset-1', kind: 'image' }],
    })
  );
  const result = requestApplyRecipe(session, seedToRecipeTarget(xhsSeed));
  assert.equal(result.kind, 'applied');
  session = result.session;
  assert.equal(session.lensState.draft.userText, '已有文字');
  assert.equal(session.lensState.draft.sources.length, 1);
  assert.ok(session.preview === null);
  // Preview preserve list was used during decision — user content intact.
  assertZeroBusinessWrites(session);
});
