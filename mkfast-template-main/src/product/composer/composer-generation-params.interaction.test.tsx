import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSubmissionGenerationParams,
  initialGenerationParamsState,
} from './composer-generation-params';
import { ComposerGenerationParamsPanel } from './composer-generation-params-panel';

afterEach(cleanup);

describe('P2-09 generation params visibility (C5)', () => {
  it('hides the panel entirely in customized mode', () => {
    render(
      <ComposerGenerationParamsPanel
        creationMode="customized"
        onChange={() => undefined}
        state={initialGenerationParamsState()}
      />
    );
    expect(
      screen.queryByTestId('composer-generation-params')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('composer-thinking-level')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('composer-beauty-voice-role')
    ).not.toBeInTheDocument();
  });

  it('shows beauty voice + thinking level only in free mode', () => {
    render(
      <ComposerGenerationParamsPanel
        creationMode="free"
        onChange={() => undefined}
        state={initialGenerationParamsState()}
      />
    );
    expect(screen.getByTestId('composer-generation-params')).toHaveAttribute(
      'data-creation-mode',
      'free'
    );
    expect(
      screen.getByTestId('composer-beauty-voice-role')
    ).toBeInTheDocument();
    expect(screen.getByTestId('composer-thinking-level')).toBeInTheDocument();
    expect(screen.getByText('美容师口吻')).toBeInTheDocument();
    expect(screen.getByText('店主口吻')).toBeInTheDocument();
    expect(screen.getByText('顾客口吻')).toBeInTheDocument();
    expect(screen.getByText('深度思考')).toBeInTheDocument();
  });

  it('reports selected beauty voice and thinking level', async () => {
    const onChange = vi.fn();
    render(
      <ComposerGenerationParamsPanel
        creationMode="free"
        onChange={onChange}
        state={initialGenerationParamsState()}
      />
    );

    await userEvent.click(
      screen.getByTestId('composer-beauty-voice-role-beautician')
    );
    expect(onChange).toHaveBeenCalledWith({
      beautyVoiceRole: 'beautician',
      thinkingLevel: 'standard',
    });

    await userEvent.click(screen.getByTestId('composer-thinking-level-deep'));
    expect(onChange).toHaveBeenCalledWith({
      beautyVoiceRole: null,
      thinkingLevel: 'deep',
    });
  });
});

describe('P2-09 submission injection', () => {
  it('clears hidden free-mode choices when switching to customized', () => {
    expect(
      buildSubmissionGenerationParams({
        creationMode: 'customized',
        state: {
          beautyVoiceRole: 'customer',
          thinkingLevel: 'deep',
        },
      })
    ).toEqual({
      thinkingLevel: 'standard',
    });
  });

  it('free injects the visible selection', () => {
    expect(
      buildSubmissionGenerationParams({
        creationMode: 'free',
        state: {
          beautyVoiceRole: 'customer',
          thinkingLevel: 'deep',
        },
      })
    ).toEqual({
      beautyVoiceRole: 'customer',
      thinkingLevel: 'deep',
    });
  });
});
