import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  createComposerLensState,
  selectLens,
  updateSettings,
  type ComposerLensState,
} from './lens-state-machine';
import { LensSwitchPreviewPanel } from './lens-switch-preview-panel';

function initialPreview() {
  let state: ComposerLensState = selectLens(createComposerLensState(), 'copy');
  state = updateSettings(state, { catalogModelId: 'model-copy' }, 'user');
  return selectLens(state, 'video');
}

function Harness() {
  const [state, setState] = useState(initialPreview);
  return (
    <div>
      <output data-testid="lens-phase">{state.phase}</output>
      <output data-testid="lens-id">{state.lensId}</output>
      <LensSwitchPreviewPanel state={state} onChange={setState} />
    </div>
  );
}

describe('lens switch preview panel', () => {
  it('keeps cancel, confirm and undo reachable', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('composer-lens-switch-preview')).toBeVisible();
    await user.click(screen.getByTestId('composer-lens-switch-cancel'));
    expect(screen.getByTestId('lens-id')).toHaveTextContent('copy');
  });

  it('commits the requested lens and offers one-step undo', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId('composer-lens-switch-confirm'));
    expect(screen.getByTestId('lens-id')).toHaveTextContent('video');
    await user.click(screen.getByTestId('composer-lens-switch-undo'));
    expect(screen.getByTestId('lens-id')).toHaveTextContent('copy');
  });
});
