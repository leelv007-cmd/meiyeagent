import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createComposerLensState,
  selectLens,
  updateSettings,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';
import { LensSwitchPreviewPanel } from './lens-switch-preview-panel';

afterEach(() => {
  cleanup();
});

function switchPreviewState(): ComposerLensState {
  let state = selectLens(createComposerLensState(), 'image_text');
  state = updateUserText(state, '写一条八月护发笔记');
  state = updateSettings(
    state,
    { aspectRatio: '3:4', catalogModelId: 'model-image' },
    'user'
  );
  return selectLens(state, 'copy');
}

describe('lens switch preview merchant copy', () => {
  // Regression: ISSUE-001 — internal state keys leaked into the switch dialog
  // Found by /qa on 2026-08-19
  // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
  it('describes preserved and recalculated fields without internal keys', () => {
    render(
      <LensSwitchPreviewPanel
        state={switchPreviewState()}
        onChange={() => {}}
      />
    );

    const preview = screen.getByTestId('composer-lens-switch-preview');
    expect(preview).toHaveTextContent('已输入的需求');
    expect(preview).toHaveTextContent('已选模型');
    expect(preview).toHaveTextContent('已调整的生成设置');
    expect(preview).not.toHaveTextContent(
      /userText|explicitModel|handEditedParams|confirmedQuote|recipe/
    );
  });
});
