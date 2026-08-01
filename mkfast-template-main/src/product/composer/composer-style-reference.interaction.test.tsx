/**
 * P2-11 / #323 — Composer @素材 style-reference entry + stage notice.
 * @vitest-environment jsdom
 */

import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ComposerStyleAnalysisStageNotice,
  ComposerStyleReferenceControl,
  buildStyleAnalysisStageFromAssets,
} from './composer-style-reference-control';
import { STYLE_ANALYSIS_STAGE_MESSAGE } from './style-analysis-entry';

afterEach(() => {
  cleanup();
});

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  const state = buildStyleAnalysisStageFromAssets({
    attachedAssetIds: ['asset-a'],
    styleReferenceAssetIds: selected,
  });
  return (
    <div>
      <ComposerStyleReferenceControl
        assetId="asset-a"
        onToggle={(id) =>
          setSelected((current) =>
            current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id]
          )
        }
        selected={selected.includes('asset-a')}
      />
      <ComposerStyleAnalysisStageNotice state={state} />
    </div>
  );
}

describe('Composer style-reference @素材 entry', () => {
  it('toggles style reference and surfaces the seven-dim stage notice', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByTestId('composer-style-analysis-stage')).toBeNull();

    await user.click(screen.getByTestId('composer-style-reference-asset-a'));
    const stage = screen.getByTestId('composer-style-analysis-stage');
    expect(stage).toHaveTextContent(STYLE_ANALYSIS_STAGE_MESSAGE);
    expect(stage).toHaveAttribute('data-stage-id', 'xhs_style_analysis');

    await user.click(screen.getByTestId('composer-style-reference-asset-a'));
    expect(screen.queryByTestId('composer-style-analysis-stage')).toBeNull();
  });
});
