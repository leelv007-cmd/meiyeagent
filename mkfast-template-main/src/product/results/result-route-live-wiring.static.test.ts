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

function assertHarnessCopyTokenPairedSeam(source: string) {
  assert.match(
    source,
    /const partialCandidates\s*=\s*streamActive && harnessStreamMatchesResult\s*\?\s*harnessStream\.copyCandidates\s*:\s*undefined;/u
  );
  assert.match(source, /partialCandidates=\{partialCandidates\}/u);
}

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
  assert.match(route, /resultAdjustSourceForResult/u);
  assert.match(route, /const adjustSource = resultAdjustSourceForResult\(/u);
  assert.match(route, /source: pendingImageAdjust\.source/u);
  assert.match(route, /source: adjustSource/u);
  assert.match(route, /\{\.\.\.\(adjustSource\s*\?\s*\{\}/u);
  assert.match(route, /['"]result_adjust_prepare['"]/);
  assert.match(route, /['"]result_adjust['"]/);
  assert.match(route, /['"]product-billing['"]/);
  assert.match(route, /['"]quote['"]/);
  // D-164⑥ 决定 A（#264FE 合入后解锁）: 就地纠偏与首次生成同一张卡，
  // 不再有第二个确认组件。
  assert.match(route, /ExecutionConfirmCard/);
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

test('result route binds visible copy edits to the current delivery variant', () => {
  assert.match(route, /findResultContentPackageHandEditVersion/u);
  assert.match(
    route,
    /const currentResultEditVersion = contentPackage\s*\? findResultContentPackageHandEditVersion\(\s*contentPackage,\s*resultEditPlatform\s*\)/u
  );
  assert.match(
    route,
    /const copyWorksurface =[\s\S]*?currentResultEditVersion/u
  );
  assert.match(
    route,
    /const copyWorksurface =[\s\S]*?packageId: contentPackage\.id[\s\S]*?sourcePlatform: resultEditPlatform/u
  );
  assert.match(route, /onCopyHandEdit=\{[\s\S]*?platform: resultEditPlatform/u);
  assert.match(
    route,
    /onCopyQuickEdit=\{[\s\S]*?baseVersionId: currentResultEditVersion\.id[\s\S]*?platform: resultEditPlatform/u
  );
});

test('result route copies, shares, scans, and exports the exact visible version', () => {
  assert.match(
    route,
    /const deliveryCopy = contentPackage \? currentResultEditVersion : copyAsset;/u
  );
  const deliveryStart = route.indexOf('deliveryPanelFacts={{');
  const deliveryEnd = route.indexOf('\n    />', deliveryStart);
  assert.notEqual(deliveryStart, -1);
  assert.notEqual(deliveryEnd, -1);
  const deliveryOutbound = route.slice(deliveryStart, deliveryEnd);
  assert.match(deliveryOutbound, /hasCopyableText: Boolean\(deliveryCopy\)/u);
  assert.match(deliveryOutbound, /text: deliveryCopy\.body/u);
  assert.match(
    deliveryOutbound,
    /navigator\.clipboard\.writeText\([\s\S]*?deliveryCopy\.body/u
  );
  assert.doesNotMatch(deliveryOutbound, /copyAsset/u);
  assert.match(
    route,
    /approval\.binding\.variantVersionId === deliveryVariant\?\.currentVersionId/u
  );
  assert.match(
    route,
    /receipt\.variantVersionId === deliveryVariant\?\.currentVersionId/u
  );
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
  assert.match(
    route,
    /const resultWorkflowId = resultWorkflowIdForWork\(\s*contentPackagesQuery\.data,\s*workId\s*\);/u
  );
  assert.doesNotMatch(route, /resultWorkflowIdForWork\([^;]*search\.taskId/u);
  assert.match(route, /enabled: Boolean\(resultWorkflowId\)/u);
  assert.match(route, /workflowId: resultWorkflowId/u);
  assert.match(route, /taskId: resultWorkflowId \|\| undefined/u);
  assert.doesNotMatch(route, /taskId: search\.taskId/u);
  assert.match(route, /harnessStream\.copyCandidates/);
  assert.match(route, /harnessStream\.activeWorkflowId === resultWorkflowId/u);
  assert.match(
    route,
    /const harnessWorkflowState = harnessStreamMatchesResult\s*\?\s*harnessStream\.workflowState\s*:\s*undefined;/u
  );
  assert.match(
    route,
    /const harnessProgressState = harnessStreamMatchesResult\s*\?\s*harnessStream\.latestProgress\?\.state\s*:\s*undefined;/u
  );
  assert.match(route, /resultHarnessStreamLifecycle\(\{/u);
  assert.match(route, /hasCanonicalVersion: Boolean\(currentPackageVersion\)/u);
  assert.match(route, /harnessStreamLifecycle\.streamActive/u);
  assert.doesNotMatch(
    route,
    /workflowState\s*\?\?\s*harnessStream\.latestProgress\?\.state/u
  );
  assert.doesNotMatch(
    route,
    /harnessProgressState === ['"]running['"]\s*\|\|\s*harnessProgressState === ['"]waiting['"]/u
  );
  assertHarnessCopyTokenPairedSeam(route);
  assert.match(route, /streamLoading=/);
  assert.doesNotMatch(route, /useCopyCandidateStream/);
  assert.doesNotMatch(route, /submitCopyCandidateStream/);
  assert.doesNotMatch(route, /buildCopyStreamRequestFromJob/);
  assert.doesNotMatch(route, /structuredStreamCandidates/);
});

test('result route paired seam rejects dropping Harness candidates before the Result shell', () => {
  const mutated = route.replace(
    /const partialCandidates\s*=\s*streamActive && harnessStreamMatchesResult\s*\?\s*harnessStream\.copyCandidates\s*:\s*undefined;/u,
    'const partialCandidates = [];'
  );
  assert.notEqual(mutated, route);
  assert.throws(() => assertHarnessCopyTokenPairedSeam(mutated));
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

test('result route reads 血缘 through the shared predicate, with the Work', () => {
  // Reading `source.sourceContentPackage` directly is what made 「基于 X」
  // unreachable on the 再创作 path, and duplicating the predicate here is what
  // would let 结果中心 and 作品面 disagree again.
  assert.match(
    route,
    /workLineageSourcePackageId\(\{[\s\S]*?contentPackage,[\s\S]*?work: selected\.work/u
  );
  assert.doesNotMatch(route, /contentPackage\?\.source\.sourceContentPackage/u);
});

test('result route asks the delivery attempt about the platform it is showing', () => {
  assert.match(
    route,
    /resultDeliveryAttemptState\(contentPackage, \{[\s\S]*?platform: canonicalDeliveryPlatform/u
  );
});
