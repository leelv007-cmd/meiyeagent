import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HARNESS_BUILTIN_PROMPTS } from './langfuse-prompts.js';
import {
  STYLE_ANALYSIS_DIMENSIONS,
  STYLE_ANALYSIS_STAGE_MESSAGE,
  applyStyleAnalysisToImageSetPlan,
  consumeStyleAnalysisForImagePipeline,
  formatStyleAnalysisBlock,
  injectStyleAnalysisBlock,
  materializeStyleAnalysisSystemPrompt,
  parseStyleAnalysisOutput,
  shouldRunStyleAnalysis,
  styleAnalysisToConsistencyRequirements,
} from './xhs-style-analysis.js';

const FIXTURE_SEVEN_DIM = `画风：柔光实拍叠字
配色：裸粉+米白+香槟金点缀
背景：大理石台面浅景深
文字风格：粗体无衬线大标题
装饰元素：步骤箭头与产品剪影
排版结构：居中封面上下分栏
整体调性：干净专业的轻医美科普风`;

test('style analysis dimensions are exactly seven', () => {
  assert.equal(STYLE_ANALYSIS_DIMENSIONS.length, 7);
  assert.deepEqual([...STYLE_ANALYSIS_DIMENSIONS], [
    '画风',
    '配色',
    '背景',
    '文字风格',
    '装饰元素',
    '排版结构',
    '整体调性',
  ]);
});

test('parseStyleAnalysisOutput accepts the seven-line colon protocol', () => {
  const parsed = parseStyleAnalysisOutput(FIXTURE_SEVEN_DIM);
  assert.ok(parsed);
  assert.equal(parsed.dimensions['画风'], '柔光实拍叠字');
  assert.equal(parsed.dimensions['整体调性'], '干净专业的轻医美科普风');
  assert.equal(Object.keys(parsed.dimensions).length, 7);
});

test('parseStyleAnalysisOutput accepts full-width colon and fails closed on missing dim', () => {
  const fullWidth = FIXTURE_SEVEN_DIM.replaceAll('：', ':');
  assert.ok(parseStyleAnalysisOutput(fullWidth));
  const missing = FIXTURE_SEVEN_DIM.replace(/^整体调性：.+$/mu, '');
  assert.equal(parseStyleAnalysisOutput(missing), null);
  assert.equal(parseStyleAnalysisOutput(''), null);
});

test('shouldRunStyleAnalysis triggers on style_ref or style asset ids', () => {
  assert.equal(shouldRunStyleAnalysis({ referenceSlots: ['store_scene'] }), false);
  assert.equal(
    shouldRunStyleAnalysis({ referenceSlots: ['style_ref', 'product'] }),
    true,
  );
  assert.equal(
    shouldRunStyleAnalysis({ styleReferenceAssetIds: ['asset-1'] }),
    true,
  );
  assert.equal(shouldRunStyleAnalysis({ styleReferenceAssetIds: ['  '] }), false);
});

test('style analysis is consumed by the image-set consistency chain', () => {
  const analysis = parseStyleAnalysisOutput(FIXTURE_SEVEN_DIM);
  assert.ok(analysis);

  const requirements = styleAnalysisToConsistencyRequirements(analysis);
  assert.equal(requirements.length, 7);
  assert.ok(requirements.every((line) => line.includes('保持一致：')));
  assert.match(requirements[0]!, /画风保持一致/);

  const plan = applyStyleAnalysisToImageSetPlan({
    analysis,
    existingRequirements: ['品牌色保持一致'],
  });
  assert.equal(plan.consistencyRequirements.length, 8);
  assert.equal(plan.consistencyRequirements.at(-1), '品牌色保持一致');
  // De-dupe exact strings.
  const again = applyStyleAnalysisToImageSetPlan({
    analysis,
    existingRequirements: requirements.slice(0, 1),
  });
  assert.equal(again.consistencyRequirements.length, 7);
});

test('styleAnalysisBlock injects into xhsOutline and is non-empty for consumers', () => {
  const analysis = parseStyleAnalysisOutput(FIXTURE_SEVEN_DIM);
  assert.ok(analysis);

  const block = formatStyleAnalysisBlock(analysis);
  assert.match(block, /【风格参考（七维）】/);
  for (const key of STYLE_ANALYSIS_DIMENSIONS) {
    assert.match(block, new RegExp(key, 'u'));
  }

  assert.match(HARNESS_BUILTIN_PROMPTS.xhsOutline, /\{styleAnalysisBlock\}/);
  const outline = injectStyleAnalysisBlock(
    HARNESS_BUILTIN_PROMPTS.xhsOutline,
    analysis,
  );
  assert.equal(outline.includes('{styleAnalysisBlock}'), false);
  assert.match(outline, /柔光实拍叠字/);

  const empty = injectStyleAnalysisBlock(
    'before{styleAnalysisBlock}after',
    null,
  );
  assert.equal(empty, 'beforeafter');
});

test('consumeStyleAnalysisForImagePipeline is the single consumer seam', () => {
  const analysis = parseStyleAnalysisOutput(FIXTURE_SEVEN_DIM);
  assert.ok(analysis);
  const consumed = consumeStyleAnalysisForImagePipeline(
    analysis,
    HARNESS_BUILTIN_PROMPTS.xhsOutline,
  );
  assert.equal(consumed.consistencyRequirements.length, 7);
  assert.match(consumed.outlinePrompt, /干净专业的轻医美科普风/);
  assert.equal(consumed.stageMessage, STYLE_ANALYSIS_STAGE_MESSAGE);
  assert.match(consumed.stageMessage, /七维/);
});

test('style analysis fails closed when the frozen prompt pin is missing', () => {
  // Substituting HARNESS_BUILTIN_PROMPTS here used to be silent for both keys.
  assert.throws(
    () => materializeStyleAnalysisSystemPrompt(undefined),
    /requires the frozen prompt pin xhsStyleAnalysis/u,
  );
  const analysis = parseStyleAnalysisOutput(FIXTURE_SEVEN_DIM);
  assert.ok(analysis);
  assert.throws(
    () => consumeStyleAnalysisForImagePipeline(analysis, undefined),
    /requires the frozen prompt pin xhsOutline/u,
  );
});

test('builtin style analysis prompt documents all seven dimensions', () => {
  for (const key of STYLE_ANALYSIS_DIMENSIONS) {
    assert.match(
      HARNESS_BUILTIN_PROMPTS.xhsStyleAnalysis,
      new RegExp(key, 'u'),
      `xhsStyleAnalysis must document dimension ${key}`,
    );
  }
});
