/**
 * Viral adapt interaction — paste track honest + confirm source (#324).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ViralAdaptPanel } from './viral-adapt-panel';
import {
  advanceViralSourcingToConfirm,
  confirmViralAdaptJourney,
  createViralAdaptJourneyState,
  startViralAdaptJourney,
  updateViralPasteDraft,
  type ViralAdaptJourneyState,
} from './viral-adapt-journey';

afterEach(() => {
  cleanup();
});

function ViralAdaptHarness({
  evidencePresent = false,
}: {
  evidencePresent?: boolean;
}) {
  const [state, setState] = useState<ViralAdaptJourneyState>(() =>
    startViralAdaptJourney(
      createViralAdaptJourneyState({ evidencePresent })
    )
  );
  const [readyIntent, setReadyIntent] = useState<string | null>(null);

  return (
    <div>
      <ViralAdaptPanel
        onAddImageLabel={(label) =>
          setState((current) =>
            updateViralPasteDraft(current, {
              imageLabels: [...current.draft.imageLabels, label],
            })
          )
        }
        onConfirm={() => {
          setState((current) => {
            const next = confirmViralAdaptJourney(current);
            if ('error' in next) return current;
            setReadyIntent(next.submitIntent);
            return next;
          });
        }}
        onConfirmBack={() =>
          setState((current) => ({
            ...current,
            phase: 'sourcing',
            confirm: null,
            submitIntent: null,
          }))
        }
        onDraftChange={(patch) =>
          setState((current) => updateViralPasteDraft(current, patch))
        }
        onSourcingCancel={() =>
          setState(createViralAdaptJourneyState({ evidencePresent }))
        }
        onSourcingContinue={() =>
          setState((current) => {
            const next = advanceViralSourcingToConfirm(current);
            return 'error' in next ? current : next;
          })
        }
        state={state}
      />
      {readyIntent ? (
        <pre data-testid="viral-adapt-ready-intent">{readyIntent}</pre>
      ) : null}
    </div>
  );
}

describe('viral adapt paste-track journey', () => {
  it('while live gate closed, only paste is usable and OpenCLI is honest', () => {
    render(<ViralAdaptHarness />);

    expect(screen.getByTestId('viral-adapt-sourcing-card')).toBeInTheDocument();
    const opencli = screen.getByTestId('viral-adapt-track-opencli');
    expect(opencli).toHaveAttribute('data-opencli-available', 'false');
    expect(screen.getByTestId('viral-adapt-opencli-status')).toHaveTextContent(
      /暂不可用|未核销/
    );
    expect(
      screen.getByTestId('viral-adapt-opencli-action')
    ).toBeDisabled();
    expect(screen.getByTestId('viral-adapt-opencli-action')).toHaveTextContent(
      /暂不可用/
    );
    // Never claim available.
    expect(screen.getByTestId('viral-adapt-opencli-status').textContent).not.toMatch(
      /已可用/
    );
  });

  it('confirm card explicitly shows sourcing method then yields note intent', () => {
    render(<ViralAdaptHarness />);

    fireEvent.change(screen.getByTestId('viral-adapt-paste-text'), {
      target: { value: '姐妹们！清爽护理三步走\n到店可体验' },
    });
    fireEvent.click(screen.getByTestId('viral-adapt-add-image'));
    fireEvent.click(screen.getByTestId('viral-adapt-sourcing-continue'));

    expect(screen.getByTestId('viral-adapt-confirm-card')).toBeInTheDocument();
    expect(
      screen.getByTestId('viral-adapt-confirm-source-label')
    ).toHaveTextContent(/粘贴/);
    expect(
      screen.getByTestId('viral-adapt-confirm-spec-source_track')
    ).toHaveTextContent(/粘贴/);
    expect(
      screen.getByTestId('viral-adapt-confirm-spec-deliverable')
    ).toHaveTextContent(/note/);
    expect(
      screen.getByTestId('viral-adapt-confirm-opencli-status')
    ).toHaveTextContent(/暂不可用|未核销/);

    fireEvent.click(screen.getByTestId('viral-adapt-confirm-submit'));
    const intent = screen.getByTestId('viral-adapt-ready-intent');
    expect(intent).toHaveTextContent(/\[viral_adapt_source:paste\]/);
    expect(intent).toHaveTextContent(/清爽护理/);
    expect(intent).toHaveTextContent(/商家粘贴/);
  });

  it('continue stays disabled until paste text is present', () => {
    render(<ViralAdaptHarness />);
    expect(
      screen.getByTestId('viral-adapt-sourcing-continue')
    ).toBeDisabled();
    fireEvent.change(screen.getByTestId('viral-adapt-paste-text'), {
      target: { value: '有正文' },
    });
    expect(
      screen.getByTestId('viral-adapt-sourcing-continue')
    ).not.toBeDisabled();
  });
});
