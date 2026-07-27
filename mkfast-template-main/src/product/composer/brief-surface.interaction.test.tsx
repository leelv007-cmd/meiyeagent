/**
 * RTL: conditional Brief surface show / cancel restore / evidence drawer.
 */
import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BriefTriggerConditionCode } from '@meiye/contracts';

import {
  BRIEF_TRIGGER_CODES,
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  fixtureBriefProjection,
  openBriefSurface,
  projectBriefSurfaceView,
  type BriefSurfaceState,
  type ComposerInputSnapshot,
} from './brief-surface';
import { BriefSurface } from './brief-surface-panel';

afterEach(() => {
  cleanup();
});

const SNAPSHOT: ComposerInputSnapshot = {
  userText: '夏日美甲活动',
  sources: [{ id: 'a1' }],
  lensId: 'copy',
  draftRevisionId: 'draft-ui-1',
  hostState: { note: 'keep-me' },
};

function BriefHarness({
  codes,
  withEvidence = false,
  lensId = 'copy',
}: {
  codes: BriefTriggerConditionCode[];
  withEvidence?: boolean;
  lensId?: 'copy' | 'image_text' | 'video';
}) {
  const projection = fixtureBriefProjection({
    requiresBrief: codes.length > 0,
    triggerCodes: codes,
    lensId,
    evidenceDrawer: withEvidence
      ? [
          {
            sourceName: '门店价目',
            sourceType: 'source_extracted',
            factKind: 'price',
            factSummary: '美甲 128',
            freshness: '今日',
            rightsStatus: '本店',
          },
        ]
      : [],
  });

  const [state, setState] = useState<BriefSurfaceState>(() => {
    if (!projection.requiresBrief) return createBriefSurfaceState();
    return openBriefSurface(createBriefSurfaceState(), {
      projection,
      composerSnapshot: { ...SNAPSHOT, lensId },
    });
  });
  const [restoredText, setRestoredText] = useState<string | null>(null);
  const [confirmedRev, setConfirmedRev] = useState<string | null>(null);

  const view = projectBriefSurfaceView(state, { lensId });

  return (
    <div>
      <output data-testid="composer-user-text">{SNAPSHOT.userText}</output>
      <output data-testid="brief-phase">{state.phase}</output>
      <output data-testid="restored-text">{restoredText ?? ''}</output>
      <output data-testid="confirmed-rev">{confirmedRev ?? ''}</output>
      {view.visible ? (
        <BriefSurface
          view={view}
          onCancel={() => {
            const { state: next, restored } = cancelBriefSurface(state);
            setState(next);
            setRestoredText(restored?.userText ?? null);
          }}
          onConfirm={() => {
            const result = confirmBriefSurface(state, {
              confirmedAt: '2026-07-20T00:00:00.000Z',
            });
            if (result.ok) {
              setState(result.state);
              setConfirmedRev(
                result.confirmation.boundRevisions.draftRevisionId
              );
            }
          }}
        />
      ) : (
        <p data-testid="composer-direct-submit">直接开始</p>
      )}
    </div>
  );
}

