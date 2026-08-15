import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CreationLensId } from '@meiye/contracts';

import type { CatalogModelView } from '@/p1/settings-view-model';

import type { ComposerCreationMode } from './composer-conversation';
import {
  ComposerCreationModeSurface,
  FreeCreationPanel,
} from './free-creation-panel';
import {
  initialGenerationParamsState,
  type ComposerGenerationParamsState,
} from './composer-generation-params';

afterEach(cleanup);

beforeAll(() => {
  Element.prototype.getAnimations ??= () => [];
});

const models: CatalogModelView[] = [
  {
    id: 'copy-model',
    displayName: 'DeepSeek V4 Pro',
    modality: 'llm',
    qualityRank: 1,
    capabilityLabels: ['文案生成'],
    available: true,
    availabilityKind: 'local_fixture',
    unitPrice: {
      amountMicros: 1,
      currency: 'CNY',
      revision: 'price-1',
      unit: 'generation',
    },
  },
];

function ModeHarness({
  generationParamsEnabled = true,
}: {
  generationParamsEnabled?: boolean;
}) {
  const [mode, setMode] = useState<ComposerCreationMode>('customized');
  const [lensId] = useState<CreationLensId | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [generationParams, setGenerationParams] =
    useState<ComposerGenerationParamsState>(initialGenerationParamsState);

  return (
    <ComposerCreationModeSurface
      creationMode={mode}
      freePanel={
        <FreeCreationPanel
          catalogError={false}
          catalogLoading={false}
          disabled={false}
          generationParams={generationParams}
          generationParamsEnabled={generationParamsEnabled}
          lensId={lensId}
          models={models}
          onGenerationParamsChange={setGenerationParams}
          onModelChange={setModelId}
          selectedModelId={modelId}
        />
      }
      onCreationModeChange={setMode}
    />
  );
}

describe('D-103 creation mode surface', () => {
  it('replaces the customized entry face with explicit free controls', async () => {
    const user = userEvent.setup();
    render(<ModeHarness />);

    expect(screen.queryByTestId('composer-free-creation-panel')).toBeNull();

    await user.click(screen.getByTestId('composer-creation-mode-free'));

    expect(screen.getByTestId('composer-free-creation-panel')).toBeVisible();
    // #344: output type is chosen in the bottom capsule (spec 2.4), so the
    // panel must not grow a second lens radiogroup of its own.
    expect(screen.queryByRole('radiogroup', { name: /创作类型/ })).toBeNull();
    expect(screen.getByLabelText('本次使用的模型')).toBeVisible();
    expect(screen.getByText('先选择输出类型')).toBeVisible();
    expect(screen.getByTestId('composer-thinking-level')).toBeVisible();
    expect(
      screen.getByText('不选就用模型默认口吻；选了就按这个美业角色写。')
    ).toBeVisible();
  });

  // P2-09 (#343): the free panel may only offer role/thinking on the route the
  // submission signs them for, otherwise the merchant sets a value that is
  // silently dropped.
  it('mounts generation params only while the route supports them', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ModeHarness generationParamsEnabled={false} />
    );

    await user.click(screen.getByTestId('composer-creation-mode-free'));

    expect(screen.getByTestId('composer-free-creation-panel')).toBeVisible();
    expect(screen.queryByTestId('composer-generation-params')).toBeNull();

    rerender(<ModeHarness generationParamsEnabled />);

    expect(screen.getByTestId('composer-generation-params')).toBeVisible();
  });

  it('reports the model explicitly selected for the free run', async () => {
    const onModelChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FreeCreationPanel
        catalogError={false}
        catalogLoading={false}
        disabled={false}
        generationParams={initialGenerationParamsState()}
        generationParamsEnabled={false}
        lensId="copy"
        models={models}
        onGenerationParamsChange={() => undefined}
        onModelChange={onModelChange}
        selectedModelId={null}
      />
    );

    await user.click(screen.getByTestId('composer-free-model-select'));
    await user.click(screen.getByRole('option', { name: 'DeepSeek V4 Pro' }));

    expect(onModelChange).toHaveBeenCalledWith('copy-model');
  });
});
