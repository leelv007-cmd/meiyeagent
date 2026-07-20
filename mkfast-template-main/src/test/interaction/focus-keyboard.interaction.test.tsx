/**
 * Sample interaction test — precedent for C/D line focus/keyboard cases.
 * Uses real jsdom focus movement + user-event (not renderToStaticMarkup).
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

function FocusKeyboardSample() {
  const [message, setMessage] = useState('idle');

  return (
    <div>
      <label htmlFor="sample-name">Name</label>
      <input id="sample-name" type="text" />
      <button type="button" onClick={() => setMessage('saved')}>
        Save
      </button>
      <button type="button" onClick={() => setMessage('cancelled')}>
        Cancel
      </button>
      <output aria-live="polite">{message}</output>
    </div>
  );
}

describe('focus and keyboard interaction sample', () => {
  it('moves focus with Tab and activates the focused button with Enter', async () => {
    const user = userEvent.setup();
    render(<FocusKeyboardSample />);

    const nameInput = screen.getByLabelText('Name');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });

    nameInput.focus();
    expect(nameInput).toHaveFocus();

    await user.tab();
    expect(saveButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('saved');

    await user.tab();
    expect(cancelButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('cancelled');
  });
});
