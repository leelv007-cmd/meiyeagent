import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgressiveFactCard } from './progressive-fact-card';

afterEach(() => {
  cleanup();
});

const STORE = {
  name: '青禾美甲',
  city: '杭州',
  district: '拱墅区',
  address: '湖墅南路 88 号',
  booking: '提前一天预约',
  brandVoice: '真实、克制',
  prohibitions: ['不虚构价格'],
  accounts: [],
  projects: [
    {
      id: 'project-cat-eye',
      name: '透亮猫眼',
      price: 299,
      durationMinutes: 90,
      confirmed: true,
    },
  ],
  regulated: false,
  revision: 3,
};

describe('ProgressiveFactCard finalizer retry', () => {
  it('creates the request on first confirm and reuses it after a visible failure', async () => {
    let now = '2026-07-27T10:00:00.000Z';
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);

    render(
      <ProgressiveFactCard
        activeFacts={[]}
        createConfirmationId={() => 'confirmation-a'}
        factHeads={[
          { factId: 'store-project:project-cat-eye:service', revision: 4 },
          { factId: 'store-project:project-cat-eye:price', revision: 7 },
        ]}
        now={() => now}
        onConfirm={onConfirm}
        store={STORE}
        workspaceId="workspace-a"
      />
    );

    fireEvent.click(screen.getByTestId('progressive-fact-continue'));
    fireEvent.click(screen.getByTestId('progressive-fact-continue'));
    // #244 — the price question is followed by how long the price runs, and the
    // merchant here says it is a standing one.
    fireEvent.click(
      screen.getByTestId('progressive-fact-price-validity-long-term')
    );
    fireEvent.click(screen.getByTestId('progressive-fact-continue'));

    now = '2026-07-27T11:30:00.000Z';
    fireEvent.click(screen.getByTestId('progressive-fact-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('progressive-fact-submit-error')).toBeVisible();
    });
    const firstRequest = onConfirm.mock.calls[0]?.[0];
    const firstKey = onConfirm.mock.calls[0]?.[1];
    expect(firstRequest?.payload.batch.source.capturedAt).toBe(now);
    expect(firstRequest?.payload.confirmations).toEqual([
      {
        candidateId: 'store-project:project-cat-eye:service:candidate',
        factId: 'store-project:project-cat-eye:service',
        expectedFactRevision: 4,
      },
      {
        candidateId: 'store-project:project-cat-eye:price:candidate',
        factId: 'store-project:project-cat-eye:price',
        expectedFactRevision: 7,
      },
    ]);

    fireEvent.click(screen.getByTestId('progressive-fact-retry'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onConfirm.mock.calls[1]?.[0]).toBe(firstRequest);
    expect(onConfirm.mock.calls[1]?.[1]).toBe(firstKey);
  });
});

describe('ProgressiveFactCard Day-0 regulated default', () => {
  const answerDayZero = () => {
    for (const value of ['青禾美甲', '杭州', '透亮猫眼', '299']) {
      const input = screen.getByTestId('progressive-fact-input');
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByTestId('progressive-fact-continue'));
    }
    fireEvent.click(
      screen.getByTestId('progressive-fact-price-validity-long-term')
    );
    fireEvent.click(screen.getByTestId('progressive-fact-continue'));
  };

  it('withholds confirm until the platform default resolves, then seeds it', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ProgressiveFactCard
        activeFacts={[]}
        createConfirmationId={() => 'confirmation-day-zero'}
        factHeads={[]}
        now={() => '2026-07-27T10:00:00.000Z'}
        onConfirm={onConfirm}
        workspaceId="workspace-a"
      />
    );

    answerDayZero();
    expect(screen.getByTestId('progressive-fact-confirm')).toBeDisabled();
    expect(
      onConfirm.mock.calls[0]?.[0].payload.profilePatch.projects?.upsert?.[0]
        ?.priceValidUntil
    ).toBeUndefined();

    rerender(
      <ProgressiveFactCard
        activeFacts={[]}
        createConfirmationId={() => 'confirmation-day-zero'}
        factHeads={[]}
        now={() => '2026-07-27T10:00:00.000Z'}
        onConfirm={onConfirm}
        regulatedDefault={true}
        workspaceId="workspace-a"
      />
    );

    fireEvent.click(screen.getByTestId('progressive-fact-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0]?.[0].payload.profilePatch.regulated).toBe(
      true
    );
    // The merchant said "it stands" — that is a stated answer, written as null,
    // and never a default the card filled in for them (#244).
    expect(
      onConfirm.mock.calls[0]?.[0].payload.profilePatch.projects?.upsert?.[0]
        ?.priceValidUntil
    ).toBe(null);
  });
});
