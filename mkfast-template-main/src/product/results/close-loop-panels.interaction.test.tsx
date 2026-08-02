/**
 * Interaction tests for close-loop UI shells (P1-D/E).
 * Fail-closed without data; chips stay disabled until published.
 */

import assert from 'node:assert/strict';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { OutcomeChipsPanel } from './outcome-chips-panel';
import { projectOutcomeObservationPanel } from './outcome-observation-model';
import { PublicationRecordPanel } from './publication-record-panel';
import { projectPublicationRecordPanel } from './publication-record-model';
import { WeeklyReviewPanel } from './weekly-review-panel';
import { projectWeeklyReviewPanel } from './weekly-review-model';

afterEach(() => {
  cleanup();
});

describe('close-loop panels', () => {
  it('publication panel fails closed without revision', () => {
    const view = projectPublicationRecordPanel({});
    render(<PublicationRecordPanel view={view} />);
    const node = screen.getByTestId('publication-record-fail-closed');
    assert.equal(node.getAttribute('data-reason'), 'missing_package_revision');
    assert.equal(screen.queryByTestId('publication-record-form'), null);
  });

  it('publication panel shows manual-only when live gate closed', () => {
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 1,
      variantVersionId: 'v1',
      automaticVerifiedPlatformCount: 0,
    });
    render(
      <PublicationRecordPanel
        view={view}
        contentPackageId="pkg-a"
        contentPackageRevision={1}
        variantVersionId="v1"
        platform="douyin"
        onRecordManual={() => undefined}
      />
    );
    assert.ok(screen.getByTestId('publication-record-manual-only'));
    assert.ok(screen.getByTestId('publication-record-form'));
  });

  it('binds a manual publication to the exact platform variant', async () => {
    const onRecordManual = vi.fn();
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 1,
      variantVersionId: 'douyin-v1',
      automaticVerifiedPlatformCount: 0,
    });
    render(
      <PublicationRecordPanel
        view={view}
        contentPackageId="pkg-a"
        contentPackageRevision={1}
        variantVersionId="douyin-v1"
        platform="douyin"
        onRecordManual={onRecordManual}
      />
    );

    assert.equal(
      screen.queryByTestId('publication-platform-xiaohongshu'),
      null
    );
    assert.ok(screen.getByTestId('publication-platform-douyin'));
    fireEvent.change(screen.getByTestId('publication-account'), {
      target: { value: '本店抖音' },
    });
    fireEvent.change(screen.getByTestId('publication-at'), {
      target: { value: '2026-07-23T09:30' },
    });
    fireEvent.submit(screen.getByTestId('publication-record-form'));

    await waitFor(() => assert.equal(onRecordManual.mock.calls.length, 1));
    assert.equal(onRecordManual.mock.calls[0]?.[0]?.platform, 'douyin');
    assert.match(
      onRecordManual.mock.calls[0]?.[0]?.idempotencyKey ?? '',
      /^pub\.douyin\.1\.[0-9a-z]+\.[0-9a-f-]{36}$/u
    );
    assert.equal(
      onRecordManual.mock.calls[0]?.[0]?.variantVersionId,
      'douyin-v1'
    );
  });

  it('requires an explicit valid variant selection for an unscoped distribution package', async () => {
    const onRecordManual = vi.fn();
    const variantBindings = [
      { platform: 'xiaohongshu' as const, variantVersionId: 'xhs-v1' },
      { platform: 'douyin' as const, variantVersionId: 'douyin-v1' },
    ];
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 1,
      variantBindings,
      automaticVerifiedPlatformCount: 0,
    });
    const { rerender } = render(
      <PublicationRecordPanel
        view={view}
        contentPackageId="pkg-a"
        contentPackageRevision={1}
        variantBindings={variantBindings}
        onRecordManual={onRecordManual}
      />
    );

    const submit = screen.getByTestId('publication-record-submit');
    assert.equal((submit as HTMLButtonElement).disabled, true);
    const xhs = screen.getByTestId('publication-platform-xiaohongshu');
    assert.equal(xhs.getAttribute('aria-pressed'), 'false');
    fireEvent.click(xhs);
    assert.equal(xhs.getAttribute('aria-pressed'), 'true');
    assert.equal((submit as HTMLButtonElement).disabled, false);
    fireEvent.change(screen.getByTestId('publication-account'), {
      target: { value: '本店小红书' },
    });
    fireEvent.change(screen.getByTestId('publication-at'), {
      target: { value: '2026-07-23T09:30' },
    });
    fireEvent.submit(screen.getByTestId('publication-record-form'));

    await waitFor(() => assert.equal(onRecordManual.mock.calls.length, 1));
    assert.equal(onRecordManual.mock.calls[0]?.[0]?.platform, 'xiaohongshu');
    assert.equal(onRecordManual.mock.calls[0]?.[0]?.variantVersionId, 'xhs-v1');

    const refreshedBindings = [
      { platform: 'xiaohongshu' as const, variantVersionId: 'xhs-v2' },
      { platform: 'douyin' as const, variantVersionId: 'douyin-v2' },
    ];
    const refreshedView = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      variantBindings: refreshedBindings,
      automaticVerifiedPlatformCount: 0,
    });
    rerender(
      <PublicationRecordPanel
        view={refreshedView}
        contentPackageId="pkg-a"
        contentPackageRevision={2}
        variantBindings={refreshedBindings}
        onRecordManual={onRecordManual}
      />
    );
    assert.equal(xhs.getAttribute('aria-pressed'), 'false');
    assert.equal((submit as HTMLButtonElement).disabled, true);
    fireEvent.submit(screen.getByTestId('publication-record-form'));
    assert.equal(onRecordManual.mock.calls.length, 1);

    fireEvent.click(screen.getByTestId('publication-platform-xiaohongshu'));
    fireEvent.submit(screen.getByTestId('publication-record-form'));
    await waitFor(() => assert.equal(onRecordManual.mock.calls.length, 2));
    assert.equal(onRecordManual.mock.calls[1]?.[0]?.variantVersionId, 'xhs-v2');

    rerender(
      <PublicationRecordPanel
        view={refreshedView}
        contentPackageId="pkg-b"
        contentPackageRevision={2}
        variantBindings={refreshedBindings}
        onRecordManual={onRecordManual}
      />
    );
    assert.equal(
      screen
        .getByTestId('publication-platform-xiaohongshu')
        .getAttribute('aria-pressed'),
      'false'
    );
    assert.equal(
      (screen.getByTestId('publication-record-submit') as HTMLButtonElement)
        .disabled,
      true
    );
  });

  it('outcome chips stay disabled until published', () => {
    const view = projectOutcomeObservationPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: false,
    });
    render(<OutcomeChipsPanel view={view} />);
    const chip = screen.getByTestId('outcome-chip-store_visit');
    assert.equal(chip.getAttribute('data-enabled'), 'false');
    assert.equal((chip as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByTestId('outcome-chips-fail-closed'));
  });

  it('outcome chips enable after publication and show ladder unknowns', () => {
    const view = projectOutcomeObservationPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: true,
      observations: [
        {
          id: 'o1',
          workspaceId: 'ws-a',
          contentPackageId: 'pkg-a',
          contentPackageRevision: 2,
          kind: 'inquiry',
          occurredAt: '2026-07-20T10:00:00.000Z',
          recordedAt: '2026-07-20T10:00:00.000Z',
          actorId: 'a',
          sourceTier: 'merchant_recorded',
        },
      ],
    });
    render(<OutcomeChipsPanel view={view} onRecord={() => undefined} />);
    const chip = screen.getByTestId('outcome-chip-appointment');
    assert.equal(chip.getAttribute('data-enabled'), 'true');
    const ladder = screen.getByTestId('outcome-result-ladder');
    assert.ok(ladder.textContent?.includes('未知'));
    assert.ok(screen.getByTestId('outcome-inferred-disclaimer'));
  });

  it('weekly review fails closed on empty week without ROI', () => {
    const view = projectWeeklyReviewPanel({
      workspaceId: 'ws-a',
      weekStartedAt: '2026-07-20T00:00:00.000Z',
      weekEndedAt: '2026-07-26T23:59:59.999Z',
      packages: [],
      publications: [],
      observations: [],
    });
    render(<WeeklyReviewPanel view={view} />);
    assert.equal(
      screen
        .getByTestId('weekly-review-fail-closed')
        .getAttribute('data-reason'),
      'empty_week'
    );
    assert.equal(
      screen
        .getByTestId('weekly-review-no-roi')
        .getAttribute('data-has-auto-roi'),
      'false'
    );
  });

  it('weekly review renders change_platform among next actions', () => {
    const view = projectWeeklyReviewPanel({
      workspaceId: 'ws-a',
      weekStartedAt: '2026-07-20T00:00:00.000Z',
      weekEndedAt: '2026-07-26T23:59:59.999Z',
      packages: [
        {
          contentPackageId: 'pkg-a',
          title: '海报',
          platform: 'douyin',
          ctaLabel: '预约',
          revision: 1,
        },
      ],
      publications: [
        {
          id: 'pub-1',
          contentPackageId: 'pkg-a',
          contentPackageRevision: 1,
          platform: 'douyin',
          accountDisplayLabel: '本店',
          publishedAt: '2026-07-20T08:00:00.000Z',
          actorId: 'a',
          sourceTier: 'manual_record',
          createdAt: '2026-07-20T08:00:00.000Z',
          status: 'published',
        },
      ],
      observations: [
        {
          id: 'o1',
          workspaceId: 'ws-a',
          contentPackageId: 'pkg-a',
          contentPackageRevision: 1,
          kind: 'store_visit',
          occurredAt: '2026-07-21T08:00:00.000Z',
          recordedAt: '2026-07-21T08:00:00.000Z',
          actorId: 'a',
          sourceTier: 'merchant_recorded',
        },
      ],
    });
    render(
      <WeeklyReviewPanel
        view={view}
        onConfirmRecommendation={() => undefined}
      />
    );
    assert.ok(screen.getByTestId('weekly-review-action-change_platform'));
    assert.ok(screen.getByTestId('weekly-review-action-continue_series'));
    assert.ok(screen.getByTestId('weekly-review-action-change_cta'));
    assert.ok(screen.getByTestId('weekly-review-action-stop_series'));
  });
});
