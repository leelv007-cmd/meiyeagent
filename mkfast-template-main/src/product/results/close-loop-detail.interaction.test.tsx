/**
 * RTL: the W09 detail fields the close-loop surfaces always accepted on the
 * wire and never offered on screen — quantity / time / note on a result chip,
 * and a publication that did not go up.
 */

import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { OutcomeChipsPanel } from './outcome-chips-panel';
import { projectOutcomeObservationPanel } from './outcome-observation-model';
import { PublicationRecordPanel } from './publication-record-panel';
import { projectPublicationRecordPanel } from './publication-record-model';

afterEach(() => {
  cleanup();
});

const readyView = () =>
  projectOutcomeObservationPanel({
    contentPackageId: 'pkg-a',
    contentPackageRevision: 2,
    hasPublicationRecord: true,
    observations: [],
  });

describe('outcome chip detail', () => {
  it('sends quantity, time and note with the chip', () => {
    const onRecord = vi.fn();
    render(<OutcomeChipsPanel view={readyView()} onRecord={onRecord} />);
    fireEvent.change(screen.getByTestId('outcome-detail-quantity'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('outcome-detail-occurred-at'), {
      target: { value: '2026-07-20T14:30' },
    });
    fireEvent.change(screen.getByTestId('outcome-detail-note'), {
      target: { value: '带朋友一起来的' },
    });
    fireEvent.click(screen.getByTestId('outcome-chip-store_visit'));

    assert.equal(onRecord.mock.calls.length, 1);
    const [kind, detail] = onRecord.mock.calls[0]!;
    assert.equal(kind, 'store_visit');
    assert.equal(detail.quantity, 3);
    assert.equal(detail.note, '带朋友一起来的');
    assert.equal(new Date(detail.occurredAt).getMinutes(), 30);
  });

  it('「这是昨天的」 backdates the signal instead of stamping now', () => {
    const onRecord = vi.fn();
    render(<OutcomeChipsPanel view={readyView()} onRecord={onRecord} />);
    fireEvent.click(screen.getByTestId('outcome-detail-yesterday'));
    fireEvent.click(screen.getByTestId('outcome-chip-store_visit'));
    const detail = onRecord.mock.calls[0]![1];
    const hoursAgo =
      (Date.now() - new Date(detail.occurredAt).getTime()) / 3_600_000;
    assert.ok(hoursAgo > 20 && hoursAgo < 28, `hoursAgo=${hoursAgo}`);
  });

  it('records without detail when the merchant fills nothing', () => {
    const onRecord = vi.fn();
    render(<OutcomeChipsPanel view={readyView()} onRecord={onRecord} />);
    fireEvent.click(screen.getByTestId('outcome-chip-attention'));
    assert.deepEqual(onRecord.mock.calls[0], ['attention', undefined]);
  });

  it('refuses a quantity that is not a positive whole number', () => {
    const onRecord = vi.fn();
    render(<OutcomeChipsPanel view={readyView()} onRecord={onRecord} />);
    fireEvent.change(screen.getByTestId('outcome-detail-quantity'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByTestId('outcome-chip-store_visit'));
    assert.equal(onRecord.mock.calls.length, 0);
    assert.ok(screen.getByTestId('outcome-detail-error'));
  });

  it('refuses a note carrying a customer phone number', () => {
    const onRecord = vi.fn();
    render(<OutcomeChipsPanel view={readyView()} onRecord={onRecord} />);
    fireEvent.change(screen.getByTestId('outcome-detail-note'), {
      target: { value: '客人电话 13800138000' },
    });
    fireEvent.click(screen.getByTestId('outcome-chip-store_visit'));
    assert.equal(onRecord.mock.calls.length, 0);
    assert.ok(screen.getByTestId('outcome-detail-error'));
  });

  it('keeps the detail row off a fail-closed panel', () => {
    const view = projectOutcomeObservationPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: false,
    });
    render(<OutcomeChipsPanel view={view} />);
    assert.equal(screen.queryByTestId('outcome-observation-detail'), null);
  });
});

describe('publication record status', () => {
  it('records a publication that did not go up', () => {
    const onRecordManual = vi.fn();
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      variantVersionId: 'v1',
      workspaceId: 'ws-a',
      recordsWorkspaceId: 'ws-a',
      records: [],
      automaticVerifiedPlatformCount: 0,
    });
    render(
      <PublicationRecordPanel
        view={view}
        contentPackageId="pkg-a"
        contentPackageRevision={2}
        variantVersionId="v1"
        platform="xiaohongshu"
        onRecordManual={onRecordManual}
      />
    );
    fireEvent.click(screen.getByTestId('publication-status-failed'));
    fireEvent.change(screen.getByTestId('publication-account'), {
      target: { value: '本店小红书' },
    });
    fireEvent.change(screen.getByTestId('publication-at'), {
      target: { value: '2026-07-20T14:30' },
    });
    fireEvent.click(screen.getByTestId('publication-record-submit'));

    assert.equal(onRecordManual.mock.calls.length, 1);
    assert.equal(onRecordManual.mock.calls[0]![0].status, 'failed');
  });

  it('still defaults to 发出去了 so the common case stays one tap', () => {
    const view = projectPublicationRecordPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      variantVersionId: 'v1',
      workspaceId: 'ws-a',
      recordsWorkspaceId: 'ws-a',
      records: [],
      automaticVerifiedPlatformCount: 0,
    });
    render(
      <PublicationRecordPanel
        view={view}
        contentPackageId="pkg-a"
        contentPackageRevision={2}
        variantVersionId="v1"
        platform="xiaohongshu"
        onRecordManual={vi.fn()}
      />
    );
    assert.equal(
      screen
        .getByTestId('publication-status-published')
        .getAttribute('data-active'),
      'true'
    );
  });
});
