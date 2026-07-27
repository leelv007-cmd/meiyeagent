import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const route = readFileSync(
  fileURLToPath(
    new URL('../../routes/dashboard/results_/$workId.tsx', import.meta.url)
  ),
  'utf8'
);

test('result route resolves exact lineage on the server before rendering canonical projections', () => {
  assert.match(route, /['"]result-delivery['"]/);
  assert.match(route, /['"]result_target_resolve['"]/);
  assert.match(route, /operationsQuery<CreativeWorkbenchProjection>/);
  assert.match(route, /['"]creative_workbench['"]/);
  assert.match(route, /useCreativeJobObserver/);
  assert.match(
    route,
    /creativeJobObservation\(selected\?\.job \?\? undefined\)/
  );
  assert.match(route, /['"]video_workflow_public['"]/);
  assert.match(route, /payload: \{ workflowId: selectedVideoWorkflowId \}/);
  assert.match(
    route,
    /refetchInterval:[\s\S]*status === ['"]awaiting_quality_review['"]/
  );
  assert.match(route, /projectResultCenterLiveProjection/);
  assert.doesNotMatch(route, /resolveRouteResultTarget/);
  assert.doesNotMatch(route, /未找到视频工作流/);
});

test('result route quotes and confirms adjustment before canonical submit', () => {
  assert.match(route, /['"]result_adjust_prepare['"]/);
  assert.match(route, /['"]result_adjust['"]/);
  assert.match(route, /['"]product-billing['"]/);
  assert.match(route, /['"]quote['"]/);
  assert.match(route, /ImageAdjustConfirmation/);
  assert.match(route, /billingQuoteId/);
  assert.match(
    route,
    /setPendingImageAdjust\(null\);[\s\S]*window\.location\.assign\(resultCenterPath\(result\.work\.id\)\)/u
  );
  assert.doesNotMatch(route, /unitRate\s*:/);
});

test('result route consumes a trusted typed return anchor instead of browser history', () => {
  assert.match(route, /parseResultReturnState\(search\)/u);
  assert.match(route, /resultReturnDestination\(/u);
  // T34 / #228 — the retired task inbox is no longer a return destination.
  assert.doesNotMatch(route, /to: '\/dashboard\/tasks'/u);
  assert.doesNotMatch(route, /window\.history\.back\(\)/u);
});

test('result route sends adopt and export through canonical public commands', () => {
  assert.match(route, /['"]result_adopt['"]/);
  assert.match(route, /['"]result_export['"]/);
  assert.match(route, /['"]content_packages['"]/);
  assert.match(route, /latestContentPackageForWork\(/);
  assert.doesNotMatch(
    route,
    /contentPackagesQuery\.data\?\.find\([\s\S]*source\.workflowId/
  );
  assert.match(route, /download=1/);
  assert.match(route, /onAction=/);
  assert.match(route, /derive_creative_work/);
  assert.match(route, /resume_creative_job/);
  assert.doesNotMatch(route, /accept_creative_asset/);
});

test('copy adoption generates formal platform variants from both result entry points', () => {
  assert.match(
    route,
    /const adoptCopyCandidate = async \(\) => \{[\s\S]*?await generateCopyPlatformVariants\(adopted\)/
  );
  assert.match(
    route,
    /if \(workspaceKind === ['"]copy['"]\) \{[\s\S]*?await adoptCopyCandidate\(\)/
  );
  assert.match(route, /onCopyAdopt=\{[\s\S]*?adoptCopyCandidate/);
});

test('result route does not ship hard-coded empty works or copy workspace', () => {
  assert.doesNotMatch(route, /const works[^=]*=\s*\[\s*\]/);
  assert.doesNotMatch(
    route,
    /const workspaceKind:\s*ResultWorkspaceKind\s*=\s*['"]copy['"]/
  );
  assert.doesNotMatch(route, /provisional shell/);
});

test('result route consumes Harness workflow tokens as the only live incremental copy source', () => {
  assert.match(route, /useWorkflowEventStream/);
  assert.match(route, /harnessStream\.copyCandidates/);
  assert.match(route, /partialCandidates=/);
  assert.match(route, /streamLoading=/);
  assert.match(
    route,
    /progressState === ['"]running['"][\s\S]*progressState === ['"]waiting['"]|progressState === ['"]waiting['"][\s\S]*progressState === ['"]running['"]/
  );
  assert.doesNotMatch(route, /useCopyCandidateStream/);
  assert.doesNotMatch(route, /submitCopyCandidateStream/);
  assert.doesNotMatch(route, /buildCopyStreamRequestFromJob/);
  assert.doesNotMatch(route, /structuredStreamCandidates/);
});

test('wechat moments full-package action downloads canonical caption segments', () => {
  assert.match(route, /deliveryTarget === ['"]wechat_moments['"]/);
  assert.match(route, /buildCaptionText/);
  assert.match(route, /text\/plain;charset=utf-8/);
  assert.match(route, /URL\.createObjectURL/);
  assert.match(route, /URL\.revokeObjectURL/);
});

test('result route forwards the live viewport to the Result shell', () => {
  assert.match(route, /viewport=\{deliveryViewport\}/u);
});

test('result route wires the Result close-loop panels to public P1 operations', () => {
  assert.match(route, /projectResultCloseLoopFacts/);
  assert.match(route, /closeLoop=\{closeLoopFacts\}/);
  assert.match(route, /record_content_package_manual_result/);
  assert.match(route, /record_content_package_result_signal/);
  assert.match(route, /record_content_package_result_review_action/);
  assert.match(
    route,
    /onConfirmWeeklyRecommendation=\{async[\s\S]*?derive_creative_work/u
  );
});
