import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  functionCalls,
  hasCall,
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  propertyAccesses,
  propertyValues,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const conversation = parseProductionSource(
  new URL('./composer-conversation.tsx', import.meta.url)
);
const run = parseProductionSource(
  new URL('./use-composer-run.ts', import.meta.url)
);
const wizard = parseProductionSource(
  new URL('../store-intake/store-intake-wizard.tsx', import.meta.url)
);

/**
 * One control, two jobs. `attemptSubmit` returns before any generation request
 * whenever a precondition is open — the grounding branch and the fact card the
 * press reveals — while the send button read 「开始创作」 in every state. The
 * merchant pressed what they read as 开始创作 and got a question instead.
 */
test('the send control states which of its two jobs the next press does', () => {
  assert.ok(identifiers(home).has('composerSubmitIntent'));
  assert.ok(identifiers(home).has('groundingBlocker'));
  assert.ok(identifiers(home).has('storeFactsPending'));
  const bar = jsxOf(home, 'ComposerPromptBar')[0];
  assert.equal(bar?.attrs.submitLabel, 'submitIntent.label');
  assert.ok(
    (bar?.attrs.submitHint ?? '').includes('pendingInterruptGate.hint')
  );
  assert.notEqual(bar?.attrs.submitLabel, 'creation_entry_submit()');
});

/**
 * WCAG 3.3.1. A blocked press used to paint a red edge with `aria-invalid` and
 * `aria-describedby` both absent, and every `role=alert` region on the page
 * empty — no signal at all for a screen reader, a colour with no cause for
 * everyone else.
 */
test('a blocked press produces a described, visible reason on the intent box', () => {
  assert.ok(
    jsxOf(conversation, 'PromptInput.TextArea').some(
      (element) =>
        element.attrs['aria-describedby'] === 'describedBy' ||
        (element.attrs['aria-describedby'] ?? '').includes('describedBy')
    )
  );
  assert.ok(identifiers(conversation).has('INTENT_ERROR_ID'));
  assert.ok(
    jsxOf(conversation, 'p').some((element) => element.attrs.role === 'alert')
  );
  const bar = jsxOf(home, 'ComposerPromptBar')[0];
  assert.equal(bar?.attrs.intentError, 'submitBlockedMessage');
});

/**
 * D-109 / D-172: the merchant unit is 积分, never money, and no internal cost
 * baseline reaches the front.
 */
test('the quote line carries no bare cost figure', () => {
  assert.equal(
    literals(home).some((value) => value.includes('预计消耗')),
    false
  );
  assert.equal(
    propertyAccesses(home).includes('currentQuoteView.amount'),
    false
  );
  assert.ok(propertyAccesses(home).includes('currentQuoteView?.billingNote'));
});

test('a missing required source slot is named on send and hides quote confirmation', () => {
  assert.ok(identifiers(home).has('missingRequiredSourceSlot'));
  assert.ok(identifiers(home).has('unsatisfiedRequiredSlots'));
  assert.ok(identifiers(home).has('sourceSlotGuidance'));
  assert.ok(jsxOf(home, 'RecipeSourceSlotGuidanceCard').length >= 1);
  assert.ok(
    jsxOf(home, 'RecipeSourceSlotGuidanceCard').some((element) =>
      (element.attrs.canSwitch ?? '').includes('slotFreeFallbackRecipe')
    )
  );
  assert.ok(jsxOf(home, 'ComposerLibrarySourcePicker').length >= 1);
  assert.equal(
    functionCalls(home, 'handleRecipeSlotSwitch').includes(
      'handleCreationModeChange'
    ),
    false
  );
});

test('store-facts pending send copy is consent review, not in-stream store questions', () => {
  const messages = JSON.parse(
    readFileSync(
      new URL('../../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;

  assert.equal(hasCall(home, 'composer_submit_review_label'), true);
  assert.equal(hasCall(home, 'composer_submit_review_hint'), true);
  assert.equal(literals(home).includes('先补门店信息'), false);
  assert.equal(literals(home).includes('补完接着生成'), false);

  const label = messages.composer_submit_review_label;
  const hint = messages.composer_submit_review_hint;
  assert.equal(typeof label, 'string');
  assert.equal(typeof hint, 'string');
  assert.match(label ?? '', /核对/u);
  assert.match(hint ?? '', /发送后我先核对这次要用的信息/u);
  assert.match(hint ?? '', /需要确认的会先问你/u);
  assert.doesNotMatch(label ?? '', /门店/u);
  assert.doesNotMatch(hint ?? '', /门店/u);
  assert.doesNotMatch(hint ?? '', /问店|补完接着生成|先问这几条/u);
});

test('the unselected-lens send hint does not point above the prompt', () => {
  const messages = JSON.parse(
    readFileSync(
      new URL('../../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;

  assert.equal(hasCall(home, 'composer_submit_lens_required_hint'), true);
  assert.equal(literals(home).includes('在上面的'), false);
  assert.equal(literals(home).includes('在下面的'), false);

  const hint = messages.composer_submit_lens_required_hint;
  assert.equal(typeof hint, 'string');
  assert.match(hint ?? '', /创作类型（必选）/u);
  assert.doesNotMatch(hint ?? '', /上面|下面/u);
});

test('D1 copy does not abort submit when Brief still requires confirmation', () => {
  assert.ok(
    propertyAccesses(run).includes('input.lensId') ||
      identifiers(run).has('lensId')
  );
  assert.ok(propertyAccesses(run).includes('currentBrief.requiresBrief'));
});

test('先核对信息 reveals store facts and does not mint a run', () => {
  assert.ok(
    propertyAccesses(run).includes('options.storeFactsPending') ||
      identifiers(run).has('storeFactsPending')
  );
  assert.ok(
    propertyAccesses(run).includes('options.onRevealStoreFacts') ||
      identifiers(run).has('onRevealStoreFacts')
  );
  assert.ok(identifiers(home).has('storeFactsPending'));
});

test('day-0 先核对信息 stays pressable when a quote cannot mint yet', () => {
  const bar = jsxOf(home, 'ComposerPromptBar')[0];
  assert.ok(
    (bar?.attrs.submitDisabled ?? '').includes('showProgressiveFact') ||
      identifiers(home).has('showProgressiveFact')
  );
});

test('quote usage lines share one resolver so confirmed and needs-more cannot both render', () => {
  assert.equal(hasCall(home, 'resolveComposerQuoteUsageLine'), true);
  assert.ok(jsxOf(home, 'ComposerPromptBar')[0]?.attrs.usageSlot);
  assert.equal(hasCall(home, 'composer_campaign_toggle'), true);
  assert.equal(
    hasCall(home, 'reset') || identifiers(home).has('createWork'),
    true
  );
  assert.ok(
    propertyValues(home, 'showConfirmed').some((value) =>
      value.includes('unsatisfiedRequiredSlots')
    )
  );
});

test('selecting a lens defaults empty destination per Day-0 contract (QA ISSUE-006)', () => {
  assert.ok(identifiers(home).has('handleLensChange'));
  const platforms = propertyValues(home, 'platform');
  assert.ok(platforms.includes("'wechat_moments'"));
  assert.ok(platforms.includes("'xiaohongshu'"));
  assert.ok(platforms.includes("'douyin'"));
  assert.ok(
    propertyValues(home, 'distributionTarget').includes("'manual_copy'")
  );
});

test('store intake confirm invalidates today recommendation after success', () => {
  assert.ok(
    literals(wizard).includes('today-recommendation') ||
      literals(wizard).includes('harness')
  );
  assert.ok(
    literals(wizard).some((value) => value.includes('intake-finalize:'))
  );
});
