import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OutcomeObservationFact } from './outcome-observation-model';
import type { PublicationRecordFact } from './publication-record-model';
import {
  confirmWeeklyRecommendation,
  projectWeeklyReviewPanel,
  type WeeklyReviewFacts,
} from './weekly-review-model';

const publication: PublicationRecordFact = {
  id: 'pub-1',
  contentPackageId: 'pkg-a',
  contentPackageRevision: 2,
  platform: 'xiaohongshu',
  accountDisplayLabel: '本店小红书',
  publishedAt: '2026-07-20T08:00:00.000Z',
  actorId: 'actor-a',
  sourceTier: 'manual_record',
  createdAt: '2026-07-20T08:05:00.000Z',
  status: 'published',
};

const observation: OutcomeObservationFact = {
  id: 'obs-1',
  workspaceId: 'ws-a',
  contentPackageId: 'pkg-a',
  contentPackageRevision: 2,
  publicationRecordId: 'pub-1',
  kind: 'store_visit',
  occurredAt: '2026-07-21T10:00:00.000Z',
  recordedAt: '2026-07-21T10:05:00.000Z',
  actorId: 'actor-a',
  sourceTier: 'merchant_recorded',
  quantity: 1,
};

function facts(overrides: Partial<WeeklyReviewFacts> = {}): WeeklyReviewFacts {
  return {
    workspaceId: 'ws-a',
    weekStartedAt: '2026-07-20T00:00:00.000Z',
    weekEndedAt: '2026-07-26T23:59:59.999Z',
    packages: [
      {
        contentPackageId: 'pkg-a',
        title: '夏日活动海报',
        platform: 'xiaohongshu',
        ctaLabel: '私信领券',
        revision: 2,
      },
    ],
    publications: [publication],
    observations: [observation],
    ...overrides,
  };
}

describe('weekly-review-model', () => {
  it('fails closed on workspace mismatch', () => {
    const view = projectWeeklyReviewPanel({
      ...facts(),
      viewerWorkspaceId: 'ws-other',
    });
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'workspace_mismatch');
    assert.equal(view.hasAutoRoi, false);
  });

  it('fails closed for empty week', () => {
    const view = projectWeeklyReviewPanel(
      facts({
        publications: [],
        observations: [],
      })
    );
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'empty_week');
  });

  it('projects published / observed / unknowns without ROI or causal claims', () => {
    const view = projectWeeklyReviewPanel(facts());
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.published.length, 1);
    assert.equal(view.observed.length, 1);
    assert.equal(view.hasAutoRoi, false);
    assert.equal(view.hasCausalLanguage, false);
    assert.equal(view.published[0]?.ctaLabel, '私信领券');
    assert.ok(view.recommendations[0]?.actions.includes('change_platform'));
    assert.ok(view.recommendations[0]?.actions.includes('continue_series'));
    assert.ok(
      view.recommendations[0]?.evidenceRefs.some(
        (e) => e.kind === 'publication'
      )
    );
    assert.ok(
      view.recommendations[0]?.evidenceRefs.some(
        (e) => e.kind === 'observation'
      )
    );
  });

  it('uses exploratory mode when sample is thin', () => {
    const view = projectWeeklyReviewPanel(
      facts({
        observations: [],
      })
    );
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.recommendations[0]?.mode, 'exploratory');
    assert.match(view.recommendations[0]?.uncertainty ?? '', /样本/);
    assert.ok(view.unknowns.some((u) => /结果信号/.test(u)));
  });

  it('confirm creates snapshot intent only; stop is decision-only', () => {
    const cont = confirmWeeklyRecommendation({
      workspaceId: 'ws-a',
      packageId: 'pkg-a',
      sourceRevision: 2,
      action: 'change_cta',
      decidedAt: '2026-07-22T12:00:00.000Z',
    });
    assert.equal(cont.kind, 'snapshot_intent');
    if (cont.kind !== 'snapshot_intent') return;
    assert.equal(cont.intent.recompileOnSubmit, true);
    assert.equal(cont.intent.promotesLongTermPreference, false);
    assert.equal(cont.intent.kind, 'creation_execution_snapshot_intent');
    assert.equal(cont.decision.promotesLongTermPreference, false);

    const stop = confirmWeeklyRecommendation({
      workspaceId: 'ws-a',
      packageId: 'pkg-a',
      sourceRevision: 2,
      action: 'stop_series',
      decidedAt: '2026-07-22T12:00:00.000Z',
    });
    assert.equal(stop.kind, 'decision_only');
  });

  it('hides stopped series from recommendations', () => {
    const view = projectWeeklyReviewPanel(
      facts({
        lastDecisionByPackageId: { 'pkg-a': 'stop_series' },
      })
    );
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.recommendations.length, 0);
  });
});