describe('Brief surface UI — seven triggers show / cancel restore', () => {
  for (const code of BRIEF_TRIGGER_CODES) {
    it(`renders trigger ${code} and cancel restores composer input`, () => {
      const lensId = code === 'any_video' ? 'video' : 'copy';
      render(<BriefHarness codes={[code]} lensId={lensId} />);

      const surface = screen.getByTestId('composer-brief-surface');
      expect(surface).toBeInTheDocument();
      expect(
        screen.getByTestId(`composer-brief-trigger-${code}`)
      ).toHaveAttribute('data-trigger-code', code);
      expect(screen.getByTestId('composer-brief-summary')).toBeInTheDocument();
      expect(screen.getByTestId('brief-phase')).toHaveTextContent('open');

      // Evidence absent by default
      expect(
        screen.queryByTestId('composer-brief-evidence-drawer')
      ).not.toBeInTheDocument();

      if (code === 'any_video') {
        expect(
          screen.getByTestId('composer-brief-video-confirm')
        ).toBeInTheDocument();
      }

      // fireEvent avoids userEvent pointer delays under cold/slow CI.
      fireEvent.click(screen.getByTestId('composer-brief-cancel'));
      expect(screen.getByTestId('brief-phase')).toHaveTextContent('cancelled');
      expect(screen.getByTestId('restored-text')).toHaveTextContent(
        SNAPSHOT.userText
      );
      expect(
        screen.queryByTestId('composer-brief-surface')
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('composer-direct-submit')).toBeInTheDocument();
      // Composer field still present
      expect(screen.getByTestId('composer-user-text')).toHaveTextContent(
        SNAPSHOT.userText
      );
    });
  }

  it('simple task with no Brief shows direct submit (contrast)', () => {
    const decision = decideSubmitPath({
      projection: fixtureBriefProjection({ requiresBrief: false }),
    });
    expect(decision.path).toBe('direct_submit');

    render(<BriefHarness codes={[]} />);
    expect(
      screen.queryByTestId('composer-brief-surface')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-direct-submit')).toBeInTheDocument();
    expect(screen.getByTestId('brief-phase')).toHaveTextContent('idle');
  });

  it('confirm binds exact draft revision', () => {
    render(<BriefHarness codes={['images_over_four']} />);
    fireEvent.click(screen.getByTestId('composer-brief-confirm'));
    expect(screen.getByTestId('brief-phase')).toHaveTextContent('confirmed');
    expect(screen.getByTestId('confirmed-rev')).toHaveTextContent(
      'draft-rev-fixture'
    );
  });
});

describe('evidence drawer — no evidence = not shown', () => {
  it('does not render drawer without evidence entries', () => {
    render(<BriefHarness codes={['restricted_assets']} withEvidence={false} />);
    expect(
      screen.queryByTestId('composer-brief-evidence-drawer')
    ).not.toBeInTheDocument();
  });

  it('renders drawer with source / fact / freshness / rights when present', () => {
    render(
      <BriefHarness
        codes={['high_risk_fact_missing_or_conflict']}
        withEvidence
      />
    );
    const drawer = screen.getByTestId('composer-brief-evidence-drawer');
    expect(drawer).toBeInTheDocument();
    const entry = within(drawer).getByTestId('composer-brief-evidence-entry');
    expect(entry).toHaveTextContent('门店价目');
    expect(entry).toHaveTextContent('美甲 128');
    expect(entry).toHaveTextContent('新鲜度：今日');
    expect(entry).toHaveTextContent('权利：本店');
  });
});

describe('video confirm zone embedded in Brief', () => {
  it('uses one Brief CTA to accept billing and start', () => {
    render(<BriefHarness codes={['any_video']} lensId="video" />);

    const zone = screen.getByTestId('composer-brief-video-confirm');
    expect(zone).toBeInTheDocument();
    expect(screen.getByTestId('composer-brief-confirm')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('composer-brief-confirm'));
    expect(screen.getByTestId('brief-phase')).toHaveTextContent('confirmed');
  });
});

/**
 * #240 P1: the Brief was a second door onto a stale quote. Editing the intent
 * while it was open left the card confirmable and still showing the old price.
 */
describe('Brief against a superseded quote', () => {
  function renderWithStaleness(quoteStale: boolean) {
    const state = openBriefSurface(createBriefSurfaceState(), {
      projection: fixtureBriefProjection({
        requiresBrief: true,
        triggerCodes: ['quote_policy_threshold'],
        lensId: 'copy',
      }),
      composerSnapshot: { ...SNAPSHOT, lensId: 'copy' },
    });
    render(
      <BriefSurface
        onCancel={() => undefined}
        onConfirm={() => undefined}
        view={projectBriefSurfaceView(state, { lensId: 'copy', quoteStale })}
      />
    );
  }

  it('disables confirmation and says why, in the merchant’s words', () => {
    renderWithStaleness(true);

    expect(screen.getByTestId('composer-brief-confirm')).toBeDisabled();
    const notice = screen.getByTestId('composer-brief-stale');
    expect(notice).toHaveTextContent(
      '你刚改过要写的内容，这份确认对不上了。点“返回修改”再提交一次就好。'
    );
    // No engineering vocabulary in front of a merchant (D-116).
    expect(notice).not.toHaveTextContent(/quote|revision|hash|payload/iu);
    // And the way out stays enabled — the card is not a dead end.
    expect(screen.getByTestId('composer-brief-cancel')).not.toBeDisabled();
  });

  it('shows no notice and stays confirmable while the quote still matches', () => {
    renderWithStaleness(false);

    expect(screen.getByTestId('composer-brief-confirm')).not.toBeDisabled();
    expect(screen.queryByTestId('composer-brief-stale')).toBeNull();
  });
});
