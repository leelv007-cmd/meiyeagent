/**
 * RTL interaction: radiogroup keyboard / focus / a11y.
 * No inferred-lens live announcement while typing (D-081).
 */
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreationLensId } from '@meiye/contracts';

import { LensRadiogroup } from './lens-radiogroup';
import { LENS_GROUP_LABEL, LENS_REQUIRED_SUBMIT_HINT } from './lens-labels';
import {
  canSubmit,
  createComposerLensState,
  selectLens,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';

afterEach(() => {
  cleanup();
});

function LensHarness({
  initial = null,
  showRequiredHint = false,
}: {
  initial?: CreationLensId | null;
  showRequiredHint?: boolean;
}) {
  const [lens, setLens] = useState<CreationLensId | null>(initial);
  const [text, setText] = useState('');
  const [state, setState] = useState<ComposerLensState>(() =>
    createComposerLensState()
  );

  return (
    <div>
      <LensRadiogroup
        value={lens}
        showRequiredHint={showRequiredHint && lens == null}
        onChange={(next) => {
          setLens(next);
          setState((prev) => selectLens(prev, next));
        }}
      />
      <label htmlFor="intent">一句话意图</label>
      <input
        id="intent"
        data-testid="composer-intent-input"
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          setState((prev) => updateUserText(prev, value));
        }}
      />
      <output data-testid="selected-lens">{lens ?? 'none'}</output>
      <output data-testid="sm-phase">{state.phase}</output>
      <output data-testid="sm-lens">{state.lensId ?? 'none'}</output>
    </div>
  );
}

describe('LensRadiogroup a11y and keyboard', () => {
  it('exposes a required radiogroup with visible label and three options', () => {
    render(<LensHarness />);

    const group = screen.getByRole('radiogroup', {
      name: new RegExp(LENS_GROUP_LABEL),
    });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('data-testid', 'composer-lens-radiogroup');

    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAccessibleName('文案');
    expect(radios[1]).toHaveAccessibleName('图文');
    expect(radios[2]).toHaveAccessibleName('视频');

    for (const radio of radios) {
      expect(radio).not.toBeChecked();
    }
  }, 15_000);

  it('selects a lens via click and records user_explicit phase', async () => {
    const user = userEvent.setup();
    render(<LensHarness />);

    await user.click(screen.getByRole('radio', { name: '图文' }));

    expect(screen.getByRole('radio', { name: '图文' })).toBeChecked();
    expect(screen.getByTestId('selected-lens')).toHaveTextContent('image_text');
    expect(screen.getByTestId('sm-phase')).toHaveTextContent('selected');
    expect(screen.getByTestId('sm-lens')).toHaveTextContent('image_text');
  });

  it('supports arrow-key navigation and Space/Enter activation', async () => {
    const user = userEvent.setup();
    render(<LensHarness />);

    const copy = screen.getByRole('radio', { name: '文案' });
    copy.focus();
    expect(copy).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '图文' })).toBeChecked();
    expect(screen.getByTestId('selected-lens')).toHaveTextContent('image_text');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '视频' })).toBeChecked();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '图文' })).toBeChecked();
  });

  it('shows required submit hint when cold and does not auto-select on typing', async () => {
    const user = userEvent.setup();
    render(<LensHarness showRequiredHint />);

    expect(screen.getByTestId('composer-lens-required-hint')).toHaveTextContent(
      LENS_REQUIRED_SUBMIT_HINT
    );

    const intent = screen.getByTestId('composer-intent-input');
    await user.type(intent, '做一个抖音视频');

    // Still unselected — typing must not infer video lens.
    expect(screen.getByTestId('selected-lens')).toHaveTextContent('none');
    expect(screen.getByTestId('sm-phase')).toHaveTextContent('unselected');
    expect(screen.getByTestId('sm-lens')).toHaveTextContent('none');

    // No live region announcing inferred lens.
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
    const polite = Array.from(
      document.querySelectorAll('[aria-live="polite"]')
    );
    for (const node of polite) {
      expect(node.textContent ?? '').not.toMatch(/推断|视频|图文|文案/);
    }

    // Submit still blocked at model layer.
    const gate = canSubmit(
      createComposerLensState({ userText: '做一个抖音视频' })
    );
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.message).toBe(LENS_REQUIRED_SUBMIT_HINT);
      expect(gate.focusTarget).toBe('lens_group');
    }
  });

  it('does not announce lens changes via assertive live regions on selection', async () => {
    const user = userEvent.setup();
    render(<LensHarness />);

    await user.click(screen.getByRole('radio', { name: '视频' }));
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
    // Group itself is not a live region.
    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-live');
  });
});
