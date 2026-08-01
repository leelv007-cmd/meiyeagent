/**
 * Viral adapt interaction — paste track honest + confirm source (#324).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ViralAdaptPanel } from './viral-adapt-panel';
import {
  advanceViralSourcingToConfirm,
  beginViralOpenCliRead,
  completeViralOpenCliRead,
  confirmViralAdaptJourney,
  createViralAdaptJourneyState,
  failViralOpenCliRead,
  selectViralAdaptSourceTrack,
  startViralAdaptJourney,
  updateViralOpenCliLink,
  updateViralPasteDraft,
  type ViralAdaptJourneyState,
} from './viral-adapt-journey';

afterEach(() => {
  cleanup();
});

function ViralAdaptHarness({
  evidencePresent = false,
  bridgeReady = false,
  bridgeResult = 'success',
}: {
  evidencePresent?: boolean;
  bridgeReady?: boolean;
  bridgeResult?: 'success' | 'error';
}) {
  const [state, setState] = useState<ViralAdaptJourneyState>(() =>
    startViralAdaptJourney(
      createViralAdaptJourneyState({ evidencePresent, bridgeReady })
    )
  );
  const [merchantIntent, setMerchantIntent] = useState<string | null>(null);
  const [sourcePayloadSummary, setSourcePayloadSummary] = useState<
    string | null
  >(null);
  const [uploadRequests, setUploadRequests] = useState(0);
  const [bridgeRequests, setBridgeRequests] = useState(0);

  return (
    <div>
      <ViralAdaptPanel
        onOpenCliLinkChange={(noteUrl) =>
          setState((current) => updateViralOpenCliLink(current, noteUrl))
        }
        onOpenCliRead={() => {
          setBridgeRequests((count) => count + 1);
          setState((current) => {
            const reading = beginViralOpenCliRead(current);
            if ('error' in reading) return current;
            if (bridgeResult === 'error') {
              return failViralOpenCliRead(reading, 'read_failed');
            }
            const completed = completeViralOpenCliRead(reading, {
              schemaVersion: 'viral-opencli-read/v1',
              noteText: '登录态 fixture 笔记正文',
              authorizedAssets: [
                { id: 'asset-opencli-1', revision: 'asset-revision-1' },
              ],
            });
            return 'error' in completed ? current : completed;
          });
        }}
        onRequestImageUpload={() => setUploadRequests((count) => count + 1)}
        onConfirm={() => {
          setState((current) => {
            const next = confirmViralAdaptJourney(current);
            if ('error' in next) return current;
            setMerchantIntent(next.merchantIntent);
            setSourcePayloadSummary(
              next.sourcePayload
                ? `${next.sourcePayload.track}:${next.sourcePayload.authorizedAssetIds.length}`
                : null
            );
            return next;
          });
        }}
        onConfirmBack={() =>
          setState((current) => ({
            ...current,
            phase: 'sourcing',
            confirm: null,
            merchantIntent: null,
            sourcePayload: null,
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
        onTrackChange={(track) =>
          setState((current) => selectViralAdaptSourceTrack(current, track))
        }
        state={state}
      />
      <output data-testid="viral-adapt-upload-requests">
        {uploadRequests}
      </output>
      <output data-testid="viral-adapt-bridge-requests">
        {bridgeRequests}
      </output>
      <button
        data-testid="viral-adapt-host-asset-attached"
        onClick={() =>
          setState((current) =>
            updateViralPasteDraft(current, {
              imageAssetIds: ['asset-reference-1'],
            })
          )
        }
        type="button"
      >
        host asset attached
      </button>
      {merchantIntent ? (
        <pre data-testid="viral-adapt-merchant-intent">{merchantIntent}</pre>
      ) : null}
      {sourcePayloadSummary ? (
        <output data-testid="viral-adapt-source-payload-summary">
          {sourcePayloadSummary}
        </output>
      ) : null}
    </div>
  );
}

describe('viral adapt paste-track journey', () => {
  it('uses the ready logged-in bridge as the default track without persisting the URL', () => {
    render(<ViralAdaptHarness bridgeReady evidencePresent />);

    expect(screen.getByTestId('viral-adapt-track-opencli')).toHaveAttribute(
      'data-selected',
      'true'
    );
    expect(screen.getByTestId('viral-adapt-track-paste')).toHaveAttribute(
      'data-selected',
      'false'
    );
    fireEvent.change(screen.getByTestId('viral-adapt-opencli-link'), {
      target: {
        value:
          'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret',
      },
    });
    fireEvent.click(screen.getByTestId('viral-adapt-opencli-action'));

    expect(screen.getByTestId('viral-adapt-bridge-requests')).toHaveTextContent(
      '1'
    );
    expect(
      screen.getByTestId('viral-adapt-opencli-read-summary')
    ).toHaveTextContent(/已读取.*已授权 1 张/u);
    fireEvent.click(screen.getByTestId('viral-adapt-sourcing-continue'));
    expect(
      screen.getByTestId('viral-adapt-confirm-source-label')
    ).toHaveTextContent(/本机登录态/u);
    fireEvent.click(screen.getByTestId('viral-adapt-confirm-submit'));
    const intent = screen.getByTestId('viral-adapt-merchant-intent');
    expect(intent).toHaveTextContent(/本店项目|商家已确认/u);
    expect(intent).not.toHaveTextContent(
      /viral_adapt_source|asset-opencli-1|登录态 fixture 笔记正文|xsec_token|fixture-secret/u
    );
    expect(
      screen.getByTestId('viral-adapt-source-payload-summary')
    ).toHaveTextContent('opencli_link:1');
  });

  it('shows a disconnected bridge honestly and switches to paste in one click', () => {
    render(<ViralAdaptHarness evidencePresent />);

    expect(screen.getByTestId('viral-adapt-track-paste')).toHaveAttribute(
      'data-selected',
      'true'
    );
    expect(
      screen.getByTestId('viral-adapt-opencli-device-status')
    ).toHaveTextContent(/本机桥未连接/u);
    fireEvent.click(screen.getByTestId('viral-adapt-select-opencli'));
    expect(screen.getByTestId('viral-adapt-track-opencli')).toHaveAttribute(
      'data-selected',
      'true'
    );
    expect(screen.getByTestId('viral-adapt-opencli-action')).toBeDisabled();
    fireEvent.click(screen.getByTestId('viral-adapt-opencli-fallback'));
    expect(screen.getByTestId('viral-adapt-track-paste')).toHaveAttribute(
      'data-selected',
      'true'
    );
    expect(screen.getByTestId('viral-adapt-paste-text')).toBeEnabled();
  });

  it('keeps bridge errors generic and recoverable through paste', () => {
    render(
      <ViralAdaptHarness bridgeReady bridgeResult="error" evidencePresent />
    );
    fireEvent.change(screen.getByTestId('viral-adapt-opencli-link'), {
      target: {
        value:
          'https://www.xiaohongshu.com/explore/fixture-note?xsec_token=fixture-secret',
      },
    });
    fireEvent.click(screen.getByTestId('viral-adapt-opencli-action'));
    expect(screen.getByRole('alert')).toHaveTextContent(/读取失败/u);
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /xsec_token|fixture-secret|xiaohongshu\.com/u
    );
    fireEvent.click(screen.getByTestId('viral-adapt-opencli-fallback'));
    expect(screen.getByTestId('viral-adapt-paste-text')).toBeEnabled();
  });

  it('while live gate closed, only paste is usable and OpenCLI is honest', () => {
    render(<ViralAdaptHarness />);

    expect(screen.getByTestId('viral-adapt-sourcing-card')).toBeInTheDocument();
    const opencli = screen.getByTestId('viral-adapt-track-opencli');
    expect(opencli).toHaveAttribute('data-opencli-available', 'false');
    expect(screen.getByTestId('viral-adapt-opencli-status')).toHaveTextContent(
      /暂不可用|未核销/
    );
    expect(screen.getByTestId('viral-adapt-opencli-action')).toBeDisabled();
    expect(screen.getByTestId('viral-adapt-opencli-action')).toHaveTextContent(
      /暂不可用/
    );
    // Never claim available.
    expect(
      screen.getByTestId('viral-adapt-opencli-status').textContent
    ).not.toMatch(/已可用/);
  });

  it('upload CTA delegates to the real host seam and never invents an asset', () => {
    render(<ViralAdaptHarness />);

    fireEvent.change(screen.getByTestId('viral-adapt-paste-text'), {
      target: {
        value:
          '姐妹们！清爽护理三步走\n到店可体验\nhttps://xhs.invalid/explore/private-note?xsec_token=SECRET',
      },
    });
    fireEvent.click(screen.getByTestId('viral-adapt-add-image'));
    expect(screen.getByTestId('viral-adapt-upload-requests')).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId('viral-adapt-track-images')).toHaveTextContent(
      /尚未.*参考图/
    );
    expect(
      screen.getByTestId('viral-adapt-track-images')
    ).not.toHaveTextContent('参考图 1');

    fireEvent.click(screen.getByTestId('viral-adapt-host-asset-attached'));
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
    const intent = screen.getByTestId('viral-adapt-merchant-intent');
    expect(intent).toHaveTextContent(/本店项目|商家已确认/u);
    expect(intent).not.toHaveTextContent(
      /viral_adapt_source|清爽护理|商家粘贴|asset-reference-1|参考图资产|https:\/\/|xsec_token|SECRET/u
    );
    expect(
      screen.getByTestId('viral-adapt-source-payload-summary')
    ).toHaveTextContent('paste:1');
  });

  it('continue stays disabled until paste text is present', () => {
    render(<ViralAdaptHarness />);
    expect(screen.getByTestId('viral-adapt-sourcing-continue')).toBeDisabled();
    fireEvent.change(screen.getByTestId('viral-adapt-paste-text'), {
      target: { value: '有正文' },
    });
    expect(
      screen.getByTestId('viral-adapt-sourcing-continue')
    ).not.toBeDisabled();
  });
});
