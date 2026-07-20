/**
 * #103 Video regeneration confirm + settle (WT-E / D-088).
 *
 * Acceptance:
 * - shot + full_compose reuse quote→confirm→settle; only scope differs
 * - free actions never open/mutate product usage
 * - retry re-quotes; recover same supplier task does not
 * - shot complete → candidates only; 使用此成片 → ContentPackage revision
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyBillableSecondsRules } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import { ProductQuoteService } from '../product-billing/quote-service.js';
import {
  actionLabelForScope,
  billingModeLabelForQuote,
  projectVideoRegenConfirmView,
  projectVideoRegenSettleView,
  videoFreeActions,
  VideoRegenerationService,
  type BuildVideoRegenQuoteInput,
} from './video-regeneration.js';

const fixedNow = new Date('2026-07-20T15:00:00.000Z');

function service() {
  return new VideoRegenerationService({
    quoteService: new ProductQuoteService({ clock: () => fixedNow }),
    clock: () => fixedNow,
  });
}

function shotQuoteInput(
  overrides: Partial<BuildVideoRegenQuoteInput> = {},
): BuildVideoRegenQuoteInput {
  return {
    scope: 'shot',
    sourceRunId: 'run-parent-1',
    workspaceId: 'ws-1',
    actorId: 'actor-1',
    catalogModelId: 'seedance-2',
    catalogModelRevision: 'catalog-r1',
    quotePolicyRevision: 'qp-video-r1',
    billingMode: 'per_output_second',
    unitRate: 0.5,
    currency: 'CNY',
    targetSeconds: 6,
    minChargeSeconds: 4,
    roundingStepSeconds: 1,
    routeSnapshotRef: 'route-video-1',
    frozenCandidateDeploymentIds: ['dep-video-a', 'dep-video-b'],
    shotId: 'shot-opening',
    durationEstimate: {
      status: 'observed',
      p50Seconds: 30,
      p90Seconds: 60,
      sampleSize: 12,
      windowDays: 30,
      asOf: fixedNow.toISOString(),
    },
    ...overrides,
  };
}

function fullComposeQuoteInput(
  overrides: Partial<BuildVideoRegenQuoteInput> = {},
): BuildVideoRegenQuoteInput {
  return shotQuoteInput({
    scope: 'full_compose',
    targetSeconds: 24,
    shotId: undefined,
    ...overrides,
  });
}

describe('Video regeneration confirm projectors', () => {
  it('labels scopes and per-second billing explicitly', () => {
    assert.equal(actionLabelForScope('shot'), '重新生成此镜头');
    assert.equal(actionLabelForScope('full_compose'), '重新合成整段');

    const quotes = new ProductQuoteService({ clock: () => fixedNow });
    const quoted = quotes.buildQuote({
      quoteId: 'q-label',
      catalogModelId: 'seedance-2',
      quotePolicyRevision: 'qp-1',
      billingMode: 'per_output_second',
      unitRate: 1,
      targetSeconds: 10,
      minChargeSeconds: 4,
      workspaceId: 'ws-1',
    });
    assert.equal(billingModeLabelForQuote(quoted), '按生成成片 10 秒计费');

    const perReq = quotes.buildQuote({
      quoteId: 'q-label-req',
      catalogModelId: 'seedance-2',
      quotePolicyRevision: 'qp-1',
      billingMode: 'per_request',
      unitRate: 2,
      workspaceId: 'ws-1',
    });
    assert.equal(billingModeLabelForQuote(perReq), '本次按请求计费');
  });

  it('confirm view exposes scope/model/duration/billing/credits/ETA without provider fields', () => {
    const regen = service();
    const { confirm, quote } = regen.quoteForRegeneration(shotQuoteInput());

    assert.equal(confirm.actionLabel, '重新生成此镜头');
    assert.equal(confirm.scope, 'shot');
    assert.equal(confirm.catalogModelId, 'seedance-2');
    assert.equal(confirm.targetSeconds, 6);
    assert.equal(confirm.billingMode, 'per_output_second');
    assert.equal(confirm.billingModeLabel, '按生成成片 6 秒计费');
    assert.equal(confirm.quotedSeconds, 6);
    assert.equal(confirm.estimatedCredits, 3);
    assert.equal(confirm.createsNewTaskAndIndependentQuote, true);
    assert.match(confirm.createsNewTaskNotice, /新的生成任务并单独计费/);
    assert.equal(confirm.eta.status, 'observed');
    assert.equal(
      confirm.eta.estimatedCompletionAt,
      new Date(fixedNow.getTime() + 30_000).toISOString(),
    );

    const serialized = JSON.stringify(confirm);
    assert.equal(serialized.includes('Provider'), false);
    assert.equal(serialized.includes('Credential'), false);
    assert.equal(serialized.includes('dep-video'), false);
    assert.equal(quote.lifecycleStatus, 'quoted');
  });
});

describe('quote→confirm→settle contract (both scopes)', () => {
  it('shot and full_compose share the same product-billing lifecycle; only scope differs', () => {
    const regen = service();

    const shot = regen.quoteForRegeneration(
      shotQuoteInput({ quoteId: 'quote-shot-1' }),
    );
    const full = regen.quoteForRegeneration(
      fullComposeQuoteInput({ quoteId: 'quote-full-1' }),
    );

    assert.equal(shot.confirm.scope, 'shot');
    assert.equal(full.confirm.scope, 'full_compose');
    assert.equal(shot.confirm.actionLabel, '重新生成此镜头');
    assert.equal(full.confirm.actionLabel, '重新合成整段');
    // Same billing mode + formula path; different target/quoted seconds.
    assert.equal(shot.quote.billingMode, full.quote.billingMode);
    assert.equal(shot.quote.formula.unitRate, full.quote.formula.unitRate);
    assert.equal(shot.confirm.targetSeconds, 6);
    assert.equal(full.confirm.targetSeconds, 24);
    assert.equal(shot.confirm.billingModeLabel, '按生成成片 6 秒计费');
    assert.equal(full.confirm.billingModeLabel, '按生成成片 24 秒计费');

    const shotConfirmed = regen.confirmRegeneration({
      quoteId: 'quote-shot-1',
      taskId: 'task-shot-1',
      deploymentId: 'dep-video-a',
    });
    const fullConfirmed = regen.confirmRegeneration({
      quoteId: 'quote-full-1',
      taskId: 'task-full-1',
      deploymentId: 'dep-video-a',
    });

    assert.equal(shotConfirmed.quote.lifecycleStatus, 'dispatched');
    assert.equal(fullConfirmed.quote.lifecycleStatus, 'dispatched');
    assert.equal(shotConfirmed.usage.resource, 'video');
    assert.equal(fullConfirmed.usage.resource, 'video');
    // Independent quotes / tasks
    assert.notEqual(shotConfirmed.task.taskId, fullConfirmed.task.taskId);
    assert.notEqual(shotConfirmed.quote.quoteId, fullConfirmed.quote.quoteId);
    assert.equal(shotConfirmed.task.scope, 'shot');
    assert.equal(fullConfirmed.task.scope, 'full_compose');
    assert.equal(shotConfirmed.task.sourceRunId, 'run-parent-1');

    const shotSettled = regen.settleRegeneration({
      quoteId: 'quote-shot-1',
      trustedUsage: { kind: 'media_duration', actualSeconds: 6 },
      attemptId: 'attempt-task-shot-1',
    });
    const fullSettled = regen.settleRegeneration({
      quoteId: 'quote-full-1',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 24 },
      attemptId: 'attempt-task-full-1',
    });

    assert.equal(shotSettled.settle.settlementStatus, 'reconciled');
    assert.equal(fullSettled.settle.settlementStatus, 'reconciled');
    assert.equal(shotSettled.settle.scope, 'shot');
    assert.equal(fullSettled.settle.scope, 'full_compose');
    assert.equal(shotSettled.usage.settledQuantity, 3);
    assert.equal(fullSettled.usage.settledQuantity, 12);
  });

  it('each regen creates a new derived task with a new independent quote', () => {
    const regen = service();
    const first = regen.quoteForRegeneration(
      shotQuoteInput({ quoteId: 'quote-a', shotId: 's1' }),
    );
    const second = regen.quoteForRegeneration(
      shotQuoteInput({
        quoteId: 'quote-b',
        shotId: 's1',
        // different target forces independent facts
        targetSeconds: 8,
      }),
    );

    const c1 = regen.confirmRegeneration({
      quoteId: first.quote.quoteId,
      taskId: 'task-a',
      deploymentId: 'dep-video-a',
    });
    const c2 = regen.confirmRegeneration({
      quoteId: second.quote.quoteId,
      taskId: 'task-b',
      deploymentId: 'dep-video-a',
    });

    assert.notEqual(c1.task.taskId, c2.task.taskId);
    assert.notEqual(c1.quote.quoteId, c2.quote.quoteId);
    assert.notEqual(c1.usage.id, c2.usage.id);
    assert.equal(regen.quoteService.getUsage('task-a')?.quoteId, 'quote-a');
    assert.equal(regen.quoteService.getUsage('task-b')?.quoteId, 'quote-b');
  });

  it('auto-refunds when actual seconds are below confirmed ceiling', () => {
    const regen = service();
    regen.quoteForRegeneration(
      shotQuoteInput({
        quoteId: 'quote-low',
        targetSeconds: 10,
        minChargeSeconds: 4,
      }),
    );
    regen.confirmRegeneration({
      quoteId: 'quote-low',
      taskId: 'task-low',
      deploymentId: 'dep-video-a',
    });

    const { settle, quote } = regen.settleRegeneration({
      quoteId: 'quote-low',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 4 },
    });

    assert.equal(quote.billedSeconds, 4);
    assert.equal(settle.settledAmount, 2);
    assert.equal(settle.refundedAmount, 3);
    assert.equal(settle.autoRefundApplied, true);
    assert.match(settle.honestyNote, /自动退回/);
  });

  it('keeps estimated/unknown honest when trusted usage is missing', () => {
    const regen = service();
    regen.quoteForRegeneration(shotQuoteInput({ quoteId: 'quote-est' }));
    regen.confirmRegeneration({
      quoteId: 'quote-est',
      taskId: 'task-est',
      deploymentId: 'dep-video-a',
    });

    const estimated = regen.settleRegeneration({ quoteId: 'quote-est' });
    assert.equal(estimated.settle.settlementStatus, 'estimated');
    assert.equal(estimated.settle.billedSeconds, undefined);
    assert.match(estimated.settle.honestyNote, /estimated/);

    // Fresh task for unknown (untrusted kind path is handled inside settle
    // when trustedUsage is present but not trusted — use skip by omitting).
    const view = projectVideoRegenSettleView({
      quote: {
        ...estimated.quote,
        settlementStatus: 'unknown',
        billedSeconds: undefined,
      },
      scope: 'shot',
    });
    assert.equal(view.settlementStatus, 'unknown');
    assert.match(view.honestyNote, /unknown/);
  });

  it('per_request regen still uses the shared confirm contract', () => {
    const regen = service();
    const { confirm } = regen.quoteForRegeneration(
      shotQuoteInput({
        quoteId: 'quote-req',
        billingMode: 'per_request',
        unitRate: 1,
        targetSeconds: 6,
      }),
    );
    assert.equal(confirm.billingModeLabel, '本次按请求计费');
    assert.equal(confirm.estimatedCredits, 1);

    const confirmed = regen.confirmRegeneration({
      quoteId: 'quote-req',
      taskId: 'task-req',
      deploymentId: 'dep-video-a',
    });
    const settled = regen.settleRegeneration({
      quoteId: 'quote-req',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 0 },
    });
    assert.equal(confirmed.usage.reservedQuantity, 1);
    assert.equal(settled.settle.settledAmount, 1);
    assert.equal(settled.settle.settlementStatus, 'reconciled');
  });
});

describe('free actions never generate product fees', () => {
  it('covers every free action with a negative product-usage ledger assert', () => {
    const regen = service();

    // Billable baseline so we can prove free actions do not add more usage.
    regen.quoteForRegeneration(shotQuoteInput({ quoteId: 'quote-base' }));
    const baseline = regen.confirmRegeneration({
      quoteId: 'quote-base',
      taskId: 'task-base',
      deploymentId: 'dep-video-a',
    });
    const usageBefore = structuredClone(baseline.usage);
    const usageIdsBefore = regen.listProductUsageIds();

    for (const action of videoFreeActions) {
      const entry = regen.executeFreeAction({
        action,
        taskId: 'task-base',
        supplierTaskRef:
          action === 'recover' || action === 'download_supplier_task'
            ? 'supplier-task-xyz'
            : undefined,
      });
      assert.equal(entry.productUsageTouched, false);
      assert.equal(entry.action, action);

      const usageAfter = regen.productUsageFor('task-base');
      assert.deepEqual(usageAfter, usageBefore);
      assert.deepEqual(regen.listProductUsageIds(), usageIdsBefore);
    }

    assert.equal(regen.freeActionLog.length, videoFreeActions.length);

    // Free actions with no related task also leave the ledger empty of new rows.
    const orphan = service();
    for (const action of videoFreeActions) {
      orphan.executeFreeAction({
        action,
        supplierTaskRef:
          action === 'recover' ? 'supplier-orphan' : undefined,
      });
    }
    assert.equal(orphan.listProductUsageIds().length, 0);
    assert.equal(orphan.freeActionLog.length, videoFreeActions.length);
  });
});

describe('retry vs recover split', () => {
  it('retry requires a new quote and creates an independent derived task', () => {
    const regen = service();
    regen.quoteForRegeneration(shotQuoteInput({ quoteId: 'quote-old' }));
    const prior = regen.confirmRegeneration({
      quoteId: 'quote-old',
      taskId: 'task-old',
      deploymentId: 'dep-video-a',
    });

    // Reusing the same quote id for retry must fail.
    assert.throws(
      () =>
        regen.retryWithNewQuote({
          sourceTaskId: prior.task.taskId,
          quote: shotQuoteInput({ quoteId: 'quote-old' }),
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );

    const retried = regen.retryWithNewQuote({
      sourceTaskId: prior.task.taskId,
      quote: shotQuoteInput({
        quoteId: 'quote-retry',
        targetSeconds: 6,
      }),
    });
    assert.notEqual(retried.quote.quoteId, prior.quote.quoteId);
    assert.equal(retried.quote.lifecycleStatus, 'quoted');
    assert.equal(retried.confirm.createsNewTaskAndIndependentQuote, true);

    const confirmedRetry = regen.confirmRegeneration({
      quoteId: retried.quote.quoteId,
      taskId: 'task-retry',
      deploymentId: 'dep-video-a',
    });
    assert.notEqual(confirmedRetry.task.taskId, prior.task.taskId);
    assert.equal(confirmedRetry.task.intent, 'retry');
    // Two independent product usage rows
    assert.ok(regen.productUsageFor('task-old'));
    assert.ok(regen.productUsageFor('task-retry'));
    assert.notEqual(
      regen.productUsageFor('task-old')?.id,
      regen.productUsageFor('task-retry')?.id,
    );
  });

  it('recover continues the same supplier task without re-quote', () => {
    const regen = service();
    regen.quoteForRegeneration(shotQuoteInput({ quoteId: 'quote-rec' }));
    const confirmed = regen.confirmRegeneration({
      quoteId: 'quote-rec',
      taskId: 'task-rec',
      deploymentId: 'dep-video-a',
    });
    const usageBefore = structuredClone(
      regen.productUsageFor('task-rec')!,
    );
    const quoteBefore = structuredClone(
      regen.quoteService.getQuoteByTask('task-rec')!,
    );

    const recovered = regen.recoverSupplierTask({
      taskId: confirmed.task.taskId,
      supplierTaskRef: 'supplier-task-abc',
    });

    assert.equal(recovered.freeAction.action, 'recover');
    assert.equal(recovered.freeAction.productUsageTouched, false);
    assert.equal(recovered.quote?.quoteId, quoteBefore.quoteId);
    assert.deepEqual(recovered.usage, usageBefore);
    // Still a single usage row for the task
    assert.equal(regen.listProductUsageIds().length, 1);
    assert.equal(
      regen.getTask('task-rec')?.supplierTaskRef,
      'supplier-task-abc',
    );
    assert.equal(regen.getTask('task-rec')?.intent, 'recover');

    // Second recover is idempotent — no new quote
    const again = regen.recoverSupplierTask({
      taskId: 'task-rec',
      supplierTaskRef: 'supplier-task-abc',
    });
    assert.equal(again.quote?.quoteId, quoteBefore.quoteId);
    assert.deepEqual(regen.productUsageFor('task-rec'), usageBefore);
  });
});

describe('shot candidates vs 使用此成片 ContentPackage revision', () => {
  it('single-shot complete only produces shot candidates (no ContentPackage revision)', () => {
    const regen = service();
    regen.quoteForRegeneration(shotQuoteInput({ quoteId: 'quote-cand' }));
    regen.confirmRegeneration({
      quoteId: 'quote-cand',
      taskId: 'task-cand',
      deploymentId: 'dep-video-a',
    });
    regen.settleRegeneration({
      quoteId: 'quote-cand',
      trustedUsage: { kind: 'media_duration', actualSeconds: 6 },
    });

    const task = regen.completeShotCandidate({
      taskId: 'task-cand',
      shotId: 'shot-opening',
      candidateIndex: 0,
      assetId: 'asset-clip-1',
    });

    assert.equal(task.status, 'shot_candidates_ready');
    assert.equal(task.shotCandidates.length, 1);
    assert.equal(task.shotCandidates[0]?.assetId, 'asset-clip-1');
    assert.equal(task.composedCandidateAssetId, undefined);
    // No package was written
    assert.equal(regen.getContentPackage('pkg-any'), undefined);

    // Adopting film from a shot-scope task is rejected
    assert.throws(
      () =>
        regen.adoptComposedFilm({
          taskId: 'task-cand',
          composedAssetId: 'asset-clip-1',
          contentPackageId: 'pkg-1',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
  });

  it('使用此成片 writes a ContentPackage revision from full_compose', () => {
    const regen = service();
    regen.quoteForRegeneration(
      fullComposeQuoteInput({ quoteId: 'quote-film' }),
    );
    regen.confirmRegeneration({
      quoteId: 'quote-film',
      taskId: 'task-film',
      deploymentId: 'dep-video-a',
    });
    regen.settleRegeneration({
      quoteId: 'quote-film',
      trustedUsage: { kind: 'media_duration', actualSeconds: 24 },
    });
    regen.completeComposedCandidate({
      taskId: 'task-film',
      composedAssetId: 'asset-composed-1',
    });

    assert.equal(regen.getContentPackage('pkg-video-1'), undefined);

    const adopted = regen.adoptComposedFilm({
      taskId: 'task-film',
      composedAssetId: 'asset-composed-1',
      contentPackageId: 'pkg-video-1',
      workId: 'work-1',
      expectedRevision: 0,
    });

    assert.equal(adopted.task.status, 'adopted');
    assert.equal(adopted.contentPackage.revision, 1);
    assert.equal(adopted.contentPackage.composedAssetId, 'asset-composed-1');
    assert.equal(adopted.contentPackage.adoptedFromTaskId, 'task-film');
    assert.equal(regen.getContentPackage('pkg-video-1')?.revision, 1);

    // Second adopt advances revision (OCC)
    const second = regen.adoptComposedFilm({
      taskId: 'task-film',
      composedAssetId: 'asset-composed-2',
      contentPackageId: 'pkg-video-1',
      expectedRevision: 1,
    });
    assert.equal(second.contentPackage.revision, 2);
    assert.equal(second.contentPackage.composedAssetId, 'asset-composed-2');

    assert.throws(
      () =>
        regen.adoptComposedFilm({
          taskId: 'task-film',
          composedAssetId: 'asset-composed-3',
          contentPackageId: 'pkg-video-1',
          expectedRevision: 1,
        }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });
});

describe('min-charge / rounding surface on confirm', () => {
  it('quotedSeconds follows product-billing billable rules for per-second', () => {
    const regen = service();
    const { confirm, quote } = regen.quoteForRegeneration(
      shotQuoteInput({
        quoteId: 'quote-round',
        targetSeconds: 5,
        minChargeSeconds: 8,
        roundingStepSeconds: 5,
      }),
    );
    const expected = applyBillableSecondsRules({
      rawSeconds: 5,
      minChargeSeconds: 8,
      roundingStepSeconds: 5,
    });
    assert.equal(quote.quotedSeconds, expected);
    assert.equal(confirm.quotedSeconds, expected);
    assert.equal(confirm.billingModeLabel, `按生成成片 ${expected} 秒计费`);
  });
});

describe('confirm projector eta honesty', () => {
  it('shows null completion when duration samples are insufficient', () => {
    const quotes = new ProductQuoteService({ clock: () => fixedNow });
    const quote = quotes.buildQuote({
      quoteId: 'q-eta',
      catalogModelId: 'm',
      quotePolicyRevision: 'qp',
      billingMode: 'per_request',
      unitRate: 1,
      workspaceId: 'ws',
      targetSeconds: 6,
    });
    const confirm = projectVideoRegenConfirmView({
      quote,
      scope: 'shot',
      durationEstimate: {
        status: 'insufficient_data',
        sampleSize: 2,
        minimumSampleSize: 5,
        windowDays: 30,
        asOf: fixedNow.toISOString(),
      },
      now: fixedNow,
    });
    assert.equal(confirm.eta.status, 'insufficient_data');
    assert.equal(confirm.eta.estimatedCompletionAt, null);
    assert.match(confirm.eta.honestyNote, /暂无足够观测样本/);
  });
});
