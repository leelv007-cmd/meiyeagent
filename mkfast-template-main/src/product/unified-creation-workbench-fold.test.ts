import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'unified-creation-workbench.tsx'
  ),
  'utf8'
);

test('T1 auto-confirms Brief without a default-path confirm button dependency', () => {
  assert.match(source, /missingBriefAdoptFields/);
  assert.match(source, /briefAutoConfirmWorkIdRef/);
  assert.match(source, /autoConfirming=\{briefAutoConfirming\}/);
});

test('T2 accepts quote synchronously before submit and recovers QUOTE_CHANGED', () => {
  assert.match(source, /quoteAcceptedAtRef/);
  assert.match(source, /acceptQuoteNow/);
  assert.match(source, /CREATIVE_QUOTE_CHANGED/);
  assert.match(source, /recoverQuoteChangedAndResubmit/);
  assert.match(source, /enabled: Boolean\(currentWork\)/);
  assert.doesNotMatch(
    source,
    /enabled: Boolean\(currentWork\) && professionalOpen/
  );
});

test('T2 keeps video high-cost quote on an explicit confirm path', () => {
  assert.match(source, /operation === 'video\.generate'/);
  assert.match(source, /data-testid="video-quote-confirm"/);
  assert.match(source, /workbench_video_quote_confirm/);
  // Auto-accept effect must clear video acceptance, not set it.
  assert.match(
    source,
    /if \(operation === 'video\.generate'\) \{\s*setQuoteAccepted\(false\)/s
  );
});

test('T2 shows a passive quota line near the CTA', () => {
  assert.match(source, /data-testid="workbench-quota-line"/);
  assert.match(source, /workbench_quota_line/);
  assert.match(source, /data-testid="creative-quota-blocker"/);
  assert.match(source, /streamErrorCode\(error\)/);
  assert.match(source, /errorCode === 'INSUFFICIENT_ENTITLEMENT'/);
});

test('T3 keeps AIGC switch and documents burn follows switch value', () => {
  assert.match(source, /data-testid="workbench-aigc-switch"/);
  assert.match(source, /data-testid="workbench-aigc-burn-hint"/);
  assert.match(source, /workbench_aigc_follows_switch/);
  assert.match(source, /setAigcLabelEnabled/);
});

test('T3 removes the dead organization-tag select from the execution path', () => {
  assert.doesNotMatch(source, /workbench_organization_label\(/);
  assert.doesNotMatch(source, /workbench_tag_project\(/);
  assert.doesNotMatch(source, /workbench_tag_review\(/);
  assert.doesNotMatch(source, /workbench_tag_local\(/);
});

test('T4 renders harness primary + expandable alternatives, not only [0]', () => {
  assert.match(source, /harnessPrimaryCandidate/);
  assert.match(source, /harnessAlternativeCandidates/);
  assert.match(source, /data-testid="harness-primary-candidate"/);
  assert.match(source, /data-testid="harness-alternative-candidate"/);
  assert.doesNotMatch(source, /copyCandidates\[0\]/);
});

test('D-046 result stage keeps a persistent free-text revise entry', () => {
  assert.match(source, /data-testid="workbench-revise-direction"/);
  assert.match(source, /data-testid="workbench-revise-submit"/);
  assert.match(source, /workbench_revise_intent\(/);
  // Revise derives with lineage + confirmed brief, then auto-launches harness.
  assert.match(
    source,
    /'derive_creative_work',\s*\{\s*\.\.\.autoConfirmedCreativeBrief\([\s\S]*?sourceWorkId: currentWork\.id/u
  );
  assert.match(source, /launchHarnessForWork\(derivedWork\)/);
});

test('V1 first-token endpoint exposes data-has-token on harness candidates', () => {
  assert.match(source, /candidateHasToken/);
  assert.match(source, /data-has-token=/);
});

test('T4 collapses workbench settings into a streaming details drawer', () => {
  assert.match(source, /data-testid="workbench-details-drawer"/);
  assert.match(source, /workbench_details_drawer/);
  assert.match(source, /showDetailsDrawer/);
});

test('T4 keeps /copy/stream as the direct-mode escape hatch', () => {
  assert.match(source, /currentWork\.mode === 'direct'/);
  assert.match(source, /submitCopyStream\(acceptedAt\)/);
});

test('T4 replaces an adopted candidate through current-revision OCC without publishing', () => {
  assert.match(source, /canAdoptHarnessCandidate/);
  assert.match(source, /action: 'adopt_harness_candidate'/);
  assert.match(source, /expectedRevision:\s*currentHarnessPackage\.revision/u);
  assert.doesNotMatch(
    source,
    /disabled=\{busy \|\| Boolean\(adoptedCandidateId\)\}/u
  );
});

test('result candidates do not create a Card inside the result surface', () => {
  assert.match(
    source,
    /function HarnessCandidateResultCard[\s\S]*?<section[^>]+data-testid="harness-persisted-candidate"/u
  );
  assert.doesNotMatch(
    source,
    /<Card data-testid="harness-persisted-candidate"/u
  );
});

test('initial projection recovery stays in a bounded preparing state', () => {
  assert.match(source, /retry: shouldRetryWorkbenchProjection/u);
  assert.match(source, /retryDelay: workbenchProjectionRetryDelay/u);
  assert.match(source, /data-testid="workbench-projection-preparing"/u);
  assert.match(
    source,
    /projectionQuery\.isError && projectionQuery\.data === undefined/u
  );
});

test('T2 keeps a lightweight allowance projection live for the Day-0 Harness CTA', () => {
  assert.match(
    source,
    /const usageQuery = useQuery\(\{[\s\S]*?staleTime: 30_000,[\s\S]*?\}\);/u
  );
  assert.doesNotMatch(
    source,
    /const usageQuery = useQuery\(\{[\s\S]*?enabled: Boolean\(currentWork\)[\s\S]*?\}\);/u
  );
  assert.match(
    source,
    /<CreationEntry[\s\S]*?quotaLine=\{[\s\S]*?workbench_quota_line/u
  );
});

test('Harness typed failures recover against the original Work and Task', () => {
  assert.match(source, /'harness-quota-blocker'/u);
  assert.match(source, /'harness-grounding-blocker'/u);
  assert.match(source, /'harness-authorization-blocker'/u);

  const retryStart = source.indexOf('const retryHarnessForCurrentWork');
  const createStart = source.indexOf('const createWork', retryStart);
  assert.ok(retryStart >= 0 && createStart > retryStart);
  const retrySource = source.slice(retryStart, createStart);
  assert.match(
    retrySource,
    /launchHarnessForWork\(currentWork, currentHarnessPackage\)/u
  );
  assert.doesNotMatch(retrySource, /create_creative_work/u);
});
